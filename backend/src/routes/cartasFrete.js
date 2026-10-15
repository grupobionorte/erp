const express = require("express");
const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

/* ---------------------------------------------------------------------------
   Carta frete: contrato e recibo do frete pago ao proprietário do veículo,
   no layout do sistema anterior (4 vias). Sai de um CT-e autorizado e não
   vai à SEFAZ — é documento interno, mas é o que o motorista assina.
--------------------------------------------------------------------------- */

const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const arredondar = (v) => Math.round((Number(v) || 0) * 100) / 100;
const municipio = (endereco) =>
  endereco?.cidade ? [endereco.cidade, endereco.uf].filter(Boolean).join(" - ") : null;

// Créditos somam ao valor do documento; os débitos saem dele. O adiantamento
// de pedágio só aparece na via de adiantamento: é repasse ao motorista, não
// desconto do frete.
const CREDITOS = ["outrosCreditos"];
const DEBITOS = [
  "adiantamento", "seguro", "pedagio", "estadia", "outrosDebitos",
  "irrf", "inss", "outrasEntidades", "comissaoFixa", "comissaoVariavel",
];
const VALORES = [...CREDITOS, ...DEBITOS, "adiantamentoPedagio"];

const INCLUIR_CTE = {
  empresa: { include: { endereco: true } },
  remetente: { include: { endereco: true } },
  destinatario: { include: { endereco: true } },
  expedidor: { include: { endereco: true } },
  recebedor: { include: { endereco: true } },
  veiculo: true, veiculoReboque: true, veiculoReboque2: true, veiculoReboque3: true,
  documentosTransportados: {
    include: {
      notaFiscal: {
        include: {
          empresa: { include: { endereco: true } },
          localRetirada: { include: { endereco: true } },
        },
      },
    },
  },
};

async function cteDaEmpresa(cteId, empresaId) {
  const cte = await prisma.documentoFiscal.findUnique({ where: { id: Number(cteId) }, include: INCLUIR_CTE });
  if (!cte || cte.tipo !== "CTe") return { erro: "CT-e não encontrado", status: 404 };
  if (cte.empresaId !== empresaId) return { erro: "Esse CT-e pertence a outra empresa", status: 403 };
  if (cte.status !== "autorizado" || !cte.chaveAcesso) {
    return { erro: "A carta frete só sai de CT-e autorizado", status: 409 };
  }
  return { cte };
}

const pessoaResumo = (p) => p && ({
  nome: p.nomeRazaoSocial || p.razaoSocial,
  documento: p.documento || p.cnpj,
  municipio: municipio(p.endereco),
});

/**
 * Tudo o que a carta mostra, montado a partir do CT-e e dos cadastros. Vira o
 * "dados" congelado na emissão. Devolve também o que falta: sem proprietário
 * do veículo a carta não sai — é para ele que o frete é pago.
 */
async function montarDados(cte) {
  const notas = cte.documentosTransportados || [];
  const primeiraNota = notas[0]?.notaFiscal;

  // Remetente: o do CT-e; sem ele (CT-e gerado da NF-e, onde o emitente da
  // nota é quem despacha), a empresa que emitiu a nota.
  const remetente = pessoaResumo(cte.remetente) || pessoaResumo(primeiraNota?.empresa) || pessoaResumo(cte.empresa);
  const destinatario = pessoaResumo(cte.recebedor) || pessoaResumo(cte.destinatario);

  // Coleta: onde a carga foi retirada (local de retirada da NF-e, ou o
  // expedidor); senão, o início da prestação. Entrega: recebedor ou
  // destinatário; senão, o fim da prestação.
  const coleta = municipio(primeiraNota?.localRetirada?.endereco) || municipio(cte.expedidor?.endereco)
    || [cte.origemPercurso, cte.ufInicio].filter(Boolean).join(" - ") || null;
  const entrega = municipio(cte.recebedor?.endereco) || municipio(cte.destinatario?.endereco)
    || [cte.destinoPercurso, cte.ufFim].filter(Boolean).join(" - ") || null;

  const cavalo = cte.veiculo;
  const placas = [cavalo, cte.veiculoReboque, cte.veiculoReboque2, cte.veiculoReboque3]
    .filter(Boolean).map((v) => v.placa);

  const cpf = soDigitos(cte.cpfMotorista);
  const motoristaCadastro = cpf
    ? (await prisma.motorista.findMany({
        where: { empresaId: cte.empresaId, ativo: true },
        include: { endereco: true },
      })).find((m) => soDigitos(m.cpf) === cpf)
    : null;

  const pesoKg = notas.reduce((t, n) => t + (n.pesoBruto || 0), 0);

  const faltando = [];
  if (!cavalo) faltando.push("O CT-e não tem veículo.");
  if (cavalo && (!cavalo.proprietarioNome || !soDigitos(cavalo.proprietarioDocumento))) {
    faltando.push(`Preencha o proprietário (nome e CNPJ/CPF) no cadastro do veículo ${cavalo.placa}.`);
  }
  if (!cte.nomeMotorista) faltando.push("O CT-e não tem motorista.");

  const e = cte.empresa;
  return {
    faltando,
    pesoToneladas: pesoKg ? arredondar(pesoKg / 1000) : null,
    dados: {
      emitente: {
        nome: e.razaoSocial, cnpj: e.cnpj, ie: e.ie, rntrc: e.rntrc,
        endereco: [e.endereco?.logradouro, e.endereco?.numero && `Nº ${e.endereco.numero}`, e.endereco?.cep && `CEP ${e.endereco.cep}`]
          .filter(Boolean).join(", "),
        municipio: municipio(e.endereco),
      },
      remetente,
      destinatario,
      proprietario: cavalo && {
        nome: cavalo.proprietarioNome,
        documento: cavalo.proprietarioDocumento,
        ie: cavalo.proprietarioIe,
        rntrc: cavalo.proprietarioRntrc,
        endereco: cavalo.proprietarioEndereco,
        municipio: cavalo.proprietarioMunicipio
          ? [cavalo.proprietarioMunicipio, cavalo.proprietarioUf].filter(Boolean).join(" - ")
          : cavalo.proprietarioUf || null,
      },
      motorista: {
        nome: cte.nomeMotorista,
        cpf: cte.cpfMotorista,
        cnh: motoristaCadastro?.cnh || null,
        municipio: municipio(motoristaCadastro?.endereco),
      },
      placas,
      coleta,
      entrega,
      cte: { numero: cte.numero, serie: cte.serie, chave: cte.chaveAcesso },
      mercadoria: {
        natureza: cte.produtoPredominante || notas[0]?.naturezaMercadoria || null,
        notas: notas.map((n) => ({ numero: n.numeroDocumento || n.notaFiscal?.numero || null, valor: n.valorTotalNota ?? null })),
      },
    },
  };
}

// O que já foi emitido para o CT-e (a ativa e as canceladas), mais os dados
// para uma carta nova.
router.get("/do-cte/:cteId", asyncHandler(async (req, res) => {
  const { cte, erro, status } = await cteDaEmpresa(req.params.cteId, req.usuario.empresaId);
  if (erro) return res.status(status).json({ erro });

  const cartas = await prisma.cartaFrete.findMany({ where: { cteId: cte.id }, orderBy: { id: "desc" } });
  const previa = await montarDados(cte);
  res.json({ cartas, previa });
}));

router.post("/", asyncHandler(async (req, res) => {
  const { cte, erro, status } = await cteDaEmpresa(req.body.cteId, req.usuario.empresaId);
  if (erro) return res.status(status).json({ erro });

  // Uma carta valendo por CT-e. Errou, cancela e emite outra.
  const ativa = await prisma.cartaFrete.findFirst({ where: { cteId: cte.id, status: "emitida" } });
  if (ativa) {
    return res.status(409).json({ erro: `Esse CT-e já tem a carta frete nº ${ativa.numero}. Cancele-a antes de emitir outra.` });
  }

  const { faltando, dados } = await montarDados(cte);
  if (faltando.length) return res.status(422).json({ erro: "Faltam dados para a carta frete", detalhe: faltando.join(" | ") });

  const peso = Number(req.body.pesoToneladas);
  const valorTonelada = Number(req.body.valorPorTonelada);
  if (!(peso > 0)) return res.status(400).json({ erro: "Informe o peso em toneladas" });
  if (!(valorTonelada > 0)) return res.status(400).json({ erro: "Informe o valor por tonelada" });

  const valores = {};
  for (const campo of VALORES) {
    const v = Number(req.body[campo] || 0);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ erro: `Valor inválido em ${campo}` });
    valores[campo] = arredondar(v);
  }

  // Valores calculados saem daqui, nunca da tela.
  const valorDocumento = arredondar(peso * valorTonelada);
  const valorLiquido = arredondar(
    valorDocumento
    + CREDITOS.reduce((t, c) => t + valores[c], 0)
    - DEBITOS.reduce((t, c) => t + valores[c], 0)
  );
  if (valorLiquido < 0) return res.status(400).json({ erro: "Os descontos passam do valor do frete" });

  // Coleta e entrega podem ser ajustadas na tela (a sugestão vem do CT-e).
  if (req.body.coleta) dados.coleta = String(req.body.coleta).trim();
  if (req.body.entrega) dados.entrega = String(req.body.entrega).trim();

  const carta = await prisma.$transaction(async (tx) => {
    const empresa = await tx.empresa.update({
      where: { id: cte.empresaId },
      data: { cartaFreteProximoNumero: { increment: 1 } },
    });
    return tx.cartaFrete.create({
      data: {
        numero: empresa.cartaFreteProximoNumero - 1,
        empresaId: cte.empresaId,
        cteId: cte.id,
        dados,
        pesoToneladas: arredondar(peso),
        valorPorTonelada: arredondar(valorTonelada),
        valorDocumento,
        valorLiquido,
        ...valores,
        observacoes: req.body.observacoes ? String(req.body.observacoes).trim() : null,
        criadoPorId: req.usuario.id,
      },
    });
  });

  res.status(201).json(carta);
}));

// Cancelar não apaga: o número fica registrado, e uma carta assinada nunca
// some do histórico.
router.post("/:id/cancelar", asyncHandler(async (req, res) => {
  const carta = await prisma.cartaFrete.findUnique({ where: { id: Number(req.params.id) } });
  if (!carta || carta.empresaId !== req.usuario.empresaId) return res.status(404).json({ erro: "Carta frete não encontrada" });
  if (carta.status === "cancelada") return res.status(409).json({ erro: "Essa carta já está cancelada" });
  const atualizada = await prisma.cartaFrete.update({ where: { id: carta.id }, data: { status: "cancelada" } });
  res.json(atualizada);
}));

module.exports = router;

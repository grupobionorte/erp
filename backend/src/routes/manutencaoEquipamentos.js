const express = require("express");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const { hojeNoFuso, diaDoCampo } = require("../lib/fuso");
const { gerarXlsx } = require("../lib/xlsx");

const router = express.Router();

/* ---------------------------------------------------------------------------
   Manutenção de equipamentos.

   O cálculo de "quando vence a próxima" fica aqui, e não na tela: é a mesma
   conta para a listagem, para o painel e para qualquer aviso que venha
   depois. Duas implementações divergiriam no primeiro ajuste.
--------------------------------------------------------------------------- */

const UNIDADE = { horimetro: "h", hodometro: "km", prazo: "meses" };

const incluirEquipamento = {
  planos: { where: { ativo: true }, orderBy: { descricao: "asc" } },
  veiculo: { select: { id: true, placa: true } },
  // Operação em que o equipamento está agora (alocação sem saída).
  alocacoes: { where: { dataSaida: null }, select: { operacao: { select: { id: true, codigo: true, descricao: true } } } },
  socios: {
    select: { id: true, percentual: true, fornecedorId: true, fornecedor: { select: { id: true, nomeRazaoSocial: true, documento: true } } },
    orderBy: { id: "asc" },
  },
};

// Código é opcional, mas não se repete na empresa: é por ele que o
// equipamento é chamado no dia a dia.
async function codigoEmUso(codigo, empresaId, ignorarId) {
  if (!codigo) return null;
  return prisma.equipamento.findFirst({
    where: {
      codigo: { equals: codigo, mode: "insensitive" },
      empresaId: empresaId || undefined,
      ativo: true,
      id: ignorarId ? { not: ignorarId } : undefined,
    },
    select: { nome: true },
  });
}
const limparCodigo = (v) => (v === undefined ? undefined : (String(v || "").trim().toUpperCase() || null));

/**
 * Situação de um plano: quanto falta para vencer, e se já passou.
 *
 * Em horímetro e hodômetro a conta é por leitura; em prazo, por data. Quando
 * o plano nunca foi executado, a base é a leitura atual ou a data de hoje —
 * o primeiro serviço passa a contar a partir de agora, em vez de aparecer
 * como vencido desde sempre.
 */
function situacaoDoPlano(plano, equipamento) {
  if (equipamento.controle !== "prazo") {
    const atual = Number(equipamento.leituraAtual) || 0;
    const base = plano.ultimaLeitura ?? atual;
    const proxima = base + Number(plano.intervalo);
    const falta = proxima - atual;

    return {
      tipo: "leitura",
      unidade: UNIDADE[equipamento.controle],
      proxima,
      falta,
      vencida: falta <= 0,
      proximo: falta > 0 && falta <= (plano.antecedencia ?? Number(plano.intervalo) * 0.1),
      // Sem leitura cadastrada não dá para dizer nada — e dizer "vencida"
      // seria pior do que admitir que falta informação.
      semLeitura: equipamento.leituraAtual == null,
    };
  }

  // Dias contados de meio-dia a meio-dia, a partir do dia de Cuiabá: com a
  // hora do servidor, o plano virava "vencido" no meio da noite.
  const hoje = new Date(`${hojeNoFuso()}T12:00:00Z`);
  const base = plano.ultimaData ? new Date(plano.ultimaData) : hoje;
  const proxima = new Date(base);
  proxima.setUTCMonth(proxima.getUTCMonth() + Number(plano.intervalo));
  const faltaDias = Math.round((proxima - hoje) / 86400000);

  return {
    tipo: "prazo",
    unidade: "dias",
    proximaData: proxima,
    falta: faltaDias,
    vencida: faltaDias <= 0,
    proximo: faltaDias > 0 && faltaDias <= (plano.antecedencia ?? 15),
    semLeitura: false,
  };
}

function comSituacao(equipamento) {
  const planos = (equipamento.planos || []).map((p) => ({ ...p, situacao: situacaoDoPlano(p, equipamento) }));
  return {
    ...equipamento,
    planos,
    alerta: planos.some((p) => p.situacao.vencida && !p.situacao.semLeitura)
      ? "vencida"
      : planos.some((p) => p.situacao.proximo) ? "proxima" : null,
  };
}

const prepararPlanos = (planos) =>
  (planos || [])
    .filter((p) => p.descricao && p.intervalo)
    .map((p) => ({
      descricao: String(p.descricao).trim(),
      intervalo: Number(p.intervalo),
      antecedencia: p.antecedencia ? Number(p.antecedencia) : undefined,
      ultimaLeitura: p.ultimaLeitura !== undefined && p.ultimaLeitura !== "" ? Number(p.ultimaLeitura) : undefined,
      ultimaData: p.ultimaData ? new Date(`${String(p.ultimaData).slice(0, 10)}T12:00:00Z`) : undefined,
    }));

// ---------------------------------------------------------------------------
// Equipamentos
// ---------------------------------------------------------------------------
router.get("/equipamentos", asyncHandler(async (req, res) => {
  const equipamentos = await prisma.equipamento.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ativo: req.query.inativos === "1" ? undefined : true,
    },
    include: incluirEquipamento,
  });

  // Ordem alfabética pelo nome (pedido do Leandro), feita aqui e não no
  // banco: o português põe "Éder" junto de "Eder" e "Picador 2" antes de
  // "Picador 10", o que a ordenação do banco não faz.
  const comAlerta = equipamentos
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base", numeric: true }))
    .map(comSituacao);

  res.json({
    equipamentos: comAlerta,
    totais: {
      equipamentos: comAlerta.length,
      vencidas: comAlerta.filter((e) => e.alerta === "vencida").length,
      proximas: comAlerta.filter((e) => e.alerta === "proxima").length,
    },
  });
}));

// Aquisição: dia (ao meio-dia UTC, como as datas dos planos), valor e %
// de depreciação. Vazio limpa; ausente não mexe. Valem na criação e na
// edição — campo que a edição esquece de gravar já custou caro aqui.
function dadosDeAquisicao(body) {
  const numero = (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v));
  const dia = body.dataAquisicao;
  const dados = {
    // Lista fechada: valor desconhecido não entra (fica o que já era).
    propriedade: ["proprio", "alugado", "sociedade"].includes(body.propriedade) ? body.propriedade : undefined,
    dataAquisicao: dia === undefined ? undefined
      : dia ? new Date(`${String(dia).slice(0, 10)}T12:00:00Z`) : null,
    valorAquisicao: numero(body.valorAquisicao),
    percentualDepreciacao: numero(body.percentualDepreciacao),
  };
  if (dados.valorAquisicao != null && !(dados.valorAquisicao >= 0)) return { erro: "Valor de aquisição inválido" };
  if (dados.percentualDepreciacao != null && !(dados.percentualDepreciacao >= 0 && dados.percentualDepreciacao <= 100)) {
    return { erro: "A depreciação vai de 0 a 100% ao ano" };
  }
  return { dados };
}

/**
 * Sócios do equipamento em sociedade: fornecedores da empresa, cada um com
 * a sua parte. A soma não passa de 100% (o que sobra é da empresa) e o
 * mesmo sócio não aparece duas vezes. Devolve a lista pronta para gravar,
 * ou o erro em português.
 */
async function sociosValidos(body, req) {
  const lista = Array.isArray(body.socios) ? body.socios : [];
  if (!lista.length) return { erro: "Informe pelo menos um sócio da sociedade" };
  if (lista.length > 20) return { erro: "No máximo 20 sócios" };
  const socios = [];
  for (const [i, s] of lista.entries()) {
    const fornecedorId = Number(s.fornecedorId);
    const percentual = Number(s.percentual);
    if (!fornecedorId) return { erro: `Escolha o ${i + 1}º sócio no cadastro de fornecedores` };
    if (!(percentual > 0 && percentual <= 100)) return { erro: `Informe o percentual do ${i + 1}º sócio (de 0 a 100%)` };
    if (socios.some((x) => x.fornecedorId === fornecedorId)) return { erro: "O mesmo sócio aparece duas vezes" };
    socios.push({ fornecedorId, percentual: Math.round(percentual * 100) / 100 });
  }
  const soma = socios.reduce((t, x) => t + x.percentual, 0);
  if (soma > 100.001) return { erro: `A soma dos percentuais dos sócios dá ${soma.toLocaleString("pt-BR")}%, passa de 100%` };
  const achados = await prisma.pessoa.findMany({
    where: {
      id: { in: socios.map((x) => x.fornecedorId) }, papel: "fornecedor",
      OR: [{ empresaId: req.usuario.empresaId ?? undefined }, { empresaId: null }],
    },
    select: { id: true },
  });
  if (achados.length !== socios.length) return { erro: "Sócio não encontrado no cadastro de fornecedores" };
  return { socios };
}

// Fornecedores para escolher os sócios. Vem por aqui porque quem cadastra
// equipamento não precisa ter o menu de fornecedores.
router.get("/equipamentos-fornecedores", asyncHandler(async (req, res) => {
  const empresaId = req.usuario.empresaId;
  res.json(await prisma.pessoa.findMany({
    where: { ativo: true, papel: "fornecedor", OR: [{ empresaId: empresaId ?? undefined }, { empresaId: null }] },
    select: { id: true, nomeRazaoSocial: true, documento: true },
    orderBy: { nomeRazaoSocial: "asc" },
  }));
}));

router.post("/equipamentos", asyncHandler(async (req, res) => {
  const {
    nome, planos, veiculoId, leituraAtual, alocacoes, codigo: codigoBruto,
    dataAquisicao, valorAquisicao, percentualDepreciacao, propriedade, socios: _socios, ...dados
  } = req.body;
  if (!nome) return res.status(400).json({ erro: "Informe o nome do equipamento" });
  const aquisicao = dadosDeAquisicao(req.body);
  if (aquisicao.erro) return res.status(400).json({ erro: aquisicao.erro });
  let socios = [];
  if (aquisicao.dados.propriedade === "sociedade") {
    const v = await sociosValidos(req.body, req);
    if (v.erro) return res.status(400).json({ erro: v.erro });
    socios = v.socios;
  }
  const codigo = limparCodigo(codigoBruto);
  const repetido = await codigoEmUso(codigo, req.usuario.empresaId);
  if (repetido) return res.status(409).json({ erro: `O código ${codigo} já é do equipamento ${repetido.nome}` });

  const temLeitura = leituraAtual !== undefined && leituraAtual !== "" && leituraAtual !== null;

  const equipamento = await prisma.equipamento.create({
    data: {
      ...dados,
      ...aquisicao.dados,
      nome,
      codigo: codigo || undefined,
      ano: dados.ano ? Number(dados.ano) : undefined,
      leituraAtual: temLeitura ? Number(leituraAtual) : undefined,
      leituraAtualizada: temLeitura ? new Date() : undefined,
      veiculoId: veiculoId ? Number(veiculoId) : undefined,
      empresaId: req.usuario.empresaId || undefined,
      planos: prepararPlanos(planos).length ? { create: prepararPlanos(planos) } : undefined,
      socios: socios.length ? { create: socios } : undefined,
    },
    include: incluirEquipamento,
  });

  res.status(201).json(comSituacao(equipamento));
}));

router.put("/equipamentos/:id", asyncHandler(async (req, res) => {
  const {
    planos, veiculoId, empresaId, leituraAtual, alocacoes, codigo: codigoBruto,
    dataAquisicao, valorAquisicao, percentualDepreciacao, propriedade, socios: _socios, ...dados
  } = req.body;
  const id = Number(req.params.id);
  const aquisicao = dadosDeAquisicao(req.body);
  if (aquisicao.erro) return res.status(400).json({ erro: aquisicao.erro });
  // Sócios são substituídos por inteiro, como os planos. Deixou de ser
  // sociedade: os sócios saem.
  let socios = null;
  if (aquisicao.dados.propriedade === "sociedade") {
    const v = await sociosValidos(req.body, req);
    if (v.erro) return res.status(400).json({ erro: v.erro });
    socios = v.socios;
  } else if (aquisicao.dados.propriedade) {
    socios = [];
  }
  const codigo = limparCodigo(codigoBruto);
  const repetido = await codigoEmUso(codigo, req.usuario.empresaId, id);
  if (repetido) return res.status(409).json({ erro: `O código ${codigo} já é do equipamento ${repetido.nome}` });

  // Planos são substituídos por inteiro quando informados, como em outros
  // conjuntos do sistema: é mais previsível do que casar o que mudou.
  if (Array.isArray(planos)) {
    await prisma.planoManutencao.deleteMany({ where: { equipamentoId: id } });
  }

  const temLeitura = leituraAtual !== undefined && leituraAtual !== "" && leituraAtual !== null;

  // Só agora, com tudo conferido: recusa (código repetido, etc.) não pode
  // deixar o equipamento sem os sócios que tinha.
  if (socios) await prisma.equipamentoSocio.deleteMany({ where: { equipamentoId: id } });

  const equipamento = await prisma.equipamento.update({
    where: { id },
    data: {
      ...dados,
      ...aquisicao.dados,
      codigo,
      ano: dados.ano ? Number(dados.ano) : undefined,
      leituraAtual: temLeitura ? Number(leituraAtual) : undefined,
      leituraAtualizada: temLeitura ? new Date() : undefined,
      veiculoId: veiculoId === null || veiculoId === "" ? null : (veiculoId ? Number(veiculoId) : undefined),
      planos: Array.isArray(planos) && prepararPlanos(planos).length
        ? { create: prepararPlanos(planos) }
        : undefined,
      socios: socios?.length ? { create: socios } : undefined,
    },
    include: incluirEquipamento,
  });

  res.json(comSituacao(equipamento));
}));

// Atualizar a leitura é a operação mais repetida: o horímetro anda todo dia.
router.post("/equipamentos/:id/leitura", asyncHandler(async (req, res) => {
  const leitura = Number(req.body?.leitura);
  if (!Number.isFinite(leitura)) return res.status(400).json({ erro: "Informe a leitura" });

  const equipamento = await prisma.equipamento.findUnique({ where: { id: Number(req.params.id) } });
  if (!equipamento) return res.status(404).json({ erro: "Equipamento não encontrado" });

  // Horímetro e hodômetro não voltam. Avisar é melhor do que gravar um
  // número que bagunça todos os cálculos de vencimento.
  if (equipamento.leituraAtual != null && leitura < equipamento.leituraAtual) {
    return res.status(409).json({
      erro: "A leitura informada é menor que a atual",
      detalhe: `O equipamento está em ${equipamento.leituraAtual}. Se o aparelho foi trocado ou zerado, ajuste pelo cadastro.`,
    });
  }

  const atualizado = await prisma.equipamento.update({
    where: { id: equipamento.id },
    data: { leituraAtual: leitura, leituraAtualizada: new Date() },
    include: incluirEquipamento,
  });

  res.json(comSituacao(atualizado));
}));

router.delete("/equipamentos/:id", asyncHandler(async (req, res) => {
  await prisma.equipamento.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Ordens de manutenção
// ---------------------------------------------------------------------------
const incluirOrdem = {
  equipamento: { select: { id: true, nome: true, controle: true } },
  plano: { select: { id: true, descricao: true } },
  responsavel: { select: { id: true, nome: true } },
};

router.get("/ordens", asyncHandler(async (req, res) => {
  const { equipamentoId, de, ate } = req.query;

  const ordens = await prisma.ordemManutencao.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ...(equipamentoId ? { equipamentoId: Number(equipamentoId) } : {}),
      ...(de || ate ? {
        data: {
          ...(de ? { gte: new Date(`${de}T00:00:00`) } : {}),
          ...(ate ? { lte: new Date(`${ate}T23:59:59`) } : {}),
        },
      } : {}),
    },
    include: incluirOrdem,
    orderBy: { data: "desc" },
    take: 300,
  });

  const custo = (o) => (Number(o.custoPecas) || 0) + (Number(o.custoServico) || 0);

  res.json({
    ordens,
    totais: {
      quantidade: ordens.length,
      custoTotal: ordens.reduce((t, o) => t + custo(o), 0),
      pecas: ordens.reduce((t, o) => t + (Number(o.custoPecas) || 0), 0),
      servico: ordens.reduce((t, o) => t + (Number(o.custoServico) || 0), 0),
    },
  });
}));

router.post("/ordens", asyncHandler(async (req, res) => {
  const { equipamentoId, data, descricao, leitura, planoId, responsavelId, ...dados } = req.body;

  if (!equipamentoId || !data || !descricao) {
    return res.status(400).json({ erro: "Informe equipamento, data e descrição" });
  }

  const ordem = await prisma.ordemManutencao.create({
    data: {
      ...dados,
      descricao,
      data: new Date(`${String(data).slice(0, 10)}T12:00:00Z`),
      leitura: leitura !== undefined && leitura !== "" ? Number(leitura) : undefined,
      custoPecas: dados.custoPecas ? Number(dados.custoPecas) : undefined,
      custoServico: dados.custoServico ? Number(dados.custoServico) : undefined,
      equipamentoId: Number(equipamentoId),
      planoId: planoId ? Number(planoId) : undefined,
      responsavelId: responsavelId ? Number(responsavelId) : undefined,
      empresaId: req.usuario.empresaId || undefined,
    },
    include: incluirOrdem,
  });

  // Registrar o serviço reposiciona o plano e atualiza a leitura do
  // equipamento. Sem isso, a pessoa teria que lembrar de fazer as duas
  // coisas à mão, e o aviso de vencimento nunca sairia do vermelho.
  if (ordem.planoId) {
    await prisma.planoManutencao.update({
      where: { id: ordem.planoId },
      data: { ultimaLeitura: ordem.leitura ?? undefined, ultimaData: ordem.data },
    });
  }

  if (ordem.leitura != null) {
    const equipamento = await prisma.equipamento.findUnique({ where: { id: ordem.equipamentoId } });
    if (equipamento && (equipamento.leituraAtual == null || ordem.leitura > equipamento.leituraAtual)) {
      await prisma.equipamento.update({
        where: { id: equipamento.id },
        data: { leituraAtual: ordem.leitura, leituraAtualizada: new Date() },
      });
    }
  }

  res.status(201).json(ordem);
}));

router.put("/ordens/:id", asyncHandler(async (req, res) => {
  const { equipamentoId, data, leitura, planoId, responsavelId, empresaId, ...dados } = req.body;

  res.json(await prisma.ordemManutencao.update({
    where: { id: Number(req.params.id) },
    data: {
      ...dados,
      data: data ? new Date(`${String(data).slice(0, 10)}T12:00:00Z`) : undefined,
      leitura: leitura !== undefined && leitura !== "" ? Number(leitura) : undefined,
      custoPecas: dados.custoPecas !== undefined ? (dados.custoPecas === "" ? null : Number(dados.custoPecas)) : undefined,
      custoServico: dados.custoServico !== undefined ? (dados.custoServico === "" ? null : Number(dados.custoServico)) : undefined,
      equipamentoId: equipamentoId ? Number(equipamentoId) : undefined,
      planoId: planoId === null || planoId === "" ? null : (planoId ? Number(planoId) : undefined),
      responsavelId: responsavelId === null || responsavelId === "" ? null : (responsavelId ? Number(responsavelId) : undefined),
    },
    include: incluirOrdem,
  }));
}));

router.delete("/ordens/:id", asyncHandler(async (req, res) => {
  await prisma.ordemManutencao.delete({ where: { id: Number(req.params.id) } });
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Ativo imobilizado
// ---------------------------------------------------------------------------

// Rótulos dos tipos para o relatório e a planilha (os mesmos da tela).
const TIPO_ROTULO = {
  picador: "Picador florestal", escavadeira: "Escavadeira", "pa-carregadeira": "Pá carregadeira",
  caminhao: "Caminhão", carro: "Carro", "cavalo-mecanico": "Cavalo mecânico", carreta: "Carreta",
  trator: "Trator", outro: "Outro",
};
const dois = (v) => Math.round((Number(v) || 0) * 100) / 100;
const comparaNome = (a, b) => String(a || "").localeCompare(String(b || ""), "pt-BR", { sensitivity: "base", numeric: true });

// Meses completos entre a aquisição e a posição: de 10/01 a 09/03 são 1
// mês; a 10/03, 2. É a regra da depreciação contábil, mês a mês.
function mesesCompletos(de, ate) {
  const [a1, m1, d1] = de.split("-").map(Number);
  const [a2, m2, d2] = ate.split("-").map(Number);
  return Math.max(0, (a2 - a1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/**
 * Ativo imobilizado dos equipamentos na data de posição. Depreciação linear
 * por mês completo: valor × % ao ano ÷ 12 × meses, até zerar. Alugado não é
 * patrimônio: vai numa lista à parte, sem valores. Sem data ou valor de
 * aquisição, também à parte, para completar o cadastro. Adquirido depois da
 * posição ainda não existia naquela data e fica de fora.
 */
async function montarAtivo(req) {
  const posicao = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.posicao || "")) ? req.query.posicao : hojeNoFuso();
  const filtro = ["proprio", "sociedade"].includes(req.query.propriedade) ? req.query.propriedade : "todos";
  const agrupar = req.query.agrupar !== "0";

  const [empresa, equipamentos] = await Promise.all([
    prisma.empresa.findUnique({ where: { id: req.usuario.empresaId }, select: { razaoSocial: true, cnpj: true } }),
    prisma.equipamento.findMany({
      where: { empresaId: req.usuario.empresaId || undefined, ativo: true },
      include: { veiculo: { select: { placa: true } }, socios: { include: { fornecedor: { select: { nomeRazaoSocial: true } } }, orderBy: { id: "asc" } } },
    }),
  ]);

  const linhas = [];
  const terceiros = [];
  const semDados = [];
  for (const e of equipamentos.sort((a, b) => comparaNome(a.nome, b.nome))) {
    const base = {
      id: e.id, codigo: e.codigo, nome: e.nome, tipo: TIPO_ROTULO[e.tipo] || "Outro",
      marcaModelo: [e.marca, e.modelo, e.ano].filter(Boolean).join(" "),
      seriePlaca: e.veiculo?.placa || e.identificacao || "",
      propriedade: e.propriedade,
    };
    if (e.propriedade === "alugado") { terceiros.push(base); continue; }
    if (filtro !== "todos" && e.propriedade !== filtro) continue;
    const aquisicao = e.dataAquisicao ? diaDoCampo(e.dataAquisicao) : null;
    if (!aquisicao || !(e.valorAquisicao > 0)) { semDados.push(base); continue; }
    if (aquisicao > posicao) continue;

    const valor = e.valorAquisicao;
    const pct = e.percentualDepreciacao || 0;
    const meses = mesesCompletos(aquisicao, posicao);
    const depreciacao = dois(Math.min(valor, (valor * pct) / 100 / 12 * meses));
    const atual = dois(valor - depreciacao);
    const socios = e.propriedade === "sociedade"
      ? e.socios.map((sc) => ({ nome: sc.fornecedor?.nomeRazaoSocial, percentual: sc.percentual, valor: dois((atual * sc.percentual) / 100) }))
      : [];
    const parte = dois(100 - socios.reduce((t, sc) => t + sc.percentual, 0));
    linhas.push({
      ...base, aquisicao, valorAquisicao: dois(valor), percentual: pct, meses, depreciacao, valorAtual: atual,
      totalmenteDepreciado: atual <= 0, parteEmpresa: parte, valorParte: dois((atual * parte) / 100), socios,
    });
  }

  const somar = (lista) => ({
    valorAquisicao: dois(lista.reduce((t, l) => t + l.valorAquisicao, 0)),
    depreciacao: dois(lista.reduce((t, l) => t + l.depreciacao, 0)),
    valorAtual: dois(lista.reduce((t, l) => t + l.valorAtual, 0)),
    valorParte: dois(lista.reduce((t, l) => t + l.valorParte, 0)),
  });
  const grupos = agrupar
    ? [...new Set(linhas.map((l) => l.tipo))].sort(comparaNome).map((tipo) => {
        const itens = linhas.filter((l) => l.tipo === tipo);
        return { tipo, itens, totais: somar(itens) };
      })
    : [{ tipo: null, itens: linhas, totais: somar(linhas) }];

  return { empresa, posicao, filtro, agrupar, grupos, totais: somar(linhas), quantidade: linhas.length, terceiros, semDados };
}

router.get("/equipamentos-ativo", asyncHandler(async (req, res) => {
  const r = await montarAtivo(req);
  if (req.query.formato !== "xlsx") return res.json(r);

  const dia = (d) => (d ? d.split("-").reverse().join("/") : "");
  const m = (v) => ({ v, estilo: "moeda" });
  const mN = (v) => ({ v, estilo: "moedaNegrito" });
  const N = (v) => ({ v, estilo: "negrito" });
  const cabecalho = ["Código", "Equipamento", "Tipo", "Marca / modelo / ano", "Série / placa", "Aquisição",
    "Valor de aquisição", "% a.a.", "Meses de uso", "Depreciação acumulada", "Valor atual", "Parte da empresa (%)", "Valor da parte da empresa"];
  const linhas = [
    [{ v: "Ativo imobilizado — equipamentos", estilo: "titulo" }],
    [`${r.empresa?.razaoSocial || ""} — CNPJ ${String(r.empresa?.cnpj || "").replace(/\D/g, "")}`],
    [`Posição em ${dia(r.posicao)}. Depreciação linear por mês completo.`],
    [],
    cabecalho.map(N),
  ];
  for (const g of r.grupos) {
    if (g.tipo) linhas.push([N(g.tipo)]);
    for (const l of g.itens) {
      linhas.push([l.codigo || "", l.nome, l.tipo, l.marcaModelo, l.seriePlaca, dia(l.aquisicao),
        m(l.valorAquisicao), { v: l.percentual, estilo: "numero" }, l.meses, m(l.depreciacao), m(l.valorAtual),
        { v: l.parteEmpresa, estilo: "numero" }, m(l.valorParte)]);
    }
    if (g.tipo) linhas.push(["", N(`Subtotal ${g.tipo}`), "", "", "", "", mN(g.totais.valorAquisicao), "", "", mN(g.totais.depreciacao), mN(g.totais.valorAtual), "", mN(g.totais.valorParte)]);
  }
  linhas.push([]);
  linhas.push(["", N(`Total geral (${r.quantidade} equipamento${r.quantidade === 1 ? "" : "s"})`), "", "", "", "", mN(r.totais.valorAquisicao), "", "", mN(r.totais.depreciacao), mN(r.totais.valorAtual), "", mN(r.totais.valorParte)]);

  const sociedades = [["Código", "Equipamento", "Valor atual", "Sócio", "Percentual", "Valor proporcional"].map(N)];
  for (const l of r.grupos.flatMap((g) => g.itens).filter((x) => x.socios.length)) {
    sociedades.push([l.codigo || "", l.nome, m(l.valorAtual), "Empresa", { v: l.parteEmpresa, estilo: "numero" }, m(l.valorParte)]);
    for (const sc of l.socios) sociedades.push(["", "", "", sc.nome, { v: sc.percentual, estilo: "numero" }, m(sc.valor)]);
  }
  const fora = [["Situação", "Código", "Equipamento", "Tipo", "Marca / modelo / ano"].map(N),
    ...r.terceiros.map((l) => ["Alugado (de terceiros)", l.codigo || "", l.nome, l.tipo, l.marcaModelo]),
    ...r.semDados.map((l) => ["Sem data ou valor de aquisição", l.codigo || "", l.nome, l.tipo, l.marcaModelo])];

  const arquivo = await gerarXlsx([
    { nome: "Ativo imobilizado", linhas, larguras: [10, 42, 18, 26, 16, 12, 18, 8, 8, 20, 18, 12, 20] },
    { nome: "Sociedades", linhas: sociedades, larguras: [10, 42, 18, 40, 12, 20] },
    { nome: "Fora do ativo", linhas: fora, larguras: [30, 10, 42, 18, 26] },
  ]);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Ativo-imobilizado-${r.posicao}.xlsx"`);
  res.send(arquivo);
}));

module.exports = router;

const crypto = require("crypto");
const express = require("express");

const prisma = require("../lib/prisma");
const { hojeNoFuso } = require("../lib/fuso");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

/* ---------------------------------------------------------------------------
   Contas a pagar.

   Parcelamento e recorrência são resolvidos na criação: cada parcela ou mês
   vira um registro próprio, com seu vencimento e sua baixa. É assim que a
   cobrança acontece, e dispensa uma rotina automática rodando no servidor —
   que seria mais uma coisa para quebrar em silêncio.
--------------------------------------------------------------------------- */

const incluir = {
  fornecedor: { select: { id: true, nomeRazaoSocial: true, documento: true } },
  categoria: { select: { id: true, nome: true } },
  centroCusto: { select: { id: true, nome: true } },
  operacao: { select: { id: true, codigo: true, descricao: true } },
};

// "sem" = despesas gerais, sem operação; número = só daquela operação.
function filtroOperacao(operacaoId) {
  if (operacaoId === "sem") return { operacaoId: null };
  if (operacaoId) return { operacaoId: Number(operacaoId) };
  return {};
}

// Soma meses preservando o fim do mês: vencimento dia 31 em fevereiro cai
// no último dia, não no dia 3 de março.
function somarMeses(data, meses) {
  const d = new Date(data);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimoDia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimoDia));
  return d;
}

// ---------------------------------------------------------------------------
// Categorias de despesa
// ---------------------------------------------------------------------------
router.get("/categorias", asyncHandler(async (req, res) => {
  res.json(await prisma.categoriaDespesa.findMany({
    where: { empresaId: req.usuario.empresaId || undefined, ativo: req.query.inativas === "1" ? undefined : true },
    orderBy: { nome: "asc" },
  }));
}));

router.post("/categorias", asyncHandler(async (req, res) => {
  if (!req.body.nome) return res.status(400).json({ erro: "Informe o nome da categoria" });
  res.status(201).json(await prisma.categoriaDespesa.create({
    data: { nome: req.body.nome, empresaId: req.usuario.empresaId || undefined },
  }));
}));

router.put("/categorias/:id", asyncHandler(async (req, res) => {
  const { empresaId, ...dados } = req.body;
  res.json(await prisma.categoriaDespesa.update({ where: { id: Number(req.params.id) }, data: dados }));
}));

router.delete("/categorias/:id", asyncHandler(async (req, res) => {
  await prisma.categoriaDespesa.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Centros de custo
// ---------------------------------------------------------------------------
router.get("/centros-custo", asyncHandler(async (req, res) => {
  res.json(await prisma.centroCusto.findMany({
    where: { empresaId: req.usuario.empresaId || undefined, ativo: req.query.inativas === "1" ? undefined : true },
    include: { veiculo: { select: { id: true, placa: true } } },
    orderBy: { nome: "asc" },
  }));
}));

router.post("/centros-custo", asyncHandler(async (req, res) => {
  const { nome, veiculoId } = req.body;
  if (!nome) return res.status(400).json({ erro: "Informe o nome do centro de custo" });
  res.status(201).json(await prisma.centroCusto.create({
    data: {
      nome,
      veiculoId: veiculoId ? Number(veiculoId) : undefined,
      empresaId: req.usuario.empresaId || undefined,
    },
    include: { veiculo: { select: { id: true, placa: true } } },
  }));
}));

router.put("/centros-custo/:id", asyncHandler(async (req, res) => {
  const { empresaId, veiculoId, ...dados } = req.body;
  res.json(await prisma.centroCusto.update({
    where: { id: Number(req.params.id) },
    data: {
      ...dados,
      veiculoId: veiculoId === null || veiculoId === "" ? null : (veiculoId ? Number(veiculoId) : undefined),
    },
    include: { veiculo: { select: { id: true, placa: true } } },
  }));
}));

router.delete("/centros-custo/:id", asyncHandler(async (req, res) => {
  await prisma.centroCusto.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------
router.get("/", asyncHandler(async (req, res) => {
  const { de, ate, status, fornecedorId, categoriaId, centroCustoId, operacaoId } = req.query;

  const contas = await prisma.contaPagar.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ...(status && status !== "todas" ? { status } : {}),
      ...(de || ate ? {
        vencimento: {
          ...(de ? { gte: new Date(`${de}T00:00:00`) } : {}),
          ...(ate ? { lte: new Date(`${ate}T23:59:59`) } : {}),
        },
      } : {}),
      ...(fornecedorId ? { fornecedorId: Number(fornecedorId) } : {}),
      ...(categoriaId ? { categoriaId: Number(categoriaId) } : {}),
      ...(centroCustoId ? { centroCustoId: Number(centroCustoId) } : {}),
      ...filtroOperacao(operacaoId),
    },
    include: incluir,
    orderBy: [{ vencimento: "asc" }, { id: "asc" }],
    take: 500,
  });

  // Resumo do que importa na rotina: o que já venceu e o que vence logo.
  // Vencimento é gravado ao meio-dia UTC; "hoje" é o dia de Cuiabá no mesmo
  // horário. Pelo relógio do servidor, depois das 20h a conta que vence
  // hoje já contava como atrasada.
  const hoje = new Date(`${hojeNoFuso()}T12:00:00Z`);
  const daquiSeteDias = new Date(hoje);
  daquiSeteDias.setUTCDate(daquiSeteDias.getUTCDate() + 7);

  const abertas = contas.filter((c) => c.status === "aberta");
  const somar = (lista) => lista.reduce((t, c) => t + (Number(c.valor) || 0), 0);

  res.json({
    contas,
    totais: {
      abertas: somar(abertas),
      atrasadas: somar(abertas.filter((c) => new Date(c.vencimento) < hoje)),
      proximosSeteDias: somar(abertas.filter((c) => {
        const v = new Date(c.vencimento);
        return v >= hoje && v <= daquiSeteDias;
      })),
      pagas: somar(contas.filter((c) => c.status === "paga")),
      quantidade: contas.length,
    },
  });
}));

router.post("/", asyncHandler(async (req, res) => {
  const {
    descricao, valor, vencimento, competencia, fornecedorId, categoriaId, centroCustoId,
    operacaoId, documento, observacao,
    // Repetição: "parcelado" divide o valor; "mensal" repete o mesmo valor.
    repeticao, quantidade,
    // Conta que já nasce paga: acontece quando o lançamento é feito depois
    // do pagamento, que é o caso comum de despesa do dia a dia.
    dataPagamento, valorPago, jurosMulta, desconto, formaPagamento,
  } = req.body;

  if (!descricao || !valor || !vencimento) {
    return res.status(400).json({ erro: "Informe descrição, valor e vencimento" });
  }

  // A quantidade só vale para parcelado e mensal. A tela manda o número do
  // campo (2 por padrão) mesmo na conta única, e usá-lo ali gravava a conta
  // em dobro.
  const repete = repeticao === "parcelado" || repeticao === "mensal";
  const vezes = repete ? Math.max(1, Math.min(Number(quantidade) || 1, 60)) : 1;
  const parcelado = repeticao === "parcelado" && vezes > 1;
  const mensal = repeticao === "mensal" && vezes > 1;
  const grupo = vezes > 1 ? crypto.randomUUID() : null;

  // No parcelamento a sobra de centavos vai na primeira parcela, para a soma
  // fechar com o valor total.
  const valorTotal = Number(valor);
  const valorParcela = parcelado ? Math.floor((valorTotal / vezes) * 100) / 100 : valorTotal;
  const sobra = parcelado ? Number((valorTotal - valorParcela * vezes).toFixed(2)) : 0;

  const base = {
    descricao,
    fornecedorId: fornecedorId ? Number(fornecedorId) : undefined,
    categoriaId: categoriaId ? Number(categoriaId) : undefined,
    centroCustoId: centroCustoId ? Number(centroCustoId) : undefined,
    operacaoId: operacaoId ? Number(operacaoId) : undefined,
    documento: documento || undefined,
    observacao: observacao || undefined,
    empresaId: req.usuario.empresaId || undefined,
    grupo,
  };

  // O pagamento informado no lançamento vale só para a primeira parcela —
  // as demais ainda vão vencer.
  const pagamento = dataPagamento ? {
    status: "paga",
    dataPagamento: new Date(`${String(dataPagamento).slice(0, 10)}T12:00:00Z`),
    valorPago: valorPago !== undefined && valorPago !== "" ? Number(valorPago) : undefined,
    jurosMulta: jurosMulta ? Number(jurosMulta) : undefined,
    desconto: desconto ? Number(desconto) : undefined,
    formaPagamento: formaPagamento || undefined,
  } : {};

  const registros = Array.from({ length: vezes }, (_, i) => ({
    ...base,
    valor: Number((valorParcela + (i === 0 ? sobra : 0)).toFixed(2)),
    vencimento: somarMeses(new Date(`${String(vencimento).slice(0, 10)}T12:00:00Z`), i),
    competencia: competencia ? somarMeses(new Date(`${String(competencia).slice(0, 10)}T12:00:00Z`), i) : undefined,
    parcelaNumero: vezes > 1 ? i + 1 : undefined,
    parcelaTotal: vezes > 1 ? vezes : undefined,
    descricao: vezes > 1 && parcelado ? `${descricao} (${i + 1}/${vezes})` : descricao,
    ...(i === 0 ? pagamento : {}),
  }));

  // Conta única é criada direto: buscar "a última criada" depois devolvia
  // a de outra empresa quando duas eram lançadas ao mesmo tempo.
  let criadas;
  if (grupo) {
    await prisma.contaPagar.createMany({ data: registros });
    criadas = await prisma.contaPagar.findMany({ where: { grupo }, include: incluir, orderBy: { vencimento: "asc" } });
  } else {
    criadas = [await prisma.contaPagar.create({ data: registros[0], include: incluir })];
  }

  res.status(201).json({
    contas: criadas,
    aviso: mensal ? `${vezes} meses lançados.` : parcelado ? `${vezes} parcelas lançadas.` : undefined,
  });
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const {
    empresaId, fornecedorId, categoriaId, centroCustoId, operacaoId, vencimento, competencia,
    dataPagamento, valorPago, jurosMulta, desconto,
    // Só existem no lançamento (parcelar/repetir). A tela manda junto na
    // edição, e repassados ao banco faziam toda edição falhar.
    repeticao, quantidade,
    ...dados
  } = req.body;

  // Informar a data de pagamento aqui equivale a dar baixa; limpar a data
  // devolve a conta para em aberto.
  const statusPeloPagamento = dataPagamento ? "paga" : (dataPagamento === "" || dataPagamento === null ? "aberta" : undefined);

  res.json(await prisma.contaPagar.update({
    where: { id: Number(req.params.id) },
    data: {
      ...dados,
      status: dados.status || statusPeloPagamento,
      valor: dados.valor !== undefined ? Number(dados.valor) : undefined,
      dataPagamento: dataPagamento
        ? new Date(`${String(dataPagamento).slice(0, 10)}T12:00:00Z`)
        : (dataPagamento === "" || dataPagamento === null ? null : undefined),
      valorPago: valorPago === "" || valorPago === null ? null : (valorPago !== undefined ? Number(valorPago) : undefined),
      jurosMulta: jurosMulta === "" || jurosMulta === null ? null : (jurosMulta !== undefined ? Number(jurosMulta) : undefined),
      desconto: desconto === "" || desconto === null ? null : (desconto !== undefined ? Number(desconto) : undefined),
      fornecedorId: fornecedorId === null || fornecedorId === "" ? null : (fornecedorId ? Number(fornecedorId) : undefined),
      categoriaId: categoriaId === null || categoriaId === "" ? null : (categoriaId ? Number(categoriaId) : undefined),
      centroCustoId: centroCustoId === null || centroCustoId === "" ? null : (centroCustoId ? Number(centroCustoId) : undefined),
      operacaoId: operacaoId === null || operacaoId === "" ? null : (operacaoId ? Number(operacaoId) : undefined),
      vencimento: vencimento ? new Date(`${String(vencimento).slice(0, 10)}T12:00:00Z`) : undefined,
      competencia: competencia ? new Date(`${String(competencia).slice(0, 10)}T12:00:00Z`) : undefined,
    },
    include: incluir,
  }));
}));

// Baixa: registra o pagamento. Fica separado da edição porque é a operação
// que a rotina repete, e porque ela muda o status.
router.post("/:id/pagar", asyncHandler(async (req, res) => {
  const { dataPagamento, valorPago, jurosMulta, desconto, formaPagamento } = req.body;

  const conta = await prisma.contaPagar.findUnique({ where: { id: Number(req.params.id) } });
  if (!conta) return res.status(404).json({ erro: "Conta não encontrada" });
  if (conta.status === "paga") return res.status(409).json({ erro: "Essa conta já está paga" });

  res.json(await prisma.contaPagar.update({
    where: { id: conta.id },
    data: {
      status: "paga",
      dataPagamento: dataPagamento ? new Date(`${String(dataPagamento).slice(0, 10)}T12:00:00Z`) : new Date(`${hojeNoFuso()}T12:00:00Z`),
      valorPago: valorPago !== undefined && valorPago !== "" ? Number(valorPago) : conta.valor,
      jurosMulta: jurosMulta ? Number(jurosMulta) : undefined,
      desconto: desconto ? Number(desconto) : undefined,
      formaPagamento: formaPagamento || undefined,
    },
    include: incluir,
  }));
}));

// Desfaz a baixa, para quando a baixa foi feita na conta errada.
router.post("/:id/estornar", asyncHandler(async (req, res) => {
  res.json(await prisma.contaPagar.update({
    where: { id: Number(req.params.id) },
    data: {
      status: "aberta",
      dataPagamento: null, valorPago: null, jurosMulta: null, desconto: null, formaPagamento: null,
    },
    include: incluir,
  }));
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const conta = await prisma.contaPagar.findUnique({ where: { id: Number(req.params.id) } });
  if (!conta) return res.status(404).json({ erro: "Conta não encontrada" });

  // Conta paga não se apaga: ela é o registro de uma saída de dinheiro.
  // Para corrigir, estorne a baixa antes.
  if (conta.status === "paga") {
    return res.status(409).json({
      erro: "Conta paga não pode ser excluída",
      detalhe: "Estorne o pagamento primeiro, se ele foi registrado por engano.",
    });
  }

  // Excluir uma parcela apaga só ela; ?grupo=1 apaga as demais em aberto do
  // mesmo lançamento.
  if (req.query.grupo === "1" && conta.grupo) {
    const { count } = await prisma.contaPagar.deleteMany({
      where: { grupo: conta.grupo, status: "aberta" },
    });
    return res.json({ removidas: count });
  }

  await prisma.contaPagar.delete({ where: { id: conta.id } });
  res.status(204).send();
}));

module.exports = router;

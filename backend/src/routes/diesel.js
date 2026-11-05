const crypto = require("crypto");
const express = require("express");
const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const { intervaloNoFuso } = require("../lib/fuso");
const { arredondar, situacaoDosTanques } = require("../lib/diesel");
const { somarMeses, dividirEmParcelas } = require("../lib/parcelas");

const router = express.Router();

// Data vinda da tela é só o dia: ao meio-dia no fuso da operação, como nas
// viagens, para o dia não escorregar conforme quem olha.
const dataDoDia = (valor) =>
  valor && /^\d{4}-\d{2}-\d{2}/.test(String(valor)) ? new Date(`${String(valor).slice(0, 10)}T12:00:00-04:00`) : null;
const texto = (v) => (v === undefined ? undefined : String(v || "").trim() || null);
const numero = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

const incluirMovimento = {
  tanque: { select: { id: true, nome: true } },
  fornecedor: { select: { id: true, nomeRazaoSocial: true } },
  equipamento: { select: { id: true, codigo: true, nome: true } },
  operacao: { select: { id: true, codigo: true, descricao: true } },
  producao: { select: { id: true, operacaoId: true, turno: true } },
  contas: {
    select: { id: true, status: true, valor: true, vencimento: true, parcelaNumero: true, parcelaTotal: true, categoriaId: true },
    orderBy: { vencimento: "asc" },
  },
};

async function tanqueDaEmpresa(id, req, { ativo = true } = {}) {
  if (!id) return null;
  return prisma.tanqueDiesel.findFirst({
    where: { id: Number(id), empresaId: req.usuario.empresaId, ...(ativo ? { ativo: true } : {}) },
  });
}

// ---------------------------------------------------------------- tanques

router.get("/tanques", asyncHandler(async (req, res) => {
  res.json(await situacaoDosTanques(req.usuario.empresaId, { incluirInativos: req.query.inativos === "1" }));
}));

function dadosDoTanque(body) {
  const capacidade = numero(body.capacidadeLitros);
  if (capacidade !== null && !(capacidade > 0)) return { erro: "Capacidade deve ser maior que zero" };
  return {
    dados: {
      nome: texto(body.nome),
      capacidadeLitros: capacidade,
      observacao: texto(body.observacao),
      ...(body.ativo !== undefined ? { ativo: Boolean(body.ativo) } : {}),
    },
  };
}

router.post("/tanques", asyncHandler(async (req, res) => {
  const { erro, dados } = dadosDoTanque(req.body);
  if (erro) return res.status(400).json({ erro });
  if (!dados.nome) return res.status(400).json({ erro: "Dê um nome ao tanque (ex.: Tanque da sede, Comboio)" });
  res.status(201).json(await prisma.tanqueDiesel.create({ data: { ...dados, empresaId: req.usuario.empresaId } }));
}));

// Tanque não se exclui: tem histórico. Desativado, sai das listas de escolha.
router.put("/tanques/:id", asyncHandler(async (req, res) => {
  const tanque = await tanqueDaEmpresa(req.params.id, req, { ativo: false });
  if (!tanque) return res.status(404).json({ erro: "Tanque não encontrado" });
  const { erro, dados } = dadosDoTanque(req.body);
  if (erro) return res.status(400).json({ erro });
  if (req.body.nome !== undefined && !dados.nome) return res.status(400).json({ erro: "O tanque precisa de um nome" });
  res.json(await prisma.tanqueDiesel.update({ where: { id: tanque.id }, data: dados }));
}));

// ------------------------------------------------------------- movimentos

router.get("/movimentos", asyncHandler(async (req, res) => {
  const { de, ate } = req.query;
  if (!de || !ate) return res.status(400).json({ erro: "Informe o período (de e ate)" });
  const { inicio, fim } = intervaloNoFuso(de, ate);
  const movimentos = await prisma.movimentoDiesel.findMany({
    where: {
      empresaId: req.usuario.empresaId,
      data: { gte: inicio, lte: fim },
      ...(req.query.tanqueId ? { tanqueId: Number(req.query.tanqueId) } : {}),
    },
    include: incluirMovimento,
    orderBy: [{ data: "desc" }, { id: "desc" }],
  });
  const soma = (tipo) => arredondar(movimentos.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.litros, 0));
  res.json({
    movimentos,
    totais: {
      entradas: soma("entrada"),
      saidas: soma("saida"),
      ajustes: soma("ajuste"),
      valorEntradas: arredondar(movimentos.filter((m) => m.tipo === "entrada").reduce((s, m) => s + (m.valorTotal || 0), 0)),
    },
  });
}));

// O que as telas de lançamento precisam para escolher: fornecedores,
// equipamentos e operações da empresa. Vem por aqui porque quem cuida do
// diesel não precisa ter os menus de cadastro.
router.get("/apoio", asyncHandler(async (req, res) => {
  const empresaId = req.usuario.empresaId;
  const [fornecedores, equipamentos, operacoes, categorias] = await Promise.all([
    // Mesmo critério do cadastro: os sem empresa (anteriores à separação
    // por empresa) continuam visíveis.
    prisma.pessoa.findMany({
      where: { ativo: true, papel: "fornecedor", OR: [{ empresaId }, { empresaId: null }] },
      select: { id: true, nomeRazaoSocial: true, documento: true },
      orderBy: { nomeRazaoSocial: "asc" },
    }),
    prisma.equipamento.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, codigo: true, nome: true },
      orderBy: [{ codigo: { sort: "asc", nulls: "last" } }, { nome: "asc" }],
    }),
    prisma.operacao.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, codigo: true, descricao: true },
      orderBy: { codigo: "asc" },
    }),
    prisma.categoriaDespesa.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);
  res.json({ fornecedores, equipamentos, operacoes, categorias });
}));

/**
 * Confere e monta entrada ou saída. Na entrada, o total é a conta de litros
 * por valor do litro, nunca digitado. Na saída, tem de dizer quem consumiu:
 * um equipamento ou, para quem não é cadastrado, o destino em texto.
 */
async function dadosDoMovimento(body, req) {
  const tipo = body.tipo;
  if (!["entrada", "saida"].includes(tipo)) return { erro: "Tipo deve ser entrada ou saída" };
  const tanque = await tanqueDaEmpresa(body.tanqueId, req);
  if (!tanque) return { erro: "Escolha o tanque" };
  const data = dataDoDia(body.data);
  if (!data) return { erro: "Informe a data" };
  const litros = numero(body.litros);
  if (!(litros > 0)) return { erro: "Informe os litros" };

  const dados = { tipo, data, litros: arredondar(litros), tanqueId: tanque.id, observacao: texto(body.observacao) };
  // Operação: na saída, onde foi consumido; na compra, para qual frente o
  // diesel foi comprado (é ela que recebe a conta a pagar).
  let operacaoId = null;
  if (body.operacaoId) {
    const o = await prisma.operacao.findFirst({ where: { id: Number(body.operacaoId), empresaId: req.usuario.empresaId } });
    if (!o) return { erro: "Operação não encontrada" };
    operacaoId = o.id;
  }
  if (tipo === "entrada") {
    const valorLitro = numero(body.valorLitro);
    if (valorLitro !== null && !(valorLitro > 0)) return { erro: "Valor do litro inválido" };
    let fornecedorId = null;
    if (body.fornecedorId) {
      const f = await prisma.pessoa.findFirst({
        where: { id: Number(body.fornecedorId), OR: [{ empresaId: req.usuario.empresaId }, { empresaId: null }] },
      });
      if (!f) return { erro: "Fornecedor não encontrado" };
      fornecedorId = f.id;
    }
    Object.assign(dados, {
      valorLitro: valorLitro === null ? null : arredondar(valorLitro, 4),
      valorTotal: valorLitro === null ? null : arredondar(litros * valorLitro),
      fornecedorId,
      documento: texto(body.documento),
      equipamentoId: null, operacaoId, destino: null,
    });
  } else {
    let equipamentoId = null;
    if (body.equipamentoId) {
      const e = await prisma.equipamento.findFirst({ where: { id: Number(body.equipamentoId), empresaId: req.usuario.empresaId } });
      if (!e) return { erro: "Equipamento não encontrado" };
      equipamentoId = e.id;
    }
    const destino = texto(body.destino);
    if (!equipamentoId && !destino) return { erro: "Diga quem abasteceu: o equipamento ou, se não for cadastrado, o destino" };
    Object.assign(dados, {
      equipamentoId, operacaoId, destino,
      valorLitro: null, valorTotal: null, fornecedorId: null, documento: null,
    });
  }
  return { dados, tanque };
}

/**
 * Contas a pagar da compra, uma por parcela, no mesmo formato das lançadas
 * no Contas a pagar (descrição com "1/3", sobra de centavos na primeira,
 * vencimentos mês a mês). Só sai de compra com valor: sem o R$/L não há o
 * que pagar.
 */
async function contasDaCompra(body, dados, tanque, req) {
  if (!body.gerarConta) return { contas: [] };
  if (!dados.valorTotal) return { erro: "Para gerar a conta a pagar, informe o valor do litro" };
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(body.vencimento || ""))) return { erro: "Informe o vencimento da conta a pagar" };
  const vezes = Math.max(1, Math.min(Number(body.parcelas) || 1, 24));
  let categoriaId = null;
  if (body.categoriaId) {
    const c = await prisma.categoriaDespesa.findFirst({ where: { id: Number(body.categoriaId), empresaId: req.usuario.empresaId } });
    if (!c) return { erro: "Categoria não encontrada" };
    categoriaId = c.id;
  }
  const nota = dados.documento ? (/^nf/i.test(dados.documento) ? dados.documento : `NF ${dados.documento}`) : null;
  const descricao = `Diesel ${String(dados.litros).replace(".", ",")} L${nota ? ` — ${nota}` : ""}`;
  // Vencimento ao meio-dia UTC, como no Contas a pagar: os filtros de lá
  // contam com isso.
  const primeiro = new Date(`${String(body.vencimento).slice(0, 10)}T12:00:00Z`);
  const valores = dividirEmParcelas(dados.valorTotal, vezes);
  const grupo = vezes > 1 ? crypto.randomUUID() : null;
  return {
    contas: valores.map((valor, i) => ({
      descricao: vezes > 1 ? `${descricao} (${i + 1}/${vezes})` : descricao,
      valor,
      vencimento: somarMeses(primeiro, i),
      fornecedorId: dados.fornecedorId,
      operacaoId: dados.operacaoId,
      categoriaId,
      documento: dados.documento,
      observacao: `Compra de diesel — ${tanque.nome}`,
      empresaId: req.usuario.empresaId,
      grupo,
      parcelaNumero: vezes > 1 ? i + 1 : null,
      parcelaTotal: vezes > 1 ? vezes : null,
    })),
  };
}

// Conta paga é dinheiro que já saiu: a compra que a gerou não muda mais por
// aqui. Para corrigir, estorna-se a baixa no Contas a pagar.
async function contaPagaDaCompra(movimentoId) {
  return prisma.contaPagar.findFirst({ where: { movimentoDieselId: movimentoId, status: "paga" } });
}

// Saldo que ficou: devolvido para a tela avisar quando a saída passou do que
// havia (lançamento fora de ordem, compra ainda não lançada).
async function saldoDepois(tanqueId, empresaId) {
  const [t] = await situacaoDosTanques(empresaId, { incluirInativos: true, tanqueIds: [tanqueId] });
  return t?.saldo ?? null;
}

router.post("/movimentos", asyncHandler(async (req, res) => {
  const { erro, dados, tanque } = await dadosDoMovimento(req.body, req);
  if (erro) return res.status(400).json({ erro });
  const { erro: erroConta, contas } = dados.tipo === "entrada" ? await contasDaCompra(req.body, dados, tanque, req) : { contas: [] };
  if (erroConta) return res.status(400).json({ erro: erroConta });
  // Compra e contas juntas: nunca uma sem a outra.
  const movimento = await prisma.$transaction(async (tx) => {
    const criado = await tx.movimentoDiesel.create({
      data: { ...dados, empresaId: req.usuario.empresaId, criadoPorId: req.usuario.id },
    });
    if (contas.length) await tx.contaPagar.createMany({ data: contas.map((c) => ({ ...c, movimentoDieselId: criado.id })) });
    return tx.movimentoDiesel.findUnique({ where: { id: criado.id }, include: incluirMovimento });
  });
  res.status(201).json({ ...movimento, saldoTanque: await saldoDepois(movimento.tanqueId, req.usuario.empresaId) });
}));

async function movimentoEditavel(id, req) {
  const m = await prisma.movimentoDiesel.findFirst({ where: { id: Number(id), empresaId: req.usuario.empresaId } });
  if (!m) return { erro: "Movimento não encontrado", status: 404 };
  // O abastecimento do boletim é do boletim: muda e some com ele, senão o
  // boletim e o diesel contariam histórias diferentes.
  if (m.producaoId) return { erro: "Esse abastecimento veio do boletim de produção: altere ou exclua por lá", status: 409 };
  return { m };
}

router.put("/movimentos/:id", asyncHandler(async (req, res) => {
  const { m, erro: erroM, status } = await movimentoEditavel(req.params.id, req);
  if (erroM) return res.status(status).json({ erro: erroM });
  if (m.tipo === "ajuste") return res.status(409).json({ erro: "Ajuste não se edita: exclua e faça a medição de novo" });
  if (await contaPagaDaCompra(m.id)) {
    return res.status(409).json({ erro: "Essa compra já tem parcela paga no Contas a pagar", detalhe: "Estorne a baixa lá antes de alterar a compra." });
  }
  const { erro, dados, tanque } = await dadosDoMovimento({ ...req.body, tipo: m.tipo }, req);
  if (erro) return res.status(400).json({ erro });
  const { erro: erroConta, contas } = m.tipo === "entrada" ? await contasDaCompra(req.body, dados, tanque, req) : { contas: [] };
  if (erroConta) return res.status(400).json({ erro: erroConta });
  // As contas em aberto são refeitas com os dados novos da compra: valor,
  // fornecedor e parcelas sempre batem com ela.
  const movimento = await prisma.$transaction(async (tx) => {
    await tx.movimentoDiesel.update({ where: { id: m.id }, data: dados });
    await tx.contaPagar.deleteMany({ where: { movimentoDieselId: m.id, status: "aberta" } });
    if (contas.length) await tx.contaPagar.createMany({ data: contas.map((c) => ({ ...c, movimentoDieselId: m.id })) });
    return tx.movimentoDiesel.findUnique({ where: { id: m.id }, include: incluirMovimento });
  });
  res.json({ ...movimento, saldoTanque: await saldoDepois(movimento.tanqueId, req.usuario.empresaId) });
}));

router.delete("/movimentos/:id", asyncHandler(async (req, res) => {
  const { m, erro, status } = await movimentoEditavel(req.params.id, req);
  if (erro) return res.status(status).json({ erro });
  if (await contaPagaDaCompra(m.id)) {
    return res.status(409).json({ erro: "Essa compra já tem parcela paga no Contas a pagar", detalhe: "Estorne a baixa lá antes de excluir a compra." });
  }
  // As parcelas em aberto vão junto: conta de compra que não existe mais
  // não deve continuar esperando pagamento.
  await prisma.$transaction([
    prisma.contaPagar.deleteMany({ where: { movimentoDieselId: m.id, status: "aberta" } }),
    prisma.movimentoDiesel.delete({ where: { id: m.id } }),
  ]);
  res.status(204).send();
}));

/**
 * Ajuste pela medição: a pessoa mede o tanque (régua, marcador) e digita o
 * que tem de fato. O sistema grava a diferença para o saldo do sistema,
 * com sinal. Assim ninguém precisa fazer conta de sobra ou falta.
 */
router.post("/ajuste", asyncHandler(async (req, res) => {
  const tanque = await tanqueDaEmpresa(req.body.tanqueId, req);
  if (!tanque) return res.status(400).json({ erro: "Escolha o tanque" });
  const data = dataDoDia(req.body.data);
  if (!data) return res.status(400).json({ erro: "Informe a data da medição" });
  const medido = numero(req.body.saldoMedido);
  if (medido === null || !(medido >= 0)) return res.status(400).json({ erro: "Informe quantos litros há no tanque" });
  const motivo = texto(req.body.observacao);
  if (!motivo) return res.status(400).json({ erro: "Diga o motivo do ajuste (ex.: medição de fim de mês)" });

  const [situacao] = await situacaoDosTanques(req.usuario.empresaId, { tanqueIds: [tanque.id] });
  const diferenca = arredondar(medido - situacao.saldo);
  if (!diferenca) return res.status(409).json({ erro: "O saldo medido é igual ao do sistema: não há o que ajustar" });

  const movimento = await prisma.movimentoDiesel.create({
    data: {
      tipo: "ajuste", data, litros: diferenca, tanqueId: tanque.id, observacao: motivo,
      empresaId: req.usuario.empresaId, criadoPorId: req.usuario.id,
    },
    include: incluirMovimento,
  });
  res.status(201).json({ ...movimento, saldoTanque: medido });
}));

module.exports = router;

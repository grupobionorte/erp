const express = require("express");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

// Data vinda da tela é só o dia; grava ao meio-dia no fuso da operação para
// o dia não escorregar conforme o fuso de quem olha.
const dataDoDia = (valor) =>
  valor ? new Date(`${String(valor).slice(0, 10)}T12:00:00-04:00`) : null;

router.get("/", asyncHandler(async (req, res) => {
  res.json(await prisma.operacao.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ativo: req.query.inativas === "1" ? undefined : true,
    },
    include: { fornecedor: { select: { id: true, nomeRazaoSocial: true, documento: true } } },
    orderBy: [{ dataInicio: "desc" }, { codigo: "asc" }],
  }));
}));

router.post("/", asyncHandler(async (req, res) => {
  const { codigo, descricao, dataInicio, dataFim, valorUnitarioMateriaPrima, fornecedorId } = req.body;
  if (!codigo || !descricao) {
    return res.status(400).json({ erro: "Informe o código e a descrição" });
  }

  res.status(201).json(await prisma.operacao.create({
    data: {
      codigo: String(codigo).trim(),
      descricao: String(descricao).trim(),
      dataInicio: dataDoDia(dataInicio) || undefined,
      dataFim: dataDoDia(dataFim) || undefined,
      valorUnitarioMateriaPrima: valorUnitarioMateriaPrima !== undefined && valorUnitarioMateriaPrima !== ""
        ? Number(valorUnitarioMateriaPrima) : undefined,
      fornecedorId: fornecedorId ? Number(fornecedorId) : undefined,
      empresaId: req.usuario.empresaId || undefined,
    },
  }));
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { codigo, descricao, dataInicio, dataFim, ativo, valorUnitarioMateriaPrima, fornecedorId } = req.body;

  res.json(await prisma.operacao.update({
    where: { id: Number(req.params.id) },
    data: {
      codigo: codigo !== undefined ? String(codigo).trim() : undefined,
      descricao: descricao !== undefined ? String(descricao).trim() : undefined,
      // Campo em branco limpa a data; ausente deixa como está.
      dataInicio: dataInicio === "" || dataInicio === null ? null : (dataInicio ? dataDoDia(dataInicio) : undefined),
      dataFim: dataFim === "" || dataFim === null ? null : (dataFim ? dataDoDia(dataFim) : undefined),
      ativo: typeof ativo === "boolean" ? ativo : undefined,
      valorUnitarioMateriaPrima: valorUnitarioMateriaPrima === "" || valorUnitarioMateriaPrima === null
        ? null
        : (valorUnitarioMateriaPrima !== undefined ? Number(valorUnitarioMateriaPrima) : undefined),
      fornecedorId: fornecedorId === "" || fornecedorId === null
        ? null
        : (fornecedorId !== undefined ? Number(fornecedorId) : undefined),
    },
  }));
}));

// Exclusão lógica, como nos demais cadastros: operação encerrada ainda é
// referência do que já aconteceu.
router.delete("/:id", asyncHandler(async (req, res) => {
  await prisma.operacao.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
  res.status(204).send();
}));

/* ---------------------------------------------------------------------------
   Viagens da operação.

   Os totais são calculados a partir das quantidades e dos valores
   unitários, e podem ser corrigidos à mão quando a realidade não fecha com
   a conta — é comum a descarga vir diferente do carregamento.
--------------------------------------------------------------------------- */

const numero = (valor) =>
  valor === "" || valor === null || valor === undefined ? null : Number(valor);

/**
 * Todos os valores da viagem saem de quatro números digitados: as duas
 * quantidades e os dois valores unitários, mais o preço da matéria-prima
 * que vem da operação.
 *
 * O cálculo mora aqui, no servidor. A tela mostra os mesmos valores
 * enquanto se digita, mas quem grava é este trecho — assim não existe a
 * possibilidade de a tela e o banco discordarem.
 */
function calcularTotais(dados, valorUnitarioMateriaPrima) {
  const quantidadeNf = numero(dados.quantidadeNf);
  const unitarioNf = numero(dados.valorUnitarioNf);
  const quantidadeDescarga = numero(dados.quantidadeDescarga);
  const unitarioTransporte = numero(dados.valorUnitarioTransporte);
  const unitarioMateriaPrima = numero(valorUnitarioMateriaPrima);

  const arredondar = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const multiplicar = (a, b) => (a != null && b != null ? arredondar(a * b) : null);

  // Nota fiscal: o que foi carregado.
  const totalNf = multiplicar(quantidadeNf, unitarioNf);

  // CT-e: documenta o que saiu, então usa a quantidade da nota.
  const totalTransporte = multiplicar(quantidadeNf, unitarioTransporte);

  // Custo real do frete: sobre o que efetivamente chegou.
  const custoTransporte = multiplicar(quantidadeDescarga, unitarioTransporte);

  // Receita: o que foi aceito na balança do destino.
  const totalServico = multiplicar(quantidadeDescarga, unitarioNf);

  // Matéria-prima: o preço da operação aplicado ao que chegou.
  const custoMateriaPrima = multiplicar(quantidadeDescarga, unitarioMateriaPrima);

  const lucro = totalServico != null
    ? arredondar(totalServico - (custoMateriaPrima || 0) - (custoTransporte || 0))
    : null;

  return { totalNf, totalTransporte, custoTransporte, totalServico, custoMateriaPrima, lucro };
}

function montarViagem(dados, valorUnitarioMateriaPrima) {
  const calculado = calcularTotais(dados, valorUnitarioMateriaPrima);

  return {
    dataLancamento: dataDoDia(dados.dataLancamento) || new Date(),
    numeroNf: dados.numeroNf || null,
    quantidadeNf: numero(dados.quantidadeNf),
    valorUnitarioNf: numero(dados.valorUnitarioNf),
    valorTotalNf: calculado.totalNf,

    dataCte: dataDoDia(dados.dataCte),
    numeroCte: dados.numeroCte || null,
    tomador: dados.tomador || null,
    placa: dados.placa ? String(dados.placa).toUpperCase() : null,
    valorUnitarioTransporte: numero(dados.valorUnitarioTransporte),
    valorTotalTransporte: calculado.totalTransporte,

    dataDescarga: dataDoDia(dados.dataDescarga),
    quantidadeDescarga: numero(dados.quantidadeDescarga),
    ticket: dados.ticket || null,

    custoTransporte: calculado.custoTransporte,
    valorTotalServico: calculado.totalServico,
    custoMateriaPrima: calculado.custoMateriaPrima,
    lucroBruto: calculado.lucro,

    observacao: dados.observacao || null,
  };
}

router.get("/:id/viagens", asyncHandler(async (req, res) => {
  const viagens = await prisma.viagemOperacao.findMany({
    where: { operacaoId: Number(req.params.id) },
    orderBy: [{ dataLancamento: "desc" }, { id: "desc" }],
  });

  const somar = (campo) => viagens.reduce((t, v) => t + (Number(v[campo]) || 0), 0);

  res.json({
    viagens,
    totais: {
      viagens: viagens.length,
      quantidadeNf: somar("quantidadeNf"),
      quantidadeDescarga: somar("quantidadeDescarga"),
      valorNf: somar("valorTotalNf"),
      transporte: somar("valorTotalTransporte"),
      custoTransporte: somar("custoTransporte"),
      servico: somar("valorTotalServico"),
      materiaPrima: somar("custoMateriaPrima"),
      lucro: somar("lucroBruto"),
    },
  });
}));

// O preço da matéria-prima é da operação, não da viagem: mudou o preço,
// mudam os lançamentos novos — os antigos guardam o custo da época.
async function precoMateriaPrima(operacaoId) {
  const operacao = await prisma.operacao.findUnique({
    where: { id: Number(operacaoId) },
    select: { valorUnitarioMateriaPrima: true },
  });
  return operacao?.valorUnitarioMateriaPrima ?? null;
}

router.post("/:id/viagens", asyncHandler(async (req, res) => {
  const preco = await precoMateriaPrima(req.params.id);
  res.status(201).json(await prisma.viagemOperacao.create({
    data: { ...montarViagem(req.body, preco), operacaoId: Number(req.params.id) },
  }));
}));

router.put("/:id/viagens/:viagemId", asyncHandler(async (req, res) => {
  const preco = await precoMateriaPrima(req.params.id);
  res.json(await prisma.viagemOperacao.update({
    where: { id: Number(req.params.viagemId) },
    data: montarViagem(req.body, preco),
  }));
}));

router.delete("/:id/viagens/:viagemId", asyncHandler(async (req, res) => {
  await prisma.viagemOperacao.delete({ where: { id: Number(req.params.viagemId) } });
  res.status(204).send();
}));

module.exports = router;

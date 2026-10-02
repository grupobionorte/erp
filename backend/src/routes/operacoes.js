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
    orderBy: [{ dataInicio: "desc" }, { codigo: "asc" }],
  }));
}));

router.post("/", asyncHandler(async (req, res) => {
  const { codigo, descricao, dataInicio, dataFim } = req.body;
  if (!codigo || !descricao) {
    return res.status(400).json({ erro: "Informe o código e a descrição" });
  }

  res.status(201).json(await prisma.operacao.create({
    data: {
      codigo: String(codigo).trim(),
      descricao: String(descricao).trim(),
      dataInicio: dataDoDia(dataInicio) || undefined,
      dataFim: dataDoDia(dataFim) || undefined,
      empresaId: req.usuario.empresaId || undefined,
    },
  }));
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { codigo, descricao, dataInicio, dataFim, ativo } = req.body;

  res.json(await prisma.operacao.update({
    where: { id: Number(req.params.id) },
    data: {
      codigo: codigo !== undefined ? String(codigo).trim() : undefined,
      descricao: descricao !== undefined ? String(descricao).trim() : undefined,
      // Campo em branco limpa a data; ausente deixa como está.
      dataInicio: dataInicio === "" || dataInicio === null ? null : (dataInicio ? dataDoDia(dataInicio) : undefined),
      dataFim: dataFim === "" || dataFim === null ? null : (dataFim ? dataDoDia(dataFim) : undefined),
      ativo: typeof ativo === "boolean" ? ativo : undefined,
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

function calcularTotais(dados) {
  const quantidadeNf = numero(dados.quantidadeNf);
  const unitarioNf = numero(dados.valorUnitarioNf);
  const quantidadeDescarga = numero(dados.quantidadeDescarga);
  const unitarioTransporte = numero(dados.valorUnitarioTransporte);

  const arredondar = (v) => (v == null ? null : Math.round(v * 100) / 100);

  // Total informado vence o calculado: quem digitou sabe de alguma coisa
  // que a conta não sabe.
  const totalNf = dados.valorTotalNf !== undefined && dados.valorTotalNf !== ""
    ? numero(dados.valorTotalNf)
    : (quantidadeNf != null && unitarioNf != null ? arredondar(quantidadeNf * unitarioNf) : null);

  // O frete costuma ser pago pelo que chegou, não pelo que saiu.
  const baseTransporte = quantidadeDescarga ?? quantidadeNf;
  const totalTransporte = dados.valorTotalTransporte !== undefined && dados.valorTotalTransporte !== ""
    ? numero(dados.valorTotalTransporte)
    : (baseTransporte != null && unitarioTransporte != null
        ? arredondar(baseTransporte * unitarioTransporte)
        : null);

  const totalServico = numero(dados.valorTotalServico);
  const custo = numero(dados.custoMateriaPrima);

  // Lucro bruto: o que o serviço rendeu menos a matéria-prima e o frete.
  const lucro = dados.lucroBruto !== undefined && dados.lucroBruto !== ""
    ? numero(dados.lucroBruto)
    : (totalServico != null
        ? arredondar(totalServico - (custo || 0) - (totalTransporte || 0))
        : null);

  return { totalNf, totalTransporte, lucro };
}

function montarViagem(dados) {
  const { totalNf, totalTransporte, lucro } = calcularTotais(dados);

  return {
    dataLancamento: dataDoDia(dados.dataLancamento) || new Date(),
    numeroNf: dados.numeroNf || null,
    quantidadeNf: numero(dados.quantidadeNf),
    valorUnitarioNf: numero(dados.valorUnitarioNf),
    valorTotalNf: totalNf,

    dataCte: dataDoDia(dados.dataCte),
    numeroCte: dados.numeroCte || null,
    tomador: dados.tomador || null,
    placa: dados.placa ? String(dados.placa).toUpperCase() : null,
    valorUnitarioTransporte: numero(dados.valorUnitarioTransporte),
    valorTotalTransporte: totalTransporte,

    dataDescarga: dataDoDia(dados.dataDescarga),
    quantidadeDescarga: numero(dados.quantidadeDescarga),
    ticket: dados.ticket || null,

    valorTotalServico: numero(dados.valorTotalServico),
    custoMateriaPrima: numero(dados.custoMateriaPrima),
    lucroBruto: lucro,

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
      servico: somar("valorTotalServico"),
      materiaPrima: somar("custoMateriaPrima"),
      lucro: somar("lucroBruto"),
    },
  });
}));

router.post("/:id/viagens", asyncHandler(async (req, res) => {
  res.status(201).json(await prisma.viagemOperacao.create({
    data: { ...montarViagem(req.body), operacaoId: Number(req.params.id) },
  }));
}));

router.put("/:id/viagens/:viagemId", asyncHandler(async (req, res) => {
  res.json(await prisma.viagemOperacao.update({
    where: { id: Number(req.params.viagemId) },
    data: montarViagem(req.body),
  }));
}));

router.delete("/:id/viagens/:viagemId", asyncHandler(async (req, res) => {
  await prisma.viagemOperacao.delete({ where: { id: Number(req.params.viagemId) } });
  res.status(204).send();
}));

module.exports = router;

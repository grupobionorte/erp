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

module.exports = router;

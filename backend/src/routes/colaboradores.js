const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const { empresaId } = req.usuario;
  const colaboradores = await prisma.colaborador.findMany({
    where: {
      ativo: true,
      ...(empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : { empresaId: null }),
    },
    orderBy: { nome: "asc" },
  });
  res.json(colaboradores);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { empresaId, ...dados } = req.body;
  if (!dados.nome || !dados.cpf) {
    return res.status(400).json({ erro: "nome e cpf são obrigatórios" });
  }

  const colaborador = await prisma.colaborador.create({
    data: { ...dados, empresaId: req.usuario.empresaId || undefined },
  });
  res.status(201).json(colaborador);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { empresaId, ...dados } = req.body;
  const id = Number(req.params.id);

  const existente = await prisma.colaborador.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Colaborador não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  const colaborador = await prisma.colaborador.update({ where: { id }, data: dados });
  res.json(colaborador);
}));

router.delete("/:id", exigirAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.colaborador.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Colaborador não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  await prisma.colaborador.update({
    where: { id },
    data: { ativo: false },
  });
  res.status(204).send();
}));

module.exports = router;

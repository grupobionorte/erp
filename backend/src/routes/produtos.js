const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
  const { empresaId } = req.usuario;
  const produtos = await prisma.produto.findMany({
    where: {
      ativo: true,
      ...(empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : { empresaId: null }),
    },
    orderBy: { descricao: "asc" },
  });
  res.json(produtos);
});

router.post("/", async (req, res) => {
  const { empresaId, ...dados } = req.body;
  const { codigoInterno, descricao, ncm } = dados;
  if (!codigoInterno || !descricao || !ncm) {
    return res.status(400).json({ erro: "codigoInterno, descricao e ncm são obrigatórios" });
  }

  const produto = await prisma.produto.create({
    data: { ...dados, empresaId: req.usuario.empresaId || undefined },
  });
  res.status(201).json(produto);
});

router.put("/:id", async (req, res) => {
  const { empresaId, ...dados } = req.body;
  const id = Number(req.params.id);

  const existente = await prisma.produto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Produto não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  const produto = await prisma.produto.update({ where: { id }, data: dados });
  res.json(produto);
});

router.delete("/:id", exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.produto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Produto não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  await prisma.produto.update({
    where: { id },
    data: { ativo: false },
  });
  res.status(204).send();
});

module.exports = router;

const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

router.get("/", async (req, res) => {
  const produtos = await prisma.produto.findMany({
    where: { ativo: true },
    orderBy: { descricao: "asc" },
  });
  res.json(produtos);
});

router.post("/", async (req, res) => {
  const { codigoInterno, descricao, ncm } = req.body;
  if (!codigoInterno || !descricao || !ncm) {
    return res.status(400).json({ erro: "codigoInterno, descricao e ncm são obrigatórios" });
  }

  const produto = await prisma.produto.create({ data: req.body });
  res.status(201).json(produto);
});

router.put("/:id", async (req, res) => {
  const produto = await prisma.produto.update({
    where: { id: Number(req.params.id) },
    data: req.body,
  });
  res.json(produto);
});

router.delete("/:id", async (req, res) => {
  await prisma.produto.update({
    where: { id: Number(req.params.id) },
    data: { ativo: false },
  });
  res.status(204).send();
});

module.exports = router;

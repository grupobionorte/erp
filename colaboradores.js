const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

router.get("/", async (req, res) => {
  const colaboradores = await prisma.colaborador.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
  });
  res.json(colaboradores);
});

router.post("/", async (req, res) => {
  const { nome, cpf } = req.body;
  if (!nome || !cpf) {
    return res.status(400).json({ erro: "nome e cpf são obrigatórios" });
  }

  const colaborador = await prisma.colaborador.create({ data: req.body });
  res.status(201).json(colaborador);
});

router.put("/:id", async (req, res) => {
  const colaborador = await prisma.colaborador.update({
    where: { id: Number(req.params.id) },
    data: req.body,
  });
  res.json(colaborador);
});

router.delete("/:id", async (req, res) => {
  await prisma.colaborador.update({
    where: { id: Number(req.params.id) },
    data: { ativo: false },
  });
  res.status(204).send();
});

module.exports = router;

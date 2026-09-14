const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
  const transportadoras = await prisma.transportadora.findMany({
    where: { ativo: true },
    include: { endereco: true, veiculos: true },
    orderBy: { razaoSocial: "asc" },
  });
  res.json(transportadoras);
});

router.post("/", async (req, res) => {
  const { endereco, veiculos, ...dados } = req.body;

  if (!dados.razaoSocial || !dados.cnpj) {
    return res.status(400).json({ erro: "razaoSocial e cnpj são obrigatórios" });
  }

  const transportadora = await prisma.transportadora.create({
    data: {
      ...dados,
      endereco: endereco ? { create: endereco } : undefined,
      veiculos: veiculos?.length ? { create: veiculos } : undefined,
    },
    include: { endereco: true, veiculos: true },
  });

  res.status(201).json(transportadora);
});

// Adiciona um veículo a uma transportadora existente, usado no MDFe.
router.post("/:id/veiculos", async (req, res) => {
  const veiculo = await prisma.veiculo.create({
    data: { ...req.body, transportadoraId: Number(req.params.id) },
  });
  res.status(201).json(veiculo);
});

router.put("/:id", async (req, res) => {
  const { endereco, veiculos, ...dados } = req.body;
  const transportadora = await prisma.transportadora.update({
    where: { id: Number(req.params.id) },
    data: dados,
  });
  res.json(transportadora);
});

router.delete("/:id", exigirAdmin, async (req, res) => {
  await prisma.transportadora.update({
    where: { id: Number(req.params.id) },
    data: { ativo: false },
  });
  res.status(204).send();
});

module.exports = router;

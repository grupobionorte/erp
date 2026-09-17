const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const { empresaId } = req.usuario;
  const transportadoras = await prisma.transportadora.findMany({
    where: {
      ativo: true,
      ...(empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : { empresaId: null }),
    },
    include: { endereco: true, veiculos: true },
    orderBy: { razaoSocial: "asc" },
  });
  res.json(transportadoras);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { endereco, veiculos, empresaId, ...dados } = req.body;

  if (!dados.razaoSocial || !dados.cnpj) {
    return res.status(400).json({ erro: "razaoSocial e cnpj são obrigatórios" });
  }

  const transportadora = await prisma.transportadora.create({
    data: {
      ...dados,
      // Mesma regra do cadastro de pessoas: com endereco/veiculos aninhados,
      // a empresa tem que entrar por connect, não como empresaId.
      empresa: req.usuario.empresaId ? { connect: { id: req.usuario.empresaId } } : undefined,
      endereco: endereco ? { create: endereco } : undefined,
      veiculos: veiculos?.length ? { create: veiculos } : undefined,
    },
    include: { endereco: true, veiculos: true },
  });

  res.status(201).json(transportadora);
}));

// Adiciona um veículo a uma transportadora existente, usado no MDFe.
router.post("/:id/veiculos", asyncHandler(async (req, res) => {
  const veiculo = await prisma.veiculo.create({
    data: { ...req.body, transportadoraId: Number(req.params.id), empresaId: req.usuario.empresaId || undefined },
  });
  res.status(201).json(veiculo);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { endereco, veiculos, empresaId, ...dados } = req.body;
  const id = Number(req.params.id);

  const existente = await prisma.transportadora.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Transportadora não encontrada" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  const transportadora = await prisma.transportadora.update({
    where: { id },
    data: dados,
  });
  res.json(transportadora);
}));

router.delete("/:id", exigirAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.transportadora.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Transportadora não encontrada" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  await prisma.transportadora.update({
    where: { id },
    data: { ativo: false },
  });
  res.status(204).send();
}));

module.exports = router;

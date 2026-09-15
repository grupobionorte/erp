const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const router = express.Router();

// Lista todos os veículos ativos, com o nome da transportadora dona de
// cada um (usado tanto na tela de cadastro quanto, futuramente, na
// seleção de veículo ao montar um MDFe).
router.get("/", async (req, res) => {
  const { empresaId } = req.usuario;
  const veiculos = await prisma.veiculo.findMany({
    where: {
      ativo: true,
      ...(empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : { empresaId: null }),
    },
    include: { transportadora: true },
    orderBy: { placa: "asc" },
  });
  res.json(veiculos);
});

router.post("/", async (req, res) => {
  const { transportadoraId, placa, empresaId, ...resto } = req.body;
  if (!transportadoraId || !placa) {
    return res.status(400).json({ erro: "transportadoraId e placa são obrigatórios" });
  }

  const veiculo = await prisma.veiculo.create({
    data: {
      ...resto,
      placa,
      transportadoraId: Number(transportadoraId),
      empresaId: req.usuario.empresaId || undefined,
    },
    include: { transportadora: true },
  });

  res.status(201).json(veiculo);
});

router.put("/:id", async (req, res) => {
  const { transportadoraId, empresaId, ...dados } = req.body;
  const id = Number(req.params.id);

  const existente = await prisma.veiculo.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Veículo não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  const veiculo = await prisma.veiculo.update({
    where: { id },
    data: {
      ...dados,
      transportadoraId: transportadoraId ? Number(transportadoraId) : undefined,
    },
    include: { transportadora: true },
  });

  res.json(veiculo);
});

// Exclusão lógica (marca ativo: false) — mantém o histórico de MDFe que
// já referenciaram esse veículo. Restrito a admin, igual aos outros
// cadastros.
router.delete("/:id", exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.veiculo.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Veículo não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  await prisma.veiculo.update({
    where: { id },
    data: { ativo: false },
  });
  res.status(204).send();
});

module.exports = router;

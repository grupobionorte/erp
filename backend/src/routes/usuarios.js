const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const router = express.Router();

// Toda rota aqui já passou pelo "autenticar" do server.js; ainda assim
// aplicamos exigirAdmin em cada uma, porque gerenciar usuários é sempre
// coisa de admin — nunca de operador.

router.get("/", exigirAdmin, async (req, res) => {
  const usuarios = await prisma.usuario.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, email: true, papel: true, ativo: true, criadoEm: true },
    orderBy: { nome: "asc" },
  });
  res.json(usuarios);
});

router.put("/:id", exigirAdmin, async (req, res) => {
  const { nome, papel, ativo } = req.body;

  const usuario = await prisma.usuario.update({
    where: { id: Number(req.params.id) },
    data: {
      nome: nome || undefined,
      papel: papel || undefined,
      ativo: typeof ativo === "boolean" ? ativo : undefined,
    },
    select: { id: true, nome: true, email: true, papel: true, ativo: true },
  });

  res.json(usuario);
});

// Exclusão lógica — um admin não pode desativar a si mesmo, pra nunca
// ficar sem nenhum admin ativo no sistema.
router.delete("/:id", exigirAdmin, async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) {
    return res.status(400).json({ erro: "Você não pode desativar seu próprio usuário" });
  }

  await prisma.usuario.update({
    where: { id: Number(req.params.id) },
    data: { ativo: false },
  });

  res.status(204).send();
});

module.exports = router;

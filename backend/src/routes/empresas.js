const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// Gerenciar a lista de empresas (e a numeração fiscal de cada uma) é
// sempre coisa de admin — inclusive só enxergar os dados completos.
router.use(exigirAdmin);

router.get("/", asyncHandler(async (req, res) => {
  const empresas = await prisma.empresa.findMany({
    where: { ativo: true },
    include: { endereco: true },
    orderBy: { razaoSocial: "asc" },
  });
  res.json(empresas);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { endereco, ...dados } = req.body;

  if (!dados.razaoSocial || !dados.cnpj || !dados.regimeTributario) {
    return res.status(400).json({ erro: "razaoSocial, cnpj e regimeTributario são obrigatórios" });
  }

  const empresa = await prisma.empresa.create({
    data: {
      ...dados,
      endereco: endereco ? { create: endereco } : undefined,
    },
    include: { endereco: true },
  });

  res.status(201).json(empresa);
}));

// Não atualiza o endereço aninhado aqui (mesma limitação já existente em
// transportadoras.js) — endereço muda pouco pra uma empresa emitente,
// então fica pra uma próxima etapa se for realmente necessário editar.
router.put("/:id", asyncHandler(async (req, res) => {
  const { endereco, ...dados } = req.body;

  const empresa = await prisma.empresa.update({
    where: { id: Number(req.params.id) },
    data: dados,
    include: { endereco: true },
  });

  res.json(empresa);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  await prisma.empresa.update({
    where: { id: Number(req.params.id) },
    data: { ativo: false },
  });
  res.status(204).send();
}));

module.exports = router;

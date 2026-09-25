const express = require("express");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

const incluir = {
  transportadora: { select: { id: true, razaoSocial: true } },
  colaborador: { select: { id: true, nome: true } },
  endereco: true,
};

router.get("/", asyncHandler(async (req, res) => {
  const motoristas = await prisma.motorista.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ativo: req.query.inativos === "1" ? undefined : true,
    },
    include: incluir,
    orderBy: { nome: "asc" },
  });
  res.json(motoristas);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { nome, cpf, transportadoraId, colaboradorId, validadeCnh, empresaId, endereco, ...resto } = req.body;
  if (!nome || !cpf) {
    return res.status(400).json({ erro: "Nome e CPF são obrigatórios" });
  }

  // Com escrita aninhada (o endereço), o Prisma não aceita o campo de chave
  // direto — tem que ser connect na relação. Misturar os dois estilos dá
  // "Unknown argument transportadoraId".
  const motorista = await prisma.motorista.create({
    data: {
      ...resto,
      nome,
      cpf: String(cpf).replace(/\D/g, ""),
      validadeCnh: validadeCnh ? new Date(validadeCnh) : undefined,
      transportadora: transportadoraId ? { connect: { id: Number(transportadoraId) } } : undefined,
      colaborador: colaboradorId ? { connect: { id: Number(colaboradorId) } } : undefined,
      empresa: req.usuario.empresaId ? { connect: { id: req.usuario.empresaId } } : undefined,
      endereco: endereco ? { create: endereco } : undefined,
    },
    include: incluir,
  });
  res.status(201).json(motorista);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { transportadoraId, colaboradorId, validadeCnh, cpf, empresaId, endereco, ...dados } = req.body;

  // connect liga, disconnect desliga, undefined não mexe.
  const vinculo = (valor) => {
    if (valor === null || valor === "") return { disconnect: true };
    if (valor === undefined) return undefined;
    return { connect: { id: Number(valor) } };
  };

  const motorista = await prisma.motorista.update({
    where: { id: Number(req.params.id) },
    data: {
      ...dados,
      cpf: cpf ? String(cpf).replace(/\D/g, "") : undefined,
      validadeCnh: validadeCnh === null ? null : (validadeCnh ? new Date(validadeCnh) : undefined),
      transportadora: vinculo(transportadoraId),
      colaborador: vinculo(colaboradorId),
      // Atualiza o endereço existente ou cria um, conforme o motorista já
      // tenha ou não.
      endereco: endereco
        ? { upsert: { create: endereco, update: endereco } }
        : undefined,
    },
    include: incluir,
  });
  res.json(motorista);
}));

// Exclusão lógica: motorista citado em CT-e emitido precisa continuar
// existindo para o documento seguir íntegro.
router.delete("/:id", asyncHandler(async (req, res) => {
  await prisma.motorista.update({
    where: { id: Number(req.params.id) },
    data: { ativo: false },
  });
  res.status(204).send();
}));

module.exports = router;

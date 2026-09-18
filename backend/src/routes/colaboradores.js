const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// O vínculo colaborador <-> usuário é o mesmo dos dois lados: a chave
// estrangeira mora em "usuarios". Então, vindo pela tela de colaboradores,
// gravar o vínculo é atualizar o usuário escolhido.
async function vincularUsuario(colaboradorId, usuarioId) {
  // Solta quem estava vinculado antes a este colaborador.
  await prisma.usuario.updateMany({
    where: { colaboradorId, ...(usuarioId ? { NOT: { id: Number(usuarioId) } } : {}) },
    data: { colaboradorId: null },
  });
  if (!usuarioId) return null;

  const usuario = await prisma.usuario.findUnique({
    where: { id: Number(usuarioId) },
    select: { id: true, nome: true, colaboradorId: true },
  });
  if (!usuario) {
    const erro = new Error("Usuário não encontrado");
    erro.status = 400;
    throw erro;
  }
  if (usuario.colaboradorId && usuario.colaboradorId !== colaboradorId) {
    const erro = new Error("Esse usuário já está vinculado a outro colaborador");
    erro.status = 409;
    throw erro;
  }

  await prisma.usuario.update({ where: { id: usuario.id }, data: { colaboradorId } });
  return usuario;
}

router.get("/", asyncHandler(async (req, res) => {
  const { empresaId } = req.usuario;
  const colaboradores = await prisma.colaborador.findMany({
    where: {
      ativo: true,
      ...(empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : { empresaId: null }),
    },
    orderBy: { nome: "asc" },
    include: { usuario: { select: { id: true, nome: true, email: true, papel: true } } },
  });
  res.json(colaboradores.map((c) => ({ ...c, usuarioId: c.usuario?.id ?? null })));
}));

router.post("/", asyncHandler(async (req, res) => {
  const { empresaId, usuarioId, ...dados } = req.body;
  if (!dados.nome || !dados.cpf) {
    return res.status(400).json({ erro: "nome e cpf são obrigatórios" });
  }

  const colaborador = await prisma.colaborador.create({
    data: { ...dados, empresaId: req.usuario.empresaId || undefined },
  });

  if (usuarioId) {
    try {
      await vincularUsuario(colaborador.id, usuarioId);
    } catch (erro) {
      return res.status(erro.status || 500).json({ erro: erro.message });
    }
  }

  const completo = await prisma.colaborador.findUnique({
    where: { id: colaborador.id },
    include: { usuario: { select: { id: true, nome: true, email: true, papel: true } } },
  });
  res.status(201).json({ ...completo, usuarioId: completo.usuario?.id ?? null });
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { empresaId, ...dados } = req.body;
  const id = Number(req.params.id);

  const existente = await prisma.colaborador.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Colaborador não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  const { usuarioId, ...camposColaborador } = dados;

  const colaborador = await prisma.colaborador.update({ where: { id }, data: camposColaborador });

  // undefined = a tela não mandou o campo, então o vínculo fica como está.
  if (usuarioId !== undefined) {
    try {
      await vincularUsuario(id, usuarioId);
    } catch (erro) {
      return res.status(erro.status || 500).json({ erro: erro.message });
    }
  }

  const completo = await prisma.colaborador.findUnique({
    where: { id: colaborador.id },
    include: { usuario: { select: { id: true, nome: true, email: true, papel: true } } },
  });
  res.json({ ...completo, usuarioId: completo.usuario?.id ?? null });
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

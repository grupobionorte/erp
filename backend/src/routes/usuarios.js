const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");
const { MENUS } = require("../lib/permissoes");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// Toda rota aqui já passou pelo "autenticar" do server.js; ainda assim
// aplicamos exigirAdmin em cada uma, porque gerenciar usuários é sempre
// coisa de admin — nunca de operador.

// Os menus existentes, para a tela montar as opções sem repetir a lista.
router.get("/menus", exigirAdmin, asyncHandler(async (req, res) => {
  res.json(Object.entries(MENUS).map(([chave, cfg]) => ({ chave, rotulo: cfg.rotulo })));
}));

router.get("/", exigirAdmin, asyncHandler(async (req, res) => {
  const usuarios = await prisma.usuario.findMany({
    where: { ativo: true },
    select: {
      id: true, nome: true, email: true, papel: true, ativo: true, criadoEm: true,
      permissoes: true,
      empresas: { select: { id: true, razaoSocial: true } },
      colaboradorId: true,
      colaborador: { select: { id: true, nome: true, cargo: true, setor: true } },
    },
    orderBy: { nome: "asc" },
  });
  res.json(usuarios);
}));

router.put("/:id", exigirAdmin, asyncHandler(async (req, res) => {
  const { nome, papel, ativo, empresaIds, colaboradorId, permissoes } = req.body;

  // Um colaborador só pode estar ligado a um login. Sem essa checagem o
  // erro apareceria como violação de índice único, sem dizer com quem.
  if (colaboradorId) {
    const jaVinculado = await prisma.usuario.findUnique({
      where: { colaboradorId: Number(colaboradorId) },
      select: { id: true, nome: true },
    });
    if (jaVinculado && jaVinculado.id !== Number(req.params.id)) {
      return res.status(409).json({
        erro: "Esse colaborador já está vinculado a outro usuário",
        detalhe: `Vinculado a ${jaVinculado.nome}.`,
      });
    }
  }

  const usuario = await prisma.usuario.update({
    where: { id: Number(req.params.id) },
    data: {
      nome: nome || undefined,
      papel: papel || undefined,
      ativo: typeof ativo === "boolean" ? ativo : undefined,
      // colaboradorId null limpa o vínculo; undefined deixa como está.
      colaboradorId: colaboradorId === undefined ? undefined : (colaboradorId ? Number(colaboradorId) : null),
      // "set" substitui a lista inteira de empresas vinculadas pela nova —
      // só mexe nisso se o front mandou array (mesmo vazio, pra permitir
      // remover todo acesso).
      empresas: Array.isArray(empresaIds) ? { set: empresaIds.map((id) => ({ id: Number(id) })) } : undefined,
      // Mesma regra dos menus: array substitui a lista inteira.
      permissoes: Array.isArray(permissoes) ? permissoes : undefined,
    },
    select: {
      id: true, nome: true, email: true, papel: true, ativo: true, permissoes: true,
      empresas: { select: { id: true, razaoSocial: true } },
      colaboradorId: true,
      colaborador: { select: { id: true, nome: true, cargo: true, setor: true } },
    },
  });

  res.json(usuario);
}));

// Exclusão lógica — um admin não pode desativar a si mesmo, pra nunca
// ficar sem nenhum admin ativo no sistema.
router.delete("/:id", exigirAdmin, asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) {
    return res.status(400).json({ erro: "Você não pode desativar seu próprio usuário" });
  }

  await prisma.usuario.update({
    where: { id: Number(req.params.id) },
    data: { ativo: false },
  });

  res.status(204).send();
}));

module.exports = router;

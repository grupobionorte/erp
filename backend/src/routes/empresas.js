const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// Gerenciar a lista de empresas (e a numeração fiscal de cada uma) é
// sempre coisa de admin — inclusive só enxergar os dados completos.
router.use(exigirAdmin);

router.get("/", asyncHandler(async (req, res) => {
  // ?inativas=1 mostra também as desativadas — é assim que se recupera uma
  // empresa excluída por engano, já que a exclusão aqui é só uma marca.
  const incluirInativas = req.query.inativas === "1";
  const empresas = await prisma.empresa.findMany({
    where: incluirInativas ? {} : { ativo: true },
    include: { endereco: true },
    orderBy: [{ ativo: "desc" }, { razaoSocial: "asc" }],
  });
  res.json(empresas);
}));

// Desfaz uma exclusão. Nada foi perdido: os clientes, documentos e demais
// registros continuam apontando para esta empresa o tempo todo.
router.post("/:id/reativar", asyncHandler(async (req, res) => {
  const empresa = await prisma.empresa.update({
    where: { id: Number(req.params.id) },
    data: { ativo: true },
    include: { endereco: true },
  });
  res.json(empresa);
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
  const id = Number(req.params.id);

  const empresa = await prisma.empresa.findUnique({ where: { id } });
  if (!empresa) return res.status(404).json({ erro: "Empresa não encontrada" });

  // Empresa com movimento não sai do sistema. Apagar (mesmo logicamente)
  // deixaria clientes, notas e marcações de ponto órfãos, e documento fiscal
  // autorizado precisa ficar guardado por cinco anos junto do emitente.
  const [pessoas, colaboradores, transportadoras, veiculos, produtos, documentos, reps, usuarios] =
    await Promise.all([
      prisma.pessoa.count({ where: { empresaId: id } }),
      prisma.colaborador.count({ where: { empresaId: id } }),
      prisma.transportadora.count({ where: { empresaId: id } }),
      prisma.veiculo.count({ where: { empresaId: id } }),
      prisma.produto.count({ where: { empresaId: id } }),
      prisma.documentoFiscal.count({ where: { empresaId: id } }),
      prisma.rep.count({ where: { empresaId: id } }),
      prisma.usuario.count({ where: { empresas: { some: { id } } } }),
    ]);

  const vinculos = [
    { rotulo: "cliente ou fornecedor", plural: "clientes ou fornecedores", total: pessoas },
    { rotulo: "colaborador", plural: "colaboradores", total: colaboradores },
    { rotulo: "transportadora", plural: "transportadoras", total: transportadoras },
    { rotulo: "veículo", plural: "veículos", total: veiculos },
    { rotulo: "produto", plural: "produtos", total: produtos },
    { rotulo: "documento fiscal", plural: "documentos fiscais", total: documentos },
    { rotulo: "tablet de ponto", plural: "tablets de ponto", total: reps },
    { rotulo: "usuário com acesso", plural: "usuários com acesso", total: usuarios },
  ].filter((v) => v.total > 0);

  if (vinculos.length) {
    const lista = vinculos
      .map((v) => `${v.total} ${v.total === 1 ? v.rotulo : v.plural}`)
      .join(", ");
    return res.status(409).json({
      erro: `Não é possível excluir ${empresa.razaoSocial}: existem lançamentos vinculados a essa empresa.`,
      detalhe: `Encontrei ${lista}. Transfira ou remova esses registros antes, ou desative a empresa em vez de excluí-la.`,
      vinculos: vinculos.map((v) => ({ tipo: v.plural, total: v.total })),
    });
  }

  await prisma.empresa.update({ where: { id }, data: { ativo: false } });
  res.status(204).send();
}));

module.exports = router;

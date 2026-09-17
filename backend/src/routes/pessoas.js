const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// GET /pessoas?papel=cliente|fornecedor — lista clientes e/ou fornecedores.
// A mesma tabela serve para os dois porque os campos são idênticos; o que
// muda é qual flag (e_cliente / e_fornecedor) está marcada.
//
// Multi-empresa: só mostra registros da empresa em uso na sessão (definida
// no login) mais os registros antigos sem empresa definida (empresaId nulo),
// pra não sumir cadastro nenhum de quem já usava o sistema antes disso.
router.get("/", asyncHandler(async (req, res) => {
  const { papel, busca } = req.query;
  const { empresaId } = req.usuario;

  const where = {
    ativo: true,
    ...(empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : { empresaId: null }),
    ...(papel === "cliente" ? { eCliente: true } : {}),
    ...(papel === "fornecedor" ? { eFornecedor: true } : {}),
    ...(busca
      ? {
          OR: [
            { nomeRazaoSocial: { contains: busca, mode: "insensitive" } },
            { documento: { contains: busca } },
          ],
        }
      : {}),
  };

  const pessoas = await prisma.pessoa.findMany({
    where,
    include: { endereco: true },
    orderBy: { nomeRazaoSocial: "asc" },
  });

  res.json(pessoas);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const pessoa = await prisma.pessoa.findUnique({
    where: { id: Number(req.params.id) },
    include: { endereco: true },
  });

  if (!pessoa) return res.status(404).json({ erro: "Pessoa não encontrada" });
  res.json(pessoa);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { endereco, empresaId, ...dados } = req.body;

  if (!dados.nomeRazaoSocial || !dados.documento) {
    return res.status(400).json({ erro: "nomeRazaoSocial e documento são obrigatórios" });
  }
  if (!dados.eCliente && !dados.eFornecedor) {
    return res.status(400).json({ erro: "marque eCliente e/ou eFornecedor" });
  }

  const empresaDaSessao = req.usuario.empresaId || null;

  // Cliente e fornecedor moram na mesma tabela, e o CPF/CNPJ é único por
  // empresa. Então cadastrar como cliente alguém que já está lá como
  // fornecedor (ou que foi excluído antes, já que a exclusão é lógica)
  // estourava o índice único e virava "Erro interno" na tela. Nesses casos
  // o certo é reaproveitar o cadastro e só marcar o novo papel.
  const existente = await prisma.pessoa.findFirst({
    where: { documento: dados.documento, empresaId: empresaDaSessao },
    include: { endereco: true },
  });

  if (existente) {
    const pessoa = await prisma.pessoa.update({
      where: { id: existente.id },
      data: {
        ...dados,
        // Papéis são acumulativos: quem já era fornecedor continua sendo.
        eCliente: existente.eCliente || Boolean(dados.eCliente),
        eFornecedor: existente.eFornecedor || Boolean(dados.eFornecedor),
        ativo: true,
        endereco: endereco
          ? existente.enderecoId
            ? { update: endereco }
            : { create: endereco }
          : undefined,
      },
      include: { endereco: true },
    });

    return res.status(200).json({
      ...pessoa,
      avisoCadastroExistente:
        `Esse CPF/CNPJ já estava cadastrado como ${existente.eCliente ? "cliente" : ""}` +
        `${existente.eCliente && existente.eFornecedor ? " e " : ""}` +
        `${existente.eFornecedor ? "fornecedor" : ""}` +
        `${existente.ativo ? "" : " (inativo)"}. O cadastro foi atualizado.`,
    });
  }

  const pessoa = await prisma.pessoa.create({
    data: {
      ...dados,
      // O Prisma não aceita a chave estrangeira crua (empresaId) na mesma
      // chamada que tem escrita aninhada de relação (endereco: { create }).
      // Nesse caso a empresa precisa vir por connect.
      empresa: empresaDaSessao ? { connect: { id: empresaDaSessao } } : undefined,
      endereco: endereco ? { create: endereco } : undefined,
    },
    include: { endereco: true },
  });

  res.status(201).json(pessoa);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { endereco, empresaId, ...dados } = req.body;
  const id = Number(req.params.id);

  const existente = await prisma.pessoa.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Pessoa não encontrada" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  if (endereco) {
    if (existente.enderecoId) {
      await prisma.endereco.update({ where: { id: existente.enderecoId }, data: endereco });
    } else {
      const novoEndereco = await prisma.endereco.create({ data: endereco });
      dados.enderecoId = novoEndereco.id;
    }
  }

  const pessoa = await prisma.pessoa.update({
    where: { id },
    data: dados,
    include: { endereco: true },
  });

  res.json(pessoa);
}));

// Exclusão lógica — mantém o histórico de documentos fiscais emitidos
// para essa pessoa íntegro, em vez de apagar a linha.
router.delete("/:id", exigirAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.pessoa.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Pessoa não encontrada" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse cadastro pertence a outra empresa" });
  }

  await prisma.pessoa.update({
    where: { id },
    data: { ativo: false },
  });

  res.status(204).send();
}));

module.exports = router;

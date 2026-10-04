const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// GET /pessoas?papel=cliente|fornecedor — lista clientes e/ou fornecedores.
// A mesma tabela serve para os dois porque os campos são idênticos, mas cada
// registro tem um papel só: o mesmo CNPJ como cliente e como fornecedor são
// dois cadastros, e editar um não mexe no outro.
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
    ...(papel === "cliente" || papel === "fornecedor" ? { papel } : {}),
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

// O papel vem das marcações que a tela manda. Um registro é cliente OU
// fornecedor; as duas marcações juntas misturariam os cadastros de novo.
function papelDoCadastro(dados) {
  if (dados.eCliente && dados.eFornecedor) return null;
  if (dados.eCliente) return "cliente";
  if (dados.eFornecedor) return "fornecedor";
  return null;
}

router.post("/", asyncHandler(async (req, res) => {
  const { endereco, empresaId, papel: _ignorado, ...dados } = req.body;

  if (!dados.nomeRazaoSocial || !dados.documento) {
    return res.status(400).json({ erro: "nomeRazaoSocial e documento são obrigatórios" });
  }
  const papel = papelDoCadastro(dados);
  if (!papel) {
    return res.status(400).json({ erro: "O cadastro precisa ser de cliente ou de fornecedor, não dos dois" });
  }

  const empresaDaSessao = req.usuario.empresaId || null;

  // O CPF/CNPJ é único por empresa e por papel. Cadastrar de novo um cliente
  // que já existe (ou que foi excluído, já que a exclusão é lógica)
  // estourava o índice único e virava "Erro interno" na tela. Nesse caso o
  // certo é reaproveitar o cadastro — mas só o do MESMO papel: o fornecedor
  // com o CNPJ de um cliente é outro cadastro.
  const existente = await prisma.pessoa.findFirst({
    where: { documento: dados.documento, empresaId: empresaDaSessao, papel },
    include: { endereco: true },
  });

  if (existente) {
    const pessoa = await prisma.pessoa.update({
      where: { id: existente.id },
      data: {
        ...dados,
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
        `Esse CPF/CNPJ já estava cadastrado como ${papel}` +
        `${existente.ativo ? "" : " (inativo)"}. O cadastro foi atualizado.`,
    });
  }

  const pessoa = await prisma.pessoa.create({
    data: {
      ...dados,
      papel,
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
  // Papel e marcações não mudam na edição: transformar o cliente em
  // fornecedor levaria junto as notas emitidas para ele.
  const { endereco, empresaId, papel, eCliente, eFornecedor, ...dados } = req.body;
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

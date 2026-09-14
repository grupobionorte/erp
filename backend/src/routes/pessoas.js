const express = require("express");
const prisma = require("../lib/prisma");
const { exigirAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /pessoas?papel=cliente|fornecedor — lista clientes e/ou fornecedores.
// A mesma tabela serve para os dois porque os campos são idênticos; o que
// muda é qual flag (e_cliente / e_fornecedor) está marcada.
router.get("/", async (req, res) => {
  const { papel, busca } = req.query;

  const where = {
    ativo: true,
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
});

router.get("/:id", async (req, res) => {
  const pessoa = await prisma.pessoa.findUnique({
    where: { id: Number(req.params.id) },
    include: { endereco: true },
  });

  if (!pessoa) return res.status(404).json({ erro: "Pessoa não encontrada" });
  res.json(pessoa);
});

router.post("/", async (req, res) => {
  const { endereco, ...dados } = req.body;

  if (!dados.nomeRazaoSocial || !dados.documento) {
    return res.status(400).json({ erro: "nomeRazaoSocial e documento são obrigatórios" });
  }
  if (!dados.eCliente && !dados.eFornecedor) {
    return res.status(400).json({ erro: "marque eCliente e/ou eFornecedor" });
  }

  const pessoa = await prisma.pessoa.create({
    data: {
      ...dados,
      endereco: endereco ? { create: endereco } : undefined,
    },
    include: { endereco: true },
  });

  res.status(201).json(pessoa);
});

router.put("/:id", async (req, res) => {
  const { endereco, ...dados } = req.body;
  const id = Number(req.params.id);

  if (endereco) {
    const existente = await prisma.pessoa.findUnique({ where: { id } });
    if (existente?.enderecoId) {
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
});

// Exclusão lógica — mantém o histórico de documentos fiscais emitidos
// para essa pessoa íntegro, em vez de apagar a linha.
router.delete("/:id", exigirAdmin, async (req, res) => {
  await prisma.pessoa.update({
    where: { id: Number(req.params.id) },
    data: { ativo: false },
  });

  res.status(204).send();
});

module.exports = router;

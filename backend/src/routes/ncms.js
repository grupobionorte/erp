const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

// Busca por código (começa com) ou por parte da descrição — usado no
// autocomplete do cadastro de produtos. Exige pelo menos 2 caracteres pra
// não devolver a tabela inteira a cada tecla digitada.
router.get("/", async (req, res) => {
  const busca = (req.query.busca || "").trim();
  if (busca.length < 2) return res.json([]);

  const somenteDigitos = busca.replace(/\D/g, "");

  const ncms = await prisma.ncm.findMany({
    where: {
      OR: [
        ...(somenteDigitos ? [{ codigo: { startsWith: somenteDigitos } }] : []),
        { descricao: { contains: busca, mode: "insensitive" } },
      ],
    },
    orderBy: { codigo: "asc" },
    take: 20,
  });

  res.json(ncms);
});

module.exports = router;

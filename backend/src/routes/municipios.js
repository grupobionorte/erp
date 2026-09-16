const express = require("express");
const prisma = require("../lib/prisma");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// Busca municípios de uma UF pelo nome (autocomplete) — usado no CTe pra
// escolher o município de início/fim. Exige a UF e pelo menos 1 caractere
// da busca (os estados menores têm poucos municípios, então não precisa
// de um mínimo alto).
router.get("/", asyncHandler(async (req, res) => {
  const uf = (req.query.uf || "").trim().toUpperCase();
  const busca = (req.query.busca || "").trim();
  if (!uf) return res.json([]);
  if (busca.length < 1) return res.json([]);

  const municipios = await prisma.municipio.findMany({
    where: {
      uf,
      nome: { contains: busca, mode: "insensitive" },
    },
    orderBy: { nome: "asc" },
    take: 20,
  });

  res.json(municipios);
}));

module.exports = router;

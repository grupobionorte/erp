const express = require("express");
const prisma = require("../lib/prisma");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

/* ---------------------------------------------------------------------------
   Busca de CFOP para o autocomplete.

   O "contains" do banco compara letra a letra: quem digita "prestacao" nunca
   acha "Prestação". Como ninguém digita acento com pressa, a busca aqui
   ignora acentos e aceita as palavras em qualquer ordem.

   A tabela de CFOP tem poucas centenas de linhas e não muda, então fica em
   memória depois da primeira consulta — o que também evita ida ao banco a
   cada tecla digitada.
--------------------------------------------------------------------------- */

let cache = null;

const semAcento = (texto) =>
  String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

async function carregarCfops() {
  if (cache) return cache;
  const cfops = await prisma.cfop.findMany({ orderBy: { codigo: "asc" } });
  cache = cfops.map((c) => ({ ...c, busca: semAcento(`${c.codigo} ${c.descricao}`) }));
  return cache;
}

router.get("/", asyncHandler(async (req, res) => {
  const busca = (req.query.busca || "").trim();
  if (busca.length < 2) return res.json([]);

  const lista = await carregarCfops();
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  const digitos = busca.replace(/\D/g, "");

  const encontrados = lista
    .filter((c) => termos.every((t) => c.busca.includes(t)))
    // Código começando com o que foi digitado vem antes.
    .sort((a, b) => {
      const peso = (c) => (digitos && c.codigo.startsWith(digitos) ? 0 : 1);
      return peso(a) - peso(b) || a.codigo.localeCompare(b.codigo);
    })
    .slice(0, 20)
    .map(({ busca: _ignorado, ...c }) => c);

  res.json(encontrados);
}));

module.exports = router;

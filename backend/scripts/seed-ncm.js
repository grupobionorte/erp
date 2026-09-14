// Carrega a tabela oficial de NCM (Nomenclatura Comum do Mercosul) no banco,
// a partir da URL pública do governo — sem necessidade de captcha ou login.
// Rode isso uma vez após a primeira migration, e de novo sempre que a
// Receita Federal publicar uma atualização da tabela (não é frequente).
//
// Uso:
//   node scripts/seed-ncm.js
//
// Exige DATABASE_URL configurada (mesma variável do resto do backend). Se
// for rodar contra o banco do Render, pegue a "External Database URL" no
// painel do banco e exporte antes de rodar:
//   DATABASE_URL="postgresql://..." node scripts/seed-ncm.js

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const URL_TABELA_NCM = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json";

const prisma = new PrismaClient();

async function main() {
  console.log("Baixando a tabela oficial de NCM...");
  const resposta = await fetch(URL_TABELA_NCM);
  if (!resposta.ok) {
    throw new Error(`Falha ao baixar a tabela NCM: HTTP ${resposta.status}`);
  }
  const dados = await resposta.json();

  // O JSON público vem como { Nomenclaturas: [{ Codigo, Descricao, ... }] }.
  // Filtramos só os códigos "folha" (8 dígitos, sem pontuação) — são os que
  // realmente aparecem em nota fiscal; capítulos e posições intermediárias
  // (2, 4, 6 dígitos) não servem para o campo NCM do produto.
  const nomenclaturas = dados.Nomenclaturas || dados;
  const itens = nomenclaturas
    .map((n) => ({
      codigo: String(n.Codigo || "").replace(/\D/g, ""),
      descricao: n.Descricao || n.descricao || "",
    }))
    .filter((n) => n.codigo.length === 8 && n.descricao);

  console.log(`${itens.length} códigos NCM encontrados. Gravando no banco...`);

  // Em lotes, para não estourar o limite de parâmetros de uma única query.
  const TAMANHO_LOTE = 500;
  for (let i = 0; i < itens.length; i += TAMANHO_LOTE) {
    const lote = itens.slice(i, i + TAMANHO_LOTE);
    await prisma.$transaction(
      lote.map((item) =>
        prisma.ncm.upsert({
          where: { codigo: item.codigo },
          update: { descricao: item.descricao },
          create: item,
        })
      )
    );
    process.stdout.write(`\r${Math.min(i + TAMANHO_LOTE, itens.length)}/${itens.length}`);
  }

  console.log("\nTabela NCM carregada com sucesso.");
}

main()
  .catch((erro) => {
    console.error("Erro ao carregar a tabela NCM:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

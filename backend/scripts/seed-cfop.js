// Carrega a tabela de CFOP (Código Fiscal de Operações e Prestações) no
// banco. Diferente do NCM, não existe uma fonte pública em JSON pra baixar
// — a tabela está embutida abaixo, com os códigos mais usados no dia a dia
// (compra, venda, devolução, transferência, remessa para
// industrialização/conserto, transporte). Cobre a grande maioria das
// operações comuns; para um código raro que não aparecer na busca, confira
// o Portal Nacional da NF-e ou o site da SEFAZ do seu estado.
//
// Uso:
//   node scripts/seed-cfop.js
//
// Exige DATABASE_URL configurada (mesma variável do resto do backend).

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { CFOPS } = require("../src/lib/tabelaCfop");

async function main() {
  console.log(`Carregando ${CFOPS.length} códigos de CFOP...`);

  let inseridos = 0;
  for (const [codigo, descricao] of CFOPS) {
    await prisma.cfop.upsert({
      where: { codigo },
      update: { descricao },
      create: { codigo, descricao },
    });
    inseridos++;
  }

  console.log(`Pronto — ${inseridos} códigos de CFOP carregados.`);
}

main()
  .catch((erro) => {
    console.error("Falha ao carregar CFOPs:", erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

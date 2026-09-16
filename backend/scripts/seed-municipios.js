// Carrega todos os municípios do Brasil (código IBGE + nome + UF) direto
// da API pública do IBGE — são uns 5.570 municípios, então isso demora
// alguns minutos.
//
// Uso:
//   node scripts/seed-municipios.js
//
// Exige DATABASE_URL configurada (mesma variável do resto do backend).

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

async function main() {
  let totalInseridos = 0;

  for (const uf of UFS) {
    console.log(`Buscando municípios de ${uf}...`);
    const resposta = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
    if (!resposta.ok) {
      console.error(`  Falha ao buscar ${uf}: ${resposta.status}`);
      continue;
    }
    const municipios = await resposta.json();

    for (const m of municipios) {
      await prisma.municipio.upsert({
        where: { codigoIbge: String(m.id) },
        update: { nome: m.nome, uf },
        create: { codigoIbge: String(m.id), nome: m.nome, uf },
      });
      totalInseridos++;
    }
    console.log(`  ${municipios.length} municípios de ${uf} carregados.`);
  }

  console.log(`Pronto — ${totalInseridos} municípios carregados no total.`);
}

main()
  .catch((erro) => {
    console.error("Falha ao carregar municípios:", erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

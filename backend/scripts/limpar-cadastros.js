// Apaga os cadastros de teste (clientes/fornecedores, colaboradores,
// transportadoras, veículos, produtos e qualquer documento fiscal
// rascunhado) para começar com uma base limpa. NÃO mexe em:
//   - usuarios (seus logins continuam valendo)
//   - empresas (as empresas cadastradas em Configurações continuam)
//   - ncms (tabela de referência oficial, não é dado de teste)
//   - enderecos (ficam órfãos, mas não atrapalham nada)
//
// Uso:
//   node scripts/limpar-cadastros.js
//
// Exige DATABASE_URL configurada, igual o seed-ncm.js:
//   set DATABASE_URL=postgresql://...   (Windows, mesma sessão do terminal)
//   node scripts/limpar-cadastros.js

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("Apagando cadastros de teste...\n");

  // Ordem importa por causa das chaves estrangeiras: primeiro o que
  // depende de documentos fiscais, depois os documentos, depois os
  // cadastros que os documentos referenciam.
  const eventos = await prisma.documentoEvento.deleteMany({});
  console.log(`- documento_eventos: ${eventos.count} removido(s)`);

  const itens = await prisma.documentoItem.deleteMany({});
  console.log(`- documento_itens: ${itens.count} removido(s)`);

  const documentos = await prisma.documentoFiscal.deleteMany({});
  console.log(`- documentos_fiscais: ${documentos.count} removido(s)`);

  const veiculos = await prisma.veiculo.deleteMany({});
  console.log(`- veiculos: ${veiculos.count} removido(s)`);

  const pessoas = await prisma.pessoa.deleteMany({});
  console.log(`- pessoas (clientes/fornecedores): ${pessoas.count} removido(s)`);

  const colaboradores = await prisma.colaborador.deleteMany({});
  console.log(`- colaboradores: ${colaboradores.count} removido(s)`);

  const transportadoras = await prisma.transportadora.deleteMany({});
  console.log(`- transportadoras: ${transportadoras.count} removido(s)`);

  const produtos = await prisma.produto.deleteMany({});
  console.log(`- produtos: ${produtos.count} removido(s)`);

  console.log("\nPronto! Empresas, usuários e a tabela de NCM continuam intactos.");
}

main()
  .catch((erro) => {
    console.error("Erro ao limpar os cadastros:", erro.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

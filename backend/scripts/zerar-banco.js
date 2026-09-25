/* ===========================================================================
   Zera a base para começar do zero.

   Apaga TUDO que é movimento e cadastro operacional, inclusive documentos
   autorizados. Isso só é aceitável porque os documentos emitidos até aqui
   são de HOMOLOGAÇÃO — não existem perante a SEFAZ.

   >>> NÃO RODE ISSO DEPOIS QUE A EMISSÃO ESTIVER EM PRODUÇÃO. <<<
   Documento fiscal autorizado de verdade precisa ser guardado por cinco
   anos. Para aquele caso existe o limpar-para-producao.js, que preserva os
   autorizados.

   O que fica de pé:
     - usuarios e empresas (senão você perde o acesso ao sistema)
     - cfops, ncms, municipios (tabelas de referência, não são dado de teste)

   O que some:
     - todos os documentos fiscais, itens, eventos, cartas de correção
     - clientes, fornecedores, produtos, veículos, transportadoras,
       colaboradores e endereços órfãos
     - ponto: marcações, tratamentos, biometrias, tablets e jornadas
     - a numeração volta para 1 em cada documento

   Uso (o texto ZERAR é obrigatório, para ninguém rodar sem querer):
     node scripts/zerar-banco.js                 (só simula)
     node scripts/zerar-banco.js --confirmar ZERAR
=========================================================================== */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { contarBase, zerarBase, emProducao } = require("../src/lib/zerarBase");

const args = process.argv.slice(2);
const confirmado = args.includes("--confirmar") && args.includes("ZERAR");

async function main() {
  const contagem = await contarBase();
  console.log(`Provedor fiscal configurado: ${contagem.ambiente || "(não configurado)"}`);

  if (emProducao()) {
    console.error(
      "\nABORTADO. A configuração aponta para PRODUÇÃO.\n" +
      "Documentos autorizados em produção não podem ser apagados.\n" +
      "Use scripts/limpar-para-producao.js, que preserva os autorizados."
    );
    process.exit(1);
  }

  console.log(confirmado ? "\nZERANDO A BASE\n" : "\nSIMULAÇÃO — nada será apagado.\n");
  for (const linha of contagem.tabelas) {
    console.log(`  ${linha.rotulo.padEnd(34)} ${String(linha.total).padStart(6)}`);
  }

  if (!confirmado) {
    console.log("\nNada foi alterado.");
    console.log("Para apagar de verdade:  node scripts/zerar-banco.js --confirmar ZERAR");
    return;
  }

  await zerarBase();
  console.log("\nBase zerada. Numeração de NF-e, CT-e e MDF-e voltou para 1.");
  console.log("Usuários, empresas e as tabelas de CFOP, NCM e municípios continuam.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => require("../src/lib/prisma").$disconnect());

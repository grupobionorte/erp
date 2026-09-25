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

const args = process.argv.slice(2);
const confirmado = args.includes("--confirmar") && args.includes("ZERAR");

// A ordem importa: primeiro quem depende, depois quem é dependido.
const TABELAS = [
  ["cartas_correcao", "cartas de correção"],
  ["documento_eventos", "eventos de documento"],
  ["documento_itens", "itens de documento"],
  ["cte_documentos", "documentos transportados dos CT-es"],
  ["tratamentos_ponto", "tratamentos de ponto"],
  ["marcacoes_ponto", "marcações de ponto"],
  ["biometrias_faciais", "biometrias faciais"],
  ["jornadas_dias", "dias de jornada"],
  ["jornadas_trabalho", "jornadas de trabalho"],
  ["reps", "tablets de ponto"],
  ["documentos_fiscais", "documentos fiscais"],
  ["veiculos", "veículos"],
  ["produtos", "produtos"],
  ["pessoas", "clientes e fornecedores"],
  ["transportadoras", "transportadoras"],
  ["colaboradores", "colaboradores"],
];

async function main() {
  const ambiente = process.env.FOCUS_NFE_BASE_URL || "(não configurado)";
  const producao = /api\.focusnfe/i.test(ambiente);

  console.log(`Provedor fiscal configurado: ${ambiente}`);
  if (producao) {
    console.error(
      "\nABORTADO. A configuração aponta para PRODUÇÃO.\n" +
      "Documentos autorizados em produção não podem ser apagados.\n" +
      "Use scripts/limpar-para-producao.js, que preserva os autorizados."
    );
    process.exit(1);
  }

  console.log(confirmado ? "\nZERANDO A BASE\n" : "\nSIMULAÇÃO — nada será apagado.\n");

  for (const [tabela, rotulo] of TABELAS) {
    const [{ total }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "${tabela}"`);
    console.log(`  ${rotulo.padEnd(34)} ${String(total).padStart(6)}`);
  }

  if (!confirmado) {
    console.log("\nNada foi alterado.");
    console.log("Para apagar de verdade:  node scripts/zerar-banco.js --confirmar ZERAR");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // A tabela de marcações é somente-inserção por trigger; desliga só
    // durante a limpeza e religa em seguida.
    await tx.$executeRawUnsafe(`ALTER TABLE "marcacoes_ponto" DISABLE TRIGGER USER`);
    for (const [tabela] of TABELAS) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tabela}"`);
    }
    await tx.$executeRawUnsafe(`ALTER TABLE "marcacoes_ponto" ENABLE TRIGGER USER`);

    // Endereços que sobraram sem dono.
    await tx.$executeRawUnsafe(`
      DELETE FROM "enderecos" e
       WHERE NOT EXISTS (SELECT 1 FROM "empresas"        x WHERE x."endereco_id" = e."id")
         AND NOT EXISTS (SELECT 1 FROM "pessoas"         x WHERE x."endereco_id" = e."id")
         AND NOT EXISTS (SELECT 1 FROM "transportadoras" x WHERE x."endereco_id" = e."id")
    `);

    // Numeração recomeça do 1.
    await tx.$executeRawUnsafe(`
      UPDATE "empresas"
         SET "nfe_proximo_numero" = 1,
             "cte_proximo_numero" = 1,
             "mdfe_proximo_numero" = 1
    `);
  });

  console.log("\nBase zerada. Numeração de NF-e, CT-e e MDF-e voltou para 1.");
  console.log("Usuários, empresas e as tabelas de CFOP, NCM e municípios continuam.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

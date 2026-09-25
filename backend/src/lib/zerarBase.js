const prisma = require("./prisma");

/* ---------------------------------------------------------------------------
   Zerar a base para recomeçar.

   Fica separado da rota e do script de linha de comando porque os dois usam
   exatamente a mesma lógica — e uma operação destrutiva não pode ter duas
   implementações que possam divergir.

   A ordem das tabelas importa: primeiro quem depende, depois quem é
   dependido, senão a chave estrangeira barra.
--------------------------------------------------------------------------- */

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

/**
 * Emissão em produção significa documento com valor fiscal, que precisa ser
 * guardado por cinco anos. Nesse caso a limpeza total fica proibida.
 */
function emProducao() {
  return /api\.focusnfe/i.test(process.env.FOCUS_NFE_BASE_URL || "");
}

async function contarBase() {
  const linhas = [];
  for (const [tabela, rotulo] of TABELAS) {
    const [{ total }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "${tabela}"`);
    linhas.push({ tabela, rotulo, total });
  }
  return {
    ambiente: process.env.FOCUS_NFE_BASE_URL || null,
    producao: emProducao(),
    tabelas: linhas,
    total: linhas.reduce((t, l) => t + l.total, 0),
  };
}

async function zerarBase() {
  if (emProducao()) {
    throw Object.assign(new Error("Emissão em produção: a base não pode ser zerada"), { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    // As marcações de ponto são somente-inserção por trigger; desliga só
    // durante a limpeza e religa em seguida.
    await tx.$executeRawUnsafe(`ALTER TABLE "marcacoes_ponto" DISABLE TRIGGER USER`);
    for (const [tabela] of TABELAS) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tabela}"`);
    }
    await tx.$executeRawUnsafe(`ALTER TABLE "marcacoes_ponto" ENABLE TRIGGER USER`);

    // Endereços que ficaram sem dono.
    await tx.$executeRawUnsafe(`
      DELETE FROM "enderecos" e
       WHERE NOT EXISTS (SELECT 1 FROM "empresas"        x WHERE x."endereco_id" = e."id")
         AND NOT EXISTS (SELECT 1 FROM "pessoas"         x WHERE x."endereco_id" = e."id")
         AND NOT EXISTS (SELECT 1 FROM "transportadoras" x WHERE x."endereco_id" = e."id")
    `);

    // A numeração recomeça do 1.
    await tx.$executeRawUnsafe(`
      UPDATE "empresas"
         SET "nfe_proximo_numero" = 1,
             "cte_proximo_numero" = 1,
             "mdfe_proximo_numero" = 1
    `);
  });
}

module.exports = { TABELAS, contarBase, zerarBase, emProducao };

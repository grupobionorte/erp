/* ===========================================================================
   Limpeza para entrar em produção.

   Apaga o que é teste e PRESERVA o que tem valor fiscal ou legal:

   - Documentos AUTORIZADOS ou CANCELADOS ficam. Eles valem cinco anos, e
     apagar registro fiscal autorizado é problema sério numa fiscalização —
     mesmo que o XML esteja guardado na Focus.
   - Marcações de ponto ficam por padrão. São registro trabalhista, também
     somente-inserção por decisão de projeto (existe trigger no banco
     impedindo alteração).
   - Usuários, empresas, CFOPs, NCMs e municípios ficam.

   O que sai: rascunhos, rejeitados, documentos de homologação, e — se você
   pedir — os cadastros de teste (clientes, produtos, veículos...).

   Uso:
     node scripts/limpar-para-producao.js                  (só simula)
     node scripts/limpar-para-producao.js --confirmar      (apaga)
     node scripts/limpar-para-producao.js --confirmar --cadastros
     node scripts/limpar-para-producao.js --confirmar --ponto
=========================================================================== */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const confirmar = args.includes("--confirmar");
const limparCadastros = args.includes("--cadastros");
const limparPonto = args.includes("--ponto");

// Documentos que podem sumir: nunca viraram documento fiscal válido.
const STATUS_DESCARTAVEIS = ["rascunho", "rejeitado", "enviado", "processando"];

async function main() {
  console.log(confirmar ? "LIMPANDO A BASE\n" : "SIMULAÇÃO — nada será apagado. Use --confirmar para valer.\n");

  const porStatus = await prisma.documentoFiscal.groupBy({
    by: ["tipo", "status"],
    _count: true,
    orderBy: { tipo: "asc" },
  });

  console.log("Documentos fiscais hoje:");
  for (const linha of porStatus) {
    const destino = STATUS_DESCARTAVEIS.includes(linha.status) ? "APAGA" : "preserva";
    console.log(`  ${linha.tipo.padEnd(5)} ${linha.status.padEnd(12)} ${String(linha._count).padStart(4)}  ${destino}`);
  }

  const descartaveis = await prisma.documentoFiscal.findMany({
    where: { status: { in: STATUS_DESCARTAVEIS } },
    select: { id: true },
  });
  const ids = descartaveis.map((d) => d.id);
  console.log(`\nDocumentos a apagar: ${ids.length}`);

  const contar = async (modelo, onde = {}) => prisma[modelo].count({ where: onde });

  if (limparCadastros) {
    console.log("\nCadastros (serão apagados com --cadastros):");
    for (const modelo of ["pessoa", "produto", "veiculo", "transportadora", "colaborador"]) {
      console.log(`  ${modelo.padEnd(15)} ${await contar(modelo)}`);
    }
  }
  if (limparPonto) {
    console.log(`\nMarcações de ponto (serão apagadas com --ponto): ${await contar("marcacaoPonto")}`);
  }

  if (!confirmar) {
    console.log("\nNada foi alterado. Rode de novo com --confirmar quando estiver certo.");
    return;
  }

  // --- documentos descartáveis e o que depende deles ---
  if (ids.length) {
    await prisma.$transaction([
      prisma.cteDocumento.deleteMany({ where: { cteId: { in: ids } } }),
      prisma.documentoItem.deleteMany({ where: { documentoId: { in: ids } } }),
      prisma.documentoEvento.deleteMany({ where: { documentoId: { in: ids } } }),
      prisma.cartaCorrecao.deleteMany({ where: { documentoId: { in: ids } } }),
      // Solta documentos que estavam vinculados a um MDF-e descartado.
      prisma.documentoFiscal.updateMany({ where: { mdfeId: { in: ids } }, data: { mdfeId: null } }),
      prisma.documentoFiscal.deleteMany({ where: { id: { in: ids } } }),
    ]);
    console.log(`\n- ${ids.length} documento(s) descartável(is) apagado(s)`);
  }

  // --- ponto ---
  if (limparPonto) {
    // A tabela é somente-inserção por trigger; para limpar teste, a trigger
    // é desativada e religada na mesma transação.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE "marcacoes_ponto" DISABLE TRIGGER USER`);
      await tx.$executeRawUnsafe(`DELETE FROM "tratamentos_ponto"`);
      await tx.$executeRawUnsafe(`DELETE FROM "marcacoes_ponto"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "marcacoes_ponto" ENABLE TRIGGER USER`);
    });
    console.log("- marcações e tratamentos de ponto apagados");
  }

  // --- cadastros ---
  if (limparCadastros) {
    const presos = await prisma.documentoFiscal.count();
    if (presos > 0) {
      console.log(
        `\n! ${presos} documento(s) fiscal(is) preservado(s) ainda apontam para cadastros.\n` +
        "  Os cadastros usados por eles NÃO podem ser apagados — a referência precisa existir\n" +
        "  para o documento continuar íntegro. Apagando só os que não estão em uso."
      );
    }
    const apagarSeLivre = async (modelo, rotulo) => {
      let removidos = 0;
      for (const registro of await prisma[modelo].findMany({ select: { id: true } })) {
        try {
          await prisma[modelo].delete({ where: { id: registro.id } });
          removidos++;
        } catch { /* em uso por documento fiscal: fica */ }
      }
      console.log(`- ${rotulo}: ${removidos} removido(s)`);
    };
    await apagarSeLivre("veiculo", "veículos");
    await apagarSeLivre("produto", "produtos");
    await apagarSeLivre("pessoa", "clientes/fornecedores");
    await apagarSeLivre("transportadora", "transportadoras");
    await apagarSeLivre("colaborador", "colaboradores");
  }

  console.log("\nPronto.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

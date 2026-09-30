/* ===========================================================================
   Corrige o número dos documentos já autorizados.

   O número real é o que está na chave de acesso — é ele que foi para a
   SEFAZ e aparece no DANFE. O número que o sistema gravou ao criar o
   rascunho era só uma previsão, e ficou defasado porque quem numera é o
   provedor.

   Também recoloca o contador da empresa à frente do maior número já
   autorizado, para os próximos rascunhos nascerem certos.

   Uso:
     node scripts/corrigir-numeros.js                (só mostra)
     node scripts/corrigir-numeros.js --confirmar    (corrige)
=========================================================================== */

require("dotenv").config();
const prisma = require("../src/lib/prisma");

const confirmar = process.argv.includes("--confirmar");
const CONTADOR = { NFe: "nfeProximoNumero", CTe: "cteProximoNumero", MDFe: "mdfeProximoNumero" };

async function main() {
  const documentos = await prisma.documentoFiscal.findMany({
    where: { status: "autorizado", chaveAcesso: { not: null } },
    select: { id: true, tipo: true, numero: true, serie: true, chaveAcesso: true, empresaId: true },
    orderBy: { id: "asc" },
  });

  console.log(confirmar ? "CORRIGINDO\n" : "SIMULAÇÃO — nada será alterado.\n");

  // Numeração é por empresa: cada uma tem a sua sequência na SEFAZ. Somar
  // tudo num balde só faria o contador de uma empresa saltar por causa dos
  // documentos de outra.
  const maiorPorEmpresaTipo = {};
  let divergentes = 0;

  for (const doc of documentos) {
    const chave = String(doc.chaveAcesso).replace(/\D/g, "");
    if (chave.length !== 44) continue;

    // Posições fixas da chave: série em 23-25, número em 26-34.
    const serie = Number(chave.slice(22, 25));
    const numero = Number(chave.slice(25, 34));

    if (doc.empresaId) {
      const chave = `${doc.empresaId}|${doc.tipo}`;
      maiorPorEmpresaTipo[chave] = Math.max(maiorPorEmpresaTipo[chave] || 0, numero);
    }

    if (doc.numero === numero && doc.serie === serie) continue;
    divergentes++;
    console.log(`  ${doc.tipo} id ${doc.id}: sistema ${doc.numero}/${doc.serie} → SEFAZ ${numero}/${serie}`);

    if (confirmar) {
      await prisma.documentoFiscal.update({ where: { id: doc.id }, data: { numero, serie } });
    }
  }

  console.log(`\nDocumentos conferidos: ${documentos.length} · divergentes: ${divergentes}`);

  // Contadores: cada empresa recebe o maior número DELA.
  console.log("\nContadores:");
  for (const [chave, maior] of Object.entries(maiorPorEmpresaTipo)) {
    const [empresaId, tipo] = chave.split("|");
    const campo = CONTADOR[tipo];
    const empresa = await prisma.empresa.findUnique({
      where: { id: Number(empresaId) },
      select: { id: true, razaoSocial: true, [campo]: true },
    });
    if (!empresa || empresa[campo] > maior) continue;

    console.log(`  ${tipo} · ${empresa.razaoSocial}: ${empresa[campo]} → ${maior + 1}`);
    if (confirmar) {
      await prisma.empresa.update({ where: { id: empresa.id }, data: { [campo]: maior + 1 } });
    }
  }

  if (!confirmar) console.log("\nRode de novo com --confirmar para aplicar.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

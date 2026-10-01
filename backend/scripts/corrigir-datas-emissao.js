/* ===========================================================================
   Corrige a data de emissão dos documentos gravados em UTC puro.

   A tela enviava só "2026-10-01" e o servidor gravava meia-noite em UTC —
   que é 20h do DIA ANTERIOR no fuso da operação. O documento na SEFAZ saiu
   certo; o que ficou deslocado foi o registro no banco, e com ele a
   listagem e os relatórios por período.

   O conserto move cada registro suspeito para meio-dia no fuso da operação,
   no mesmo dia que a pessoa escolheu ao emitir. Meio-dia porque é o horário
   que não vira o dia em nenhum fuso do Brasil.

   Só mexe em registro gravado exatamente às 00:00 UTC: esse horário não
   acontece por acaso, é a assinatura do problema. Documento gravado com
   hora de verdade fica como está.

   Uso:
     node scripts/corrigir-datas-emissao.js              (só mostra)
     node scripts/corrigir-datas-emissao.js --confirmar  (corrige)
=========================================================================== */

require("dotenv").config();
const prisma = require("../src/lib/prisma");

const confirmar = process.argv.includes("--confirmar");
const ZONA = process.env.TZ_FISCAL || "America/Cuiaba";

// Meio-dia no fuso da operação, no dia informado.
function meioDiaNoFuso(ano, mes, dia) {
  const pad = (n) => String(n).padStart(2, "0");
  const data = `${ano}-${pad(mes)}-${pad(dia)}`;
  const referencia = new Date(`${data}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: ZONA, timeZoneName: "longOffset" })
    .formatToParts(referencia).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
  return new Date(`${data}T12:00:00${offset}`);
}

async function main() {
  const documentos = await prisma.documentoFiscal.findMany({
    where: { dataEmissao: { not: null } },
    select: { id: true, tipo: true, numero: true, dataEmissao: true, dataSaida: true },
    orderBy: { id: "asc" },
  });

  console.log(confirmar ? "CORRIGINDO\n" : "SIMULAÇÃO — nada será alterado.\n");

  let corrigidos = 0;

  for (const doc of documentos) {
    // A assinatura do problema: exatamente meia-noite em UTC.
    if (doc.dataEmissao.toISOString().slice(11, 19) !== "00:00:00") continue;

    // O dia escolhido pela pessoa é o que está em UTC, não o do fuso local.
    const nova = meioDiaNoFuso(
      doc.dataEmissao.getUTCFullYear(),
      doc.dataEmissao.getUTCMonth() + 1,
      doc.dataEmissao.getUTCDate()
    );

    const antes = doc.dataEmissao.toLocaleDateString("pt-BR", { timeZone: ZONA });
    const depois = nova.toLocaleDateString("pt-BR", { timeZone: ZONA });
    console.log(`  ${doc.tipo.padEnd(5)} ${String(doc.numero || "—").padEnd(7)} aparecia ${antes} → ${depois}`);
    corrigidos++;

    if (confirmar) {
      await prisma.documentoFiscal.update({
        where: { id: doc.id },
        data: {
          dataEmissao: nova,
          // A data de saída tinha o mesmo defeito antes do campo de hora.
          dataSaida: doc.dataSaida && doc.dataSaida.toISOString().slice(11, 19) === "00:00:00"
            ? meioDiaNoFuso(
                doc.dataSaida.getUTCFullYear(),
                doc.dataSaida.getUTCMonth() + 1,
                doc.dataSaida.getUTCDate()
              )
            : undefined,
        },
      });
    }
  }

  console.log(`\nDocumentos conferidos: ${documentos.length} · deslocados: ${corrigidos}`);
  if (!confirmar && corrigidos) console.log("\nRode de novo com --confirmar para aplicar.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

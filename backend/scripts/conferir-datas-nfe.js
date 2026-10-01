/* Mostra as datas de emissão gravadas e como elas aparecem no fuso da
   operação, para identificar documentos gravados com o dia errado.
   Uso: node scripts/conferir-datas-nfe.js */
require("dotenv").config();
const prisma = require("../src/lib/prisma");

const ZONA = process.env.TZ_FISCAL || "America/Cuiaba";

async function main() {
  const documentos = await prisma.documentoFiscal.findMany({
    where: { status: { in: ["autorizado", "cancelado"] } },
    select: { id: true, tipo: true, numero: true, dataEmissao: true, chaveAcesso: true },
    orderBy: { id: "desc" },
    take: 60,
  });

  console.log("tipo  número   gravado (UTC)         no fuso da operação     dia da chave");
  for (const d of documentos) {
    const chave = String(d.chaveAcesso || "").replace(/\D/g, "");
    // Na chave de acesso, as posições 3 a 6 trazem ano e mês da emissão.
    const anoMesChave = chave.length === 44 ? `20${chave.slice(2, 4)}-${chave.slice(4, 6)}` : "—";
    const local = d.dataEmissao?.toLocaleString("pt-BR", { timeZone: ZONA }) || "—";
    const utc = d.dataEmissao?.toISOString().slice(0, 16).replace("T", " ") || "—";

    // Hora 00:00 UTC denuncia o registro gravado como data pura.
    const suspeito = d.dataEmissao && d.dataEmissao.toISOString().slice(11, 16) === "00:00" ? "  <-- dia pode estar errado" : "";
    console.log(`${d.tipo.padEnd(5)} ${String(d.numero).padEnd(8)} ${utc}      ${local.padEnd(22)} ${anoMesChave}${suspeito}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

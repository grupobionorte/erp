/* ===========================================================================
   Fuso da operação.

   O sistema trabalha no horário de Mato Grosso (America/Cuiaba, UTC-4). O
   servidor do Render roda em UTC: tudo que for "hoje", "esse dia" ou "essa
   hora" para o usuário passa por aqui, e não pelo relógio do servidor.
   Depois das 20h de Cuiabá já é o dia seguinte em UTC — foi assim que um dia
   inteiro de notas apareceu com data errada.

   O fuso do processo (TZ) continua UTC de propósito: parte do código conta
   com isso, e mudar de uma vez alteraria o comportamento sem aviso.
   =========================================================================== */

const FUSO = process.env.TZ_FISCAL || "America/Cuiaba";

// Partes de data/hora de um instante, no fuso da operação.
function partesNoFuso(data, timeZone = FUSO) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(data).map((x) => [x.type, x.value])
  );
  return {
    dia: `${p.year}-${p.month}-${p.day}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
    hora: `${p.hour}:${p.minute}`,
  };
}

// "AAAA-MM-DD" de hoje em Cuiabá.
const hojeNoFuso = () => partesNoFuso(new Date()).dia;

// Diferença do fuso para UTC naquele dia, como "-04:00". Calculada pelo
// Intl em vez de fixa, para continuar certa se o fuso mudar de regra.
function offsetDoDia(dia) {
  const nome = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${dia}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName").value.replace("GMT", "");
  return nome || "+00:00";
}

// Instante de "dia + hora" no fuso. Sem isso, "2026-09-25" vira meia-noite
// em UTC, que é 20h do dia anterior em Mato Grosso.
function dataHoraNoFuso(dia, hora) {
  if (!dia) return undefined;
  return new Date(`${dia}T${hora || "00:00"}:00${offsetDoDia(dia)}`);
}

// Início e fim de um período de dias, no fuso. É o que todo filtro "de/até"
// precisa: sem isso, o que acontece depois das 20h do último dia fica de fora.
function intervaloNoFuso(de, ate) {
  return {
    inicio: de ? new Date(`${de}T00:00:00${offsetDoDia(de)}`) : undefined,
    fim: ate ? new Date(`${ate}T23:59:59.999${offsetDoDia(ate)}`) : undefined,
  };
}

// Dia "AAAA-MM-DD" de um campo só-data que veio do banco. Esses campos são
// gravados à meia-noite UTC; o Prisma devolve um Date, e String(Date) dá
// "Thu Oct 01 2026...", não uma data comparável — foi o que fez o espelho
// ignorar a jornada inteira.
function diaDoCampo(valor) {
  if (!valor) return null;
  // Reconhece a data pelo tipo, não por instanceof: uma Date criada em
  // outro contexto (ou um relógio simulado em teste) não passa no instanceof
  // e cairia de novo no String(Date).
  if (Object.prototype.toString.call(valor) === "[object Date]") return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

// Data e hora sem fuso ("2026-10-01T08:00") vindas da tela são hora de
// Cuiabá. Com fuso explícito (Z ou ±hh:mm), valem como vieram.
function instanteDaTela(valor) {
  if (!valor) return undefined;
  const texto = String(valor);
  const semFuso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/.exec(texto);
  if (semFuso) return dataHoraNoFuso(semFuso[1], semFuso[2]);
  return new Date(texto);
}

module.exports = {
  FUSO, partesNoFuso, hojeNoFuso, offsetDoDia, dataHoraNoFuso, intervaloNoFuso, diaDoCampo, instanteDaTela,
};

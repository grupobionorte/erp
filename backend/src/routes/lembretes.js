const express = require("express");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const { enviarPushParaColaborador } = require("../lib/push");

const router = express.Router();

/* ---------------------------------------------------------------------------
   Disparo dos lembretes.

   Fica numa rota em vez de um agendador dentro do processo: o servidor pode
   reiniciar a qualquer momento, e um agendador em memória some junto. Um
   serviço de cron chama esta rota de tempos em tempos, com o token.
--------------------------------------------------------------------------- */
router.post("/", asyncHandler(async (req, res) => {
  const token = req.get("x-cron-token") || req.query.token;
  if (!process.env.CRON_TOKEN || token !== process.env.CRON_TOKEN) {
    return res.status(401).json({ erro: "Token de agendamento inválido" });
  }

  const zona = process.env.TZ_FISCAL || "America/Cuiaba";
  const agora = new Date();
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(agora).map((p) => [p.type, p.value])
  );
  const hoje = `${partes.year}-${partes.month}-${partes.day}`;
  const minutosAgora = Number(partes.hour) * 60 + Number(partes.minute);

  const eventos = await prisma.evento.findMany({
    where: { status: "pendente", data: new Date(`${hoje}T12:00:00Z`) },
    include: { responsaveis: { select: { colaboradorId: true } } },
  });

  let resumoDiario = 0;
  let umaHoraAntes = 0;

  // Resumo da manhã: entre 7h e 7h59, uma vez por dia.
  if (Number(partes.hour) === 7) {
    const porColaborador = new Map();
    for (const evento of eventos) {
      for (const r of evento.responsaveis) {
        porColaborador.set(r.colaboradorId, [...(porColaborador.get(r.colaboradorId) || []), evento]);
      }
    }
    for (const [colaboradorId, lista] of porColaborador) {
      const r = await enviarPushParaColaborador(colaboradorId, {
        titulo: `${lista.length} compromisso${lista.length !== 1 ? "s" : ""} hoje`,
        corpo: lista.slice(0, 3).map((e) => e.titulo).join(" · ") + (lista.length > 3 ? "…" : ""),
        url: "/agenda.html",
        tag: `dia-${hoje}`,
      });
      resumoDiario += r.enviados;
    }
  }

  // Uma hora antes: pega os eventos com horário entre 55 e 65 minutos à
  // frente, para tolerar o intervalo entre as chamadas do cron.
  for (const evento of eventos) {
    if (evento.diaTodo || !evento.horaInicio) continue;
    const [h, m] = String(evento.horaInicio).split(":").map(Number);
    const faltam = (h * 60 + m) - minutosAgora;
    if (faltam < 55 || faltam > 65) continue;

    for (const r of evento.responsaveis) {
      const enviado = await enviarPushParaColaborador(r.colaboradorId, {
        titulo: `Em 1 hora: ${evento.titulo}`,
        corpo: [evento.horaInicio, evento.local].filter(Boolean).join(" · "),
        url: "/agenda.html",
        tag: `evento-${evento.id}`,
      });
      umaHoraAntes += enviado.enviados;
    }
  }

  res.json({ hoje, hora: partes.hour, resumoDiario, umaHoraAntes, eventosDoDia: eventos.length });
}));

module.exports = router;

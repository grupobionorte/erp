const express = require("express");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const { enviarPushParaColaborador } = require("../lib/push");

const router = express.Router();

/* ---------------------------------------------------------------------------
   Agenda: eventos e tarefas com responsáveis.

   A data é guardada ao meio-dia UTC de propósito. O que importa aqui é o
   DIA, não o instante, e gravar à meia-noite faria o evento pular de dia
   conforme o fuso de quem olha.
--------------------------------------------------------------------------- */

const incluir = {
  responsaveis: {
    include: { colaborador: { select: { id: true, nome: true, cargo: true } } },
  },
  criadoPor: { select: { id: true, nome: true } },
};

const dataDoDia = (valor) => new Date(`${String(valor).slice(0, 10)}T12:00:00Z`);

router.get("/", asyncHandler(async (req, res) => {
  const { de, ate, status, responsavelId } = req.query;

  const eventos = await prisma.evento.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ...(status && status !== "todos" ? { status } : {}),
      ...(de || ate ? {
        data: {
          ...(de ? { gte: dataDoDia(de) } : {}),
          ...(ate ? { lte: dataDoDia(ate) } : {}),
        },
      } : {}),
      ...(responsavelId ? { responsaveis: { some: { colaboradorId: Number(responsavelId) } } } : {}),
    },
    include: incluir,
    orderBy: [{ data: "asc" }, { horaInicio: "asc" }, { id: "asc" }],
    take: 500,
  });

  // Contagens que a tela usa para orientar quem abre a agenda.
  const hoje = dataDoDia(new Date().toISOString());
  const pendentes = eventos.filter((e) => e.status === "pendente");

  res.json({
    eventos,
    totais: {
      pendentes: pendentes.length,
      atrasados: pendentes.filter((e) => e.data < hoje).length,
      hoje: pendentes.filter((e) => e.data.getTime() === hoje.getTime()).length,
      concluidos: eventos.filter((e) => e.status === "concluido").length,
    },
  });
}));

router.post("/", asyncHandler(async (req, res) => {
  const { titulo, data, responsaveis, ...dados } = req.body;

  if (!titulo || !data) {
    return res.status(400).json({ erro: "Informe o título e a data" });
  }

  const evento = await prisma.evento.create({
    data: {
      ...dados,
      titulo,
      data: dataDoDia(data),
      empresaId: req.usuario.empresaId || undefined,
      criadoPorId: req.usuario.colaboradorId || undefined,
      responsaveis: responsaveis?.length ? {
        create: responsaveis.map((id) => ({ colaboradorId: Number(id) })),
      } : undefined,
    },
    include: incluir,
  });

  // Avisa quem recebeu a tarefa, menos quem a criou — ninguém precisa de
  // notificação da própria tarefa.
  for (const r of evento.responsaveis) {
    if (r.colaboradorId === req.usuario.colaboradorId) continue;
    await enviarPushParaColaborador(r.colaboradorId, {
      titulo: "Nova tarefa para você",
      corpo: `${evento.titulo} · ${evento.data.toLocaleDateString("pt-BR", { timeZone: "UTC" })}`,
      url: "/agenda.html",
      tag: `evento-${evento.id}`,
    });
  }

  res.status(201).json(evento);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { responsaveis, data, empresaId, criadoPorId, ...dados } = req.body;
  const id = Number(req.params.id);

  // Guarda quem já era responsável, para avisar só quem entrou agora.
  const jaEramResponsaveis = (await prisma.eventoResponsavel.findMany({
    where: { eventoId: id }, select: { colaboradorId: true },
  })).map((r) => r.colaboradorId);

  // Responsáveis são substituídos por inteiro quando informados: é mais
  // previsível do que tentar casar quem entrou e quem saiu.
  if (Array.isArray(responsaveis)) {
    await prisma.eventoResponsavel.deleteMany({ where: { eventoId: id } });
  }

  const evento = await prisma.evento.update({
    where: { id },
    data: {
      ...dados,
      data: data ? dataDoDia(data) : undefined,
      responsaveis: Array.isArray(responsaveis) && responsaveis.length ? {
        create: responsaveis.map((r) => ({ colaboradorId: Number(r) })),
      } : undefined,
    },
    include: incluir,
  });

  // Quem entrou como responsável agora é avisado; quem já era, não.
  if (Array.isArray(responsaveis)) {
    for (const r of evento.responsaveis) {
      if (r.colaboradorId === req.usuario.colaboradorId) continue;
      if (jaEramResponsaveis.includes(r.colaboradorId)) continue;
      await enviarPushParaColaborador(r.colaboradorId, {
        titulo: "Nova tarefa para você",
        corpo: `${evento.titulo} · ${evento.data.toLocaleDateString("pt-BR", { timeZone: "UTC" })}`,
        url: "/agenda.html",
        tag: `evento-${evento.id}`,
      });
    }
  }

  res.json(evento);
}));

// Concluir e reabrir: é a ação mais repetida da agenda, então tem rota
// própria em vez de passar por uma edição inteira.
router.post("/:id/concluir", asyncHandler(async (req, res) => {
  res.json(await prisma.evento.update({
    where: { id: Number(req.params.id) },
    data: {
      status: "concluido",
      concluidoEm: new Date(),
      concluidoPor: req.usuario.colaboradorId || undefined,
    },
    include: incluir,
  }));
}));

router.post("/:id/reabrir", asyncHandler(async (req, res) => {
  res.json(await prisma.evento.update({
    where: { id: Number(req.params.id) },
    data: { status: "pendente", concluidoEm: null, concluidoPor: null },
    include: incluir,
  }));
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  await prisma.evento.delete({ where: { id: Number(req.params.id) } });
  res.status(204).send();
}));

module.exports = router;

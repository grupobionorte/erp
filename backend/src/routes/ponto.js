const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const { apurarPeriodo } = require("../lib/jornada");
const { enviarComprovantePonto } = require("../lib/email");
const router = express.Router();

// Router separado para o aparelho: fica fora do login de usuário, porque
// quem chama é o tablet, não uma pessoa. A credencial é o token do REP.
const routerTablet = express.Router();

async function repDoToken(req, res) {
  const token = req.header("x-rep-token");
  if (!token) {
    res.status(401).json({ erro: "Tablet sem credencial (cabeçalho x-rep-token)" });
    return null;
  }
  const rep = await prisma.rep.findUnique({ where: { token } });
  if (!rep) {
    res.status(401).json({ erro: "Credencial de tablet inválida" });
    return null;
  }
  if (!rep.ativo) {
    res.status(403).json({ erro: "Esse tablet está desativado" });
    return null;
  }
  return rep;
}

// ---------------------------------------------------------------------------
// Controle de ponto — Portaria MTP 671/2021
//
// Três regras moldam este arquivo:
//  1. Marcação não se altera nem se apaga. Não existe PUT nem DELETE aqui.
//  2. O sistema não pode restringir a marcação: nada de bloquear por horário,
//     por escala ou por batida repetida. Duplicidade é problema do
//     fechamento, não da coleta.
//  3. O trabalhador recebe comprovante do que registrou.
// ---------------------------------------------------------------------------

// Encadeia as marcações: cada uma carrega o hash da anterior do mesmo REP.
// Mexer numa batida antiga quebra a corrente e fica evidente na conferência.
function calcularHash({ nsr, cpf, dataHora, repIdentificador, hashAnterior }) {
  const base = [nsr, cpf, new Date(dataHora).toISOString(), repIdentificador, hashAnterior || ""].join("|");
  return crypto.createHash("sha256").update(base).digest("hex");
}

// ---------------------------------------------------------------------------
// Tablet: carga inicial. Traz quem pode bater ponto, com o vetor facial e o
// hash do PIN, para o dispositivo funcionar sem internet.
// ---------------------------------------------------------------------------
routerTablet.get("/carga", asyncHandler(async (req, res) => {
  const rep = await repDoToken(req, res);
  if (!rep) return;

  const colaboradores = await prisma.colaborador.findMany({
    where: { ativo: true, empresaId: rep.empresaId ?? undefined },
    select: {
      id: true, nome: true, cpf: true, cargo: true, setor: true, pinPontoHash: true,
      biometriaFacial: { select: { vetor: true, versaoModelo: true } },
    },
    orderBy: { nome: "asc" },
  });

  res.json({
    rep: { id: rep.id, identificador: rep.identificador, descricao: rep.descricao, ultimoNsr: rep.ultimoNsr },
    servidorEm: new Date().toISOString(),
    colaboradores: colaboradores.map((c) => ({
      id: c.id,
      nome: c.nome,
      cpf: c.cpf,
      cargo: c.cargo,
      setor: c.setor,
      temPin: Boolean(c.pinPontoHash),
      pinHash: c.pinPontoHash,           // conferido no próprio tablet quando offline
      vetorFacial: c.biometriaFacial?.vetor || null,
      versaoModelo: c.biometriaFacial?.versaoModelo || null,
    })),
  });
}));

// ---------------------------------------------------------------------------
// Tablet: envio das batidas. Aceita lote, porque o tablet acumula offline.
// Idempotente pelo idLocal — reenviar o mesmo lote não duplica nada.
// ---------------------------------------------------------------------------
routerTablet.post("/marcacoes", asyncHandler(async (req, res) => {
  const rep = await repDoToken(req, res);
  if (!rep) return;

  const { marcacoes } = req.body;
  if (!Array.isArray(marcacoes) || !marcacoes.length) {
    return res.status(400).json({ erro: "Envie ao menos uma marcação" });
  }

  const resultados = [];

  for (const m of marcacoes) {
    if (!m.idLocal || !m.colaboradorId || !m.dataHora) {
      resultados.push({ idLocal: m.idLocal, situacao: "invalida", motivo: "idLocal, colaboradorId e dataHora são obrigatórios" });
      continue;
    }

    // Já chegou antes (o tablet reenviou porque não viu a confirmação).
    const existente = await prisma.marcacaoPonto.findUnique({ where: { idLocal: m.idLocal } });
    if (existente) {
      resultados.push({ idLocal: m.idLocal, situacao: "duplicada", nsr: existente.nsr, id: existente.id });
      continue;
    }

    const colaborador = await prisma.colaborador.findUnique({ where: { id: Number(m.colaboradorId) } });
    if (!colaborador) {
      resultados.push({ idLocal: m.idLocal, situacao: "invalida", motivo: "Colaborador não encontrado" });
      continue;
    }

    // NSR e hash são atribuídos aqui dentro da transação, para duas batidas
    // simultâneas nunca receberem o mesmo número.
    try {
      const gravada = await prisma.$transaction(async (tx) => {
        const atual = await tx.rep.update({
          where: { id: rep.id },
          data: { ultimoNsr: { increment: 1 } },
        });
        const anterior = await tx.marcacaoPonto.findFirst({
          where: { repId: rep.id },
          orderBy: { nsr: "desc" },
          select: { hash: true },
        });

        const nsr = atual.ultimoNsr;
        const hash = calcularHash({
          nsr,
          cpf: colaborador.cpf,
          dataHora: m.dataHora,
          repIdentificador: rep.identificador,
          hashAnterior: anterior?.hash,
        });

        return tx.marcacaoPonto.create({
          data: {
            nsr,
            repId: rep.id,
            cpf: colaborador.cpf,
            dataHora: new Date(m.dataHora),
            colaboradorId: colaborador.id,
            metodoIdentificacao: m.metodoIdentificacao === "pin" ? "pin" : "facial",
            origemOffline: Boolean(m.origemOffline),
            sincronizadoEm: new Date(),
            idLocal: m.idLocal,
            hashAnterior: anterior?.hash || null,
            hash,
          },
        });
      });

      // Comprovante por e-mail. Sai sem travar a resposta: se o servidor de
      // e-mail estiver fora, a batida já está gravada e quem está na fila do
      // tablet não pode esperar por isso.
      if (process.env.EMAIL_COMPROVANTE_PONTO !== "false") {
        const empresa = rep.empresaId
          ? await prisma.empresa.findUnique({ where: { id: rep.empresaId }, select: { razaoSocial: true, cnpj: true } })
          : null;
        enviarComprovantePonto({ colaborador, marcacao: gravada, rep, empresa })
          .catch((e) => console.error("[ponto] comprovante não enviado:", e.message));
      }

      resultados.push({
        idLocal: m.idLocal,
        situacao: "gravada",
        nsr: gravada.nsr,
        id: gravada.id,
        // O comprovante do trabalhador: o que ele registrou, onde e quando.
        comprovante: {
          nsr: gravada.nsr,
          rep: rep.identificador,
          nome: colaborador.nome,
          cpf: colaborador.cpf,
          dataHora: gravada.dataHora,
          hash: gravada.hash,
        },
      });
    } catch (erro) {
      resultados.push({ idLocal: m.idLocal, situacao: "erro", motivo: erro.message });
    }
  }

  res.status(201).json({ resultados, recebidoEm: new Date().toISOString() });
}));

// ---------------------------------------------------------------------------
// Consulta das marcações (espelho bruto). Somente leitura.
// ---------------------------------------------------------------------------
router.get("/marcacoes", asyncHandler(async (req, res) => {
  const { colaboradorId, de, ate } = req.query;

  const marcacoes = await prisma.marcacaoPonto.findMany({
    where: {
      colaboradorId: colaboradorId ? Number(colaboradorId) : undefined,
      dataHora: {
        gte: de ? new Date(de) : undefined,
        lte: ate ? new Date(`${ate}T23:59:59`) : undefined,
      },
      colaborador: { empresaId: req.usuario.empresaId ?? undefined },
    },
    include: {
      colaborador: { select: { id: true, nome: true, cpf: true, cargo: true } },
      rep: { select: { identificador: true } },
      tratamentos: true,
    },
    orderBy: [{ dataHora: "asc" }],
  });

  res.json(marcacoes);
}));

// Conferência da corrente de hashes: mostra se alguma batida foi mexida
// direto no banco. Vale rodar antes de entregar o espelho na fiscalização.
router.get("/integridade/:repIdentificador", asyncHandler(async (req, res) => {
  const rep = await prisma.rep.findUnique({ where: { identificador: req.params.repIdentificador } });
  if (!rep) return res.status(404).json({ erro: "REP não encontrado" });

  const marcacoes = await prisma.marcacaoPonto.findMany({
    where: { repId: rep.id },
    orderBy: { nsr: "asc" },
  });

  const problemas = [];
  let hashAnterior = null;
  let nsrEsperado = 0;

  for (const m of marcacoes) {
    nsrEsperado += 1;
    if (m.nsr !== nsrEsperado) {
      problemas.push({ nsr: m.nsr, problema: `Salto na numeração: esperado NSR ${nsrEsperado}.` });
      nsrEsperado = m.nsr;
    }
    const esperado = calcularHash({
      nsr: m.nsr, cpf: m.cpf, dataHora: m.dataHora,
      repIdentificador: rep.identificador, hashAnterior,
    });
    if (esperado !== m.hash) {
      problemas.push({ nsr: m.nsr, problema: "Hash não confere — o registro foi alterado depois de gravado." });
    }
    hashAnterior = m.hash;
  }

  res.json({ rep: rep.identificador, total: marcacoes.length, integro: problemas.length === 0, problemas });
}));

// ---------------------------------------------------------------------------
// Tratamento: correções do fechamento. Nunca alteram a marcação original.
// ---------------------------------------------------------------------------
router.post("/tratamentos", asyncHandler(async (req, res) => {
  const { tipo, dataHora, motivo, colaboradorId, marcacaoId } = req.body;

  if (!["inclusao", "desconsideracao", "pre_assinalado"].includes(tipo)) {
    return res.status(400).json({ erro: "tipo deve ser inclusao, desconsideracao ou pre_assinalado" });
  }
  if (!motivo || motivo.trim().length < 5) {
    return res.status(400).json({ erro: "Informe o motivo do tratamento" });
  }
  if (!colaboradorId || !dataHora) {
    return res.status(400).json({ erro: "colaboradorId e dataHora são obrigatórios" });
  }

  const tratamento = await prisma.tratamentoPonto.create({
    data: {
      tipo,
      dataHora: new Date(dataHora),
      motivo: motivo.trim(),
      colaboradorId: Number(colaboradorId),
      marcacaoId: marcacaoId ? Number(marcacaoId) : null,
      autorId: req.usuario?.id,
    },
  });
  res.status(201).json(tratamento);
}));

// ---------------------------------------------------------------------------
// Biometria e PIN. O vetor vem pronto do tablet: a foto não sai do aparelho.
// ---------------------------------------------------------------------------
router.put("/biometria/:colaboradorId", asyncHandler(async (req, res) => {
  const colaboradorId = Number(req.params.colaboradorId);
  const { vetor, versaoModelo, consentimentoTexto } = req.body;

  // Aceita dois formatos: um vetor só (como era) ou uma lista de vetores.
  // Vários perfis por pessoa resolvem o caso de quem alterna óculos e de
  // quem foi cadastrado numa luz muito diferente da do pátio.
  const listaVetores = Array.isArray(vetor?.[0]) ? vetor : [vetor];
  const invalido = !Array.isArray(listaVetores) || !listaVetores.length ||
    listaVetores.some((v) => !Array.isArray(v) || v.length < 32);
  if (invalido) {
    return res.status(400).json({ erro: "Vetor facial inválido" });
  }
  if (listaVetores.length > 5) {
    return res.status(400).json({ erro: "Máximo de 5 perfis de rosto por pessoa" });
  }
  // Sem consentimento registrado não se guarda biometria: é dado sensível.
  if (!consentimentoTexto || consentimentoTexto.trim().length < 20) {
    return res.status(400).json({
      erro: "Registre o texto do consentimento assinado pelo colaborador",
      detalhe: "Biometria facial é dado pessoal sensível (LGPD). O consentimento precisa ficar guardado junto.",
    });
  }

  const biometria = await prisma.biometriaFacial.upsert({
    where: { colaboradorId },
    create: {
      colaboradorId,
      vetor: listaVetores,
      versaoModelo: versaoModelo || "desconhecida",
      consentimentoEm: new Date(),
      consentimentoTexto: consentimentoTexto.trim(),
    },
    update: { vetor: listaVetores, versaoModelo: versaoModelo || "desconhecida" },
    select: { colaboradorId: true, versaoModelo: true, consentimentoEm: true, atualizadoEm: true },
  });

  res.json(biometria);
}));

// Revogar a biometria (o colaborador pode pedir isso a qualquer momento).
router.delete("/biometria/:colaboradorId", asyncHandler(async (req, res) => {
  await prisma.biometriaFacial.deleteMany({ where: { colaboradorId: Number(req.params.colaboradorId) } });
  res.json({ removido: true });
}));

router.put("/pin/:colaboradorId", asyncHandler(async (req, res) => {
  const { pin } = req.body;
  if (!/^\d{4,6}$/.test(String(pin || ""))) {
    return res.status(400).json({ erro: "O PIN deve ter de 4 a 6 dígitos" });
  }
  await prisma.colaborador.update({
    where: { id: Number(req.params.colaboradorId) },
    data: { pinPontoHash: await bcrypt.hash(String(pin), 10) },
  });
  res.json({ definido: true });
}));

// ---------------------------------------------------------------------------
// Jornada de trabalho
// ---------------------------------------------------------------------------
router.get("/jornada/:colaboradorId", asyncHandler(async (req, res) => {
  const jornadas = await prisma.jornadaTrabalho.findMany({
    where: { colaboradorId: Number(req.params.colaboradorId) },
    include: { dias: { orderBy: { diaSemana: "asc" } } },
    orderBy: { vigenciaInicio: "desc" },
  });
  res.json(jornadas);
}));

router.post("/jornada/:colaboradorId", asyncHandler(async (req, res) => {
  const colaboradorId = Number(req.params.colaboradorId);
  const {
    tipo, vigenciaInicio, vigenciaFim, toleranciaMinutos,
    diasTrabalho, diasFolga, deslocamentoPorCiclo, dataReferencia,
    entrada, intervaloInicio, intervaloFim, saida, dias,
  } = req.body;

  if (!vigenciaInicio) return res.status(400).json({ erro: "Informe a partir de quando a jornada vale" });

  const hora = (v) => (v && /^\d{1,2}:\d{2}$/.test(v) ? v : null);

  if (tipo === "escala") {
    if (!hora(entrada) || !hora(saida)) {
      return res.status(400).json({ erro: "Escala precisa de entrada e saída (formato 07:00)" });
    }
    if (!diasTrabalho || !diasFolga) {
      return res.status(400).json({ erro: "Informe quantos dias de trabalho e de folga tem o ciclo" });
    }
    if (!dataReferencia) {
      return res.status(400).json({
        erro: "Informe a data de referência do ciclo",
        detalhe: "É o primeiro dia trabalhado do ciclo. Sem ela não dá para saber quando cai a folga.",
      });
    }
  }

  // Fecha a vigência da jornada anterior no dia anterior ao início da nova,
  // para não existirem duas valendo ao mesmo tempo.
  const anterior = await prisma.jornadaTrabalho.findFirst({
    where: { colaboradorId, vigenciaFim: null },
    orderBy: { vigenciaInicio: "desc" },
  });
  if (anterior) {
    const fim = new Date(vigenciaInicio);
    fim.setDate(fim.getDate() - 1);
    if (fim >= anterior.vigenciaInicio) {
      await prisma.jornadaTrabalho.update({ where: { id: anterior.id }, data: { vigenciaFim: fim } });
    }
  }

  const jornada = await prisma.jornadaTrabalho.create({
    data: {
      colaboradorId,
      tipo: tipo === "semanal" ? "semanal" : "escala",
      vigenciaInicio: new Date(vigenciaInicio),
      vigenciaFim: vigenciaFim ? new Date(vigenciaFim) : null,
      toleranciaMinutos: Number(toleranciaMinutos ?? 10),
      diasTrabalho: diasTrabalho ? Number(diasTrabalho) : null,
      diasFolga: diasFolga ? Number(diasFolga) : null,
      deslocamentoPorCiclo: Number(deslocamentoPorCiclo || 0),
      dataReferencia: dataReferencia ? new Date(dataReferencia) : null,
      entrada: hora(entrada), intervaloInicio: hora(intervaloInicio),
      intervaloFim: hora(intervaloFim), saida: hora(saida),
      dias: tipo === "semanal" && Array.isArray(dias) ? {
        create: dias.map((d) => ({
          diaSemana: Number(d.diaSemana),
          folga: Boolean(d.folga),
          entrada: hora(d.entrada), intervaloInicio: hora(d.intervaloInicio),
          intervaloFim: hora(d.intervaloFim), saida: hora(d.saida),
        })),
      } : undefined,
    },
    include: { dias: true },
  });

  res.status(201).json(jornada);
}));

router.delete("/jornada/:id", asyncHandler(async (req, res) => {
  await prisma.jornadaTrabalho.delete({ where: { id: Number(req.params.id) } });
  res.json({ removido: true });
}));

// ---------------------------------------------------------------------------
// Espelho apurado: batidas x jornada, com totais do período
// ---------------------------------------------------------------------------
router.get("/espelho", asyncHandler(async (req, res) => {
  const { colaboradorId, de, ate } = req.query;
  if (!colaboradorId || !de || !ate) {
    return res.status(400).json({ erro: "Informe colaboradorId, de e ate" });
  }

  const colaborador = await prisma.colaborador.findUnique({
    where: { id: Number(colaboradorId) },
    select: { id: true, nome: true, cpf: true, cargo: true, setor: true },
  });
  if (!colaborador) return res.status(404).json({ erro: "Colaborador não encontrado" });

  // A jornada usada é a vigente no início do período. Se a jornada mudou no
  // meio do mês, a apuração pega a que valia — por isso a vigência existe.
  const jornada = await prisma.jornadaTrabalho.findFirst({
    where: {
      colaboradorId: colaborador.id,
      vigenciaInicio: { lte: new Date(`${ate}T23:59:59`) },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: new Date(`${de}T00:00:00`) } }],
    },
    include: { dias: true },
    orderBy: { vigenciaInicio: "desc" },
  });

  const marcacoes = await prisma.marcacaoPonto.findMany({
    where: {
      colaboradorId: colaborador.id,
      dataHora: { gte: new Date(`${de}T00:00:00`), lte: new Date(`${ate}T23:59:59`) },
    },
    include: { tratamentos: true },
    orderBy: { dataHora: "asc" },
  });

  const apuracao = apurarPeriodo({ de, ate, marcacoes, jornada });
  res.json({ colaborador, jornada, ...apuracao });
}));

// ---------------------------------------------------------------------------
// REPs (tablets)
// ---------------------------------------------------------------------------
router.get("/reps", asyncHandler(async (req, res) => {
  const reps = await prisma.rep.findMany({
    where: { empresaId: req.usuario.empresaId ?? undefined },
    orderBy: { identificador: "asc" },
    select: {
      id: true, identificador: true, descricao: true, localizacao: true,
      ultimoNsr: true, ativo: true, criadoEm: true,
      _count: { select: { marcacoes: true } },
    },
  });
  // O token só aparece na criação: depois disso ele não é mais exibido,
  // como qualquer credencial.
  res.json(reps);
}));

// Situação de cada colaborador no ponto: quem já tem PIN, quem tem rosto
// cadastrado e desde quando. É a tela de acompanhamento do RH.
router.get("/colaboradores", asyncHandler(async (req, res) => {
  const colaboradores = await prisma.colaborador.findMany({
    where: { ativo: true, empresaId: req.usuario.empresaId ?? undefined },
    select: {
      id: true, nome: true, cpf: true, cargo: true, setor: true, pinPontoHash: true,
      biometriaFacial: { select: { consentimentoEm: true, atualizadoEm: true, versaoModelo: true } },
    },
    orderBy: { nome: "asc" },
  });

  res.json(colaboradores.map((c) => ({
    id: c.id, nome: c.nome, cpf: c.cpf, cargo: c.cargo, setor: c.setor,
    temPin: Boolean(c.pinPontoHash),
    // O vetor em si nunca sai daqui — a tela só precisa saber se existe.
    temBiometria: Boolean(c.biometriaFacial),
    biometriaEm: c.biometriaFacial?.atualizadoEm || null,
    consentimentoEm: c.biometriaFacial?.consentimentoEm || null,
  })));
}));

// Ativar ou desativar um tablet (o aparelho sumiu, foi para manutenção...).
router.put("/reps/:id", asyncHandler(async (req, res) => {
  const { ativo, descricao, localizacao } = req.body;
  const rep = await prisma.rep.update({
    where: { id: Number(req.params.id) },
    data: {
      ativo: typeof ativo === "boolean" ? ativo : undefined,
      descricao: descricao ?? undefined,
      localizacao: localizacao ?? undefined,
    },
  });
  res.json({ ...rep, token: undefined });
}));

// Gera um token novo para o tablet. Serve para quando o token se perdeu,
// quando o aparelho foi trocado, ou quando dois tablets acabaram com a
// mesma credencial — o antigo para de funcionar na hora.
router.post("/reps/:id/novo-token", asyncHandler(async (req, res) => {
  const rep = await prisma.rep.update({
    where: { id: Number(req.params.id) },
    data: { token: crypto.randomBytes(24).toString("hex") },
  });
  res.json({ identificador: rep.identificador, token: rep.token });
}));

router.post("/reps", asyncHandler(async (req, res) => {
  const { identificador, descricao, localizacao } = req.body;
  if (!identificador) return res.status(400).json({ erro: "identificador é obrigatório" });

  const rep = await prisma.rep.create({
    data: {
      identificador: identificador.trim().toUpperCase(),
      // Mostrado uma vez na criação; é o que se configura no tablet.
      token: crypto.randomBytes(24).toString("hex"),
      descricao: descricao || undefined,
      localizacao: localizacao || undefined,
      empresaId: req.usuario.empresaId || undefined,
    },
  });
  res.status(201).json(rep);
}));

module.exports = { router, routerTablet };

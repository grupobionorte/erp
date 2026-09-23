const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
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

  if (!Array.isArray(vetor) || vetor.length < 32) {
    return res.status(400).json({ erro: "Vetor facial inválido" });
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
      vetor,
      versaoModelo: versaoModelo || "desconhecida",
      consentimentoEm: new Date(),
      consentimentoTexto: consentimentoTexto.trim(),
    },
    update: { vetor, versaoModelo: versaoModelo || "desconhecida" },
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
// REPs (tablets)
// ---------------------------------------------------------------------------
router.get("/reps", asyncHandler(async (req, res) => {
  const reps = await prisma.rep.findMany({
    where: { empresaId: req.usuario.empresaId ?? undefined },
    orderBy: { identificador: "asc" },
  });
  res.json(reps);
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

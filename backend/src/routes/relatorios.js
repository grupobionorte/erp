const express = require("express");
const archiver = require("archiver");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

/* ---------------------------------------------------------------------------
   Relatórios.

   Devolvem dados já apurados — a tela só exibe e manda imprimir. A conta
   fica aqui para que o total do papel e o total do sistema venham da mesma
   fonte.
--------------------------------------------------------------------------- */

// Início e fim do dia no fuso da operação. Sem isso, uma nota emitida às 21h
// de Mato Grosso cairia no dia seguinte e sumiria do relatório do mês.
function intervaloNoFuso(de, ate) {
  const zona = process.env.TZ_FISCAL || "America/Cuiaba";
  const offset = (dia) => {
    const nome = new Intl.DateTimeFormat("en-US", { timeZone: zona, timeZoneName: "longOffset" })
      .formatToParts(new Date(`${dia}T12:00:00Z`))
      .find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
    return nome;
  };
  return {
    inicio: new Date(`${de}T00:00:00${offset(de)}`),
    fim: new Date(`${ate}T23:59:59${offset(ate)}`),
  };
}

/**
 * Relação de NF-e emitidas, por período e opcionalmente por cliente.
 */
router.get("/nfe", asyncHandler(async (req, res) => {
  const { de, ate, destinatarioId, status: statusPedido } = req.query;
  if (!de || !ate) return res.status(400).json({ erro: "Informe o período (de e ate)" });

  const { inicio, fim } = intervaloNoFuso(de, ate);

  // Só o que virou documento: rascunho e rejeitado não entram numa relação
  // de notas emitidas.
  const status = statusPedido === "todas" ? ["autorizado", "cancelado"]
    : statusPedido === "cancelado" ? ["cancelado"]
    : ["autorizado"];

  const notas = await prisma.documentoFiscal.findMany({
    where: {
      tipo: "NFe",
      empresaId: req.usuario.empresaId || undefined,
      status: { in: status },
      dataEmissao: { gte: inicio, lte: fim },
      ...(destinatarioId ? { destinatarioId: Number(destinatarioId) } : {}),
    },
    include: {
      destinatario: { select: { id: true, nomeRazaoSocial: true, documento: true } },
      // Só a contagem interessa aqui — os itens em si não entram na
      // relação, e pedir campos que o modelo não tem quebrava a consulta.
      itens: { select: { id: true } },
    },
    orderBy: [{ numero: "asc" }],
  });

  const linhas = notas.map((n) => ({
    id: n.id,
    numero: n.numero,
    serie: n.serie,
    dataEmissao: n.dataEmissao,
    status: n.status,
    chaveAcesso: n.chaveAcesso,
    cliente: n.destinatario?.nomeRazaoSocial || "—",
    documentoCliente: n.destinatario?.documento || "",
    naturezaOperacao: n.naturezaOperacao,
    valorTotal: Number(n.valorTotal) || 0,
    quantidadeItens: n.itens.length,
  }));

  // Canceladas não somam no faturamento — aparecem para conferência, com
  // valor zerado no total.
  const validas = linhas.filter((l) => l.status === "autorizado");

  res.json({
    periodo: { de, ate },
    linhas,
    totais: {
      notas: linhas.length,
      autorizadas: validas.length,
      canceladas: linhas.length - validas.length,
      valorTotal: validas.reduce((t, l) => t + l.valorTotal, 0),
    },
    porCliente: Object.values(
      validas.reduce((acc, l) => {
        const chave = l.documentoCliente || l.cliente;
        acc[chave] = acc[chave] || { cliente: l.cliente, documento: l.documentoCliente, notas: 0, valor: 0 };
        acc[chave].notas += 1;
        acc[chave].valor += l.valorTotal;
        return acc;
      }, {})
    ).sort((a, b) => b.valor - a.valor),
  });
}));

/**
 * Pacote com os XMLs do período, para enviar ao contador.
 *
 * Os arquivos ficam no provedor; aqui eles são baixados e compactados em
 * memória. É um zip por mês, com dezenas de arquivos pequenos — não
 * compensa gravar nada em disco.
 */
router.get("/nfe/xmls", asyncHandler(async (req, res) => {
  const { de, ate, status: statusPedido } = req.query;
  if (!de || !ate) return res.status(400).json({ erro: "Informe o período (de e ate)" });

  const { inicio, fim } = intervaloNoFuso(de, ate);
  const status = statusPedido === "todas" ? ["autorizado", "cancelado"]
    : statusPedido === "cancelado" ? ["cancelado"]
    : ["autorizado"];

  const notas = await prisma.documentoFiscal.findMany({
    where: {
      tipo: "NFe",
      empresaId: req.usuario.empresaId || undefined,
      status: { in: status },
      dataEmissao: { gte: inicio, lte: fim },
      xmlUrl: { not: null },
    },
    select: { numero: true, chaveAcesso: true, xmlUrl: true, status: true },
    orderBy: { numero: "asc" },
  });

  if (!notas.length) {
    return res.status(404).json({ erro: "Nenhuma nota com XML no período" });
  }

  const nomeArquivo = `XMLs-NFe-${de}-a-${ate}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);

  const pacote = archiver("zip", { zlib: { level: 9 } });
  const falhas = [];
  pacote.on("warning", (e) => console.warn("[xmls]", e.message));
  pacote.on("error", (e) => { console.error("[xmls]", e); res.destroy(); });
  pacote.pipe(res);

  for (const nota of notas) {
    try {
      const resposta = await fetch(nota.xmlUrl);
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const xml = Buffer.from(await resposta.arrayBuffer());
      // Nome com número e chave: o contador acha pelo número, e a chave
      // garante que dois arquivos nunca colidam.
      const nome = `${nota.status === "cancelado" ? "CANCELADA-" : ""}` +
        `NFe-${String(nota.numero || "s-n").padStart(6, "0")}-${nota.chaveAcesso || ""}.xml`;
      pacote.append(xml, { name: nome });
    } catch (erro) {
      falhas.push(`NF-e ${nota.numero}: ${erro.message}`);
    }
  }

  // Um aviso dentro do próprio zip: melhor o contador saber que faltou
  // arquivo do que descobrir na conferência.
  if (falhas.length) {
    pacote.append(
      `Não foi possível baixar ${falhas.length} arquivo(s):\n\n${falhas.join("\n")}\n`,
      { name: "ARQUIVOS-QUE-FALTARAM.txt" }
    );
  }

  await pacote.finalize();
}));

/**
 * Total de NF-e por cliente no mês corrente. Serve ao painel inicial: a
 * pergunta "quanto a Alvorada comprou este mês" não deveria exigir abrir
 * relatório e escolher período.
 */
router.get("/nfe/por-cliente", asyncHandler(async (req, res) => {
  const ids = String(req.query.clientes || "")
    .split(",")
    .map((i) => Number(i))
    .filter(Boolean)
    .slice(0, 3);

  if (!ids.length) return res.json({ periodo: null, clientes: [] });

  // Mês corrente no fuso da operação.
  const zona = process.env.TZ_FISCAL || "America/Cuiaba";
  const agora = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(agora).map((x) => [x.type, x.value])
  );
  const primeiroDia = `${p.year}-${p.month}-01`;
  const ultimoDia = new Date(Date.UTC(Number(p.year), Number(p.month), 0)).toISOString().slice(0, 10);
  const { inicio, fim } = intervaloNoFuso(primeiroDia, ultimoDia);

  const notas = await prisma.documentoFiscal.findMany({
    where: {
      tipo: "NFe",
      empresaId: req.usuario.empresaId || undefined,
      status: "autorizado",
      destinatarioId: { in: ids },
      dataEmissao: { gte: inicio, lte: fim },
    },
    select: { destinatarioId: true, valorTotal: true },
  });

  const pessoas = await prisma.pessoa.findMany({
    where: { id: { in: ids } },
    select: { id: true, nomeRazaoSocial: true },
  });

  res.json({
    periodo: { de: primeiroDia, ate: ultimoDia },
    clientes: ids.map((id) => {
      const doCliente = notas.filter((n) => n.destinatarioId === id);
      return {
        id,
        nome: pessoas.find((x) => x.id === id)?.nomeRazaoSocial || "—",
        quantidade: doCliente.length,
        valor: doCliente.reduce((t, n) => t + (Number(n.valorTotal) || 0), 0),
      };
    }),
  });
}));

module.exports = router;

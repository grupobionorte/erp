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
const { intervaloNoFuso, partesNoFuso } = require("../lib/fuso");

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
 * Relatório de CT-e emitidos, no layout do sistema anterior: uma linha por
 * conhecimento, com pesos, valor das notas, ICMS e valor do serviço, e os
 * totais no fim. Cancelado aparece na lista, mas sem valores e fora das
 * somas — como no modelo.
 */
router.get("/cte", asyncHandler(async (req, res) => {
  const { de, ate, status: statusPedido } = req.query;
  if (!de || !ate) return res.status(400).json({ erro: "Informe o período (de e ate)" });

  const { inicio, fim } = intervaloNoFuso(de, ate);
  const status = statusPedido === "autorizado" ? ["autorizado"]
    : statusPedido === "cancelado" ? ["cancelado"]
    : ["autorizado", "cancelado"];

  const pessoa = { select: { id: true, nomeRazaoSocial: true } };
  const [ctes, empresa] = await Promise.all([
    prisma.documentoFiscal.findMany({
      where: {
        tipo: "CTe",
        empresaId: req.usuario.empresaId || undefined,
        status: { in: status },
        dataEmissao: { gte: inicio, lte: fim },
      },
      include: {
        remetente: pessoa, destinatario: pessoa, expedidor: pessoa, recebedor: pessoa,
        documentosTransportados: {
          select: { pesoBruto: true, pesoLiquido: true, quantidadeVolumes: true, valorTotalNota: true },
        },
      },
      orderBy: [{ numero: "asc" }, { dataEmissao: "asc" }],
    }),
    req.usuario.empresaId
      ? prisma.empresa.findUnique({
          where: { id: req.usuario.empresaId },
          select: { razaoSocial: true, cnpj: true, ie: true, endereco: { select: { cep: true, cidade: true, uf: true } } },
        })
      : null,
  ]);

  const somar = (docs, campo) => docs.reduce((t, d) => t + (Number(d[campo]) || 0), 0);
  const linhas = ctes.map((c) => {
    // Cliente do relatório é o tomador: quem contrata e paga o frete.
    const tomador = {
      Remetente: c.remetente, Expedidor: c.expedidor, Recebedor: c.recebedor, Destinatário: c.destinatario,
    }[c.definicaoTomador] || c.destinatario || c.remetente;
    const cancelado = c.status === "cancelado";
    const docs = c.documentosTransportados || [];
    return {
      id: c.id,
      dia: c.dataEmissao ? partesNoFuso(new Date(c.dataEmissao)).dia : null,
      numero: c.numero,
      serie: c.serie,
      cliente: tomador?.nomeRazaoSocial || "—",
      clienteId: tomador?.id || null,
      situacao: cancelado ? "Cancelado" : "Normal",
      cancelado,
      pesoBruto: somar(docs, "pesoBruto"),
      pesoLiquido: somar(docs, "pesoLiquido"),
      volumes: somar(docs, "quantidadeVolumes"),
      // O CT-e do sistema não tem componente de pedágio: sai zero, que é o
      // que foi para a SEFAZ.
      pedagio: 0,
      valorNotas: somar(docs, "valorTotalNota"),
      valorIcms: Number(c.valorIcms) || 0,
      aliquotaIcms: Number(c.aliquotaIcmsPrestacao) || 0,
      valorServico: Number(c.valorTotal) || 0,
      // Valor a receber é o da prestação: é o que o payload manda à SEFAZ.
      valorReceber: Number(c.valorTotal) || 0,
    };
  });

  const validas = linhas.filter((l) => !l.cancelado);
  const total = (campo) => validas.reduce((t, l) => t + l[campo], 0);

  res.json({
    periodo: { de, ate },
    empresa,
    linhas,
    totais: {
      quantidade: linhas.length,
      autorizados: validas.length,
      cancelados: linhas.length - validas.length,
      pesoBruto: total("pesoBruto"),
      pesoLiquido: total("pesoLiquido"),
      volumes: total("volumes"),
      pedagio: total("pedagio"),
      valorNotas: total("valorNotas"),
      valorIcms: total("valorIcms"),
      valorServico: total("valorServico"),
      valorReceber: total("valorReceber"),
    },
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
    .slice(0, 6);

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
    select: {
      destinatarioId: true,
      valorTotal: true,
      // A quantidade que interessa é a de mercadoria, não a de notas. Vem
      // dos itens, somada por unidade — misturar tonelada com metro cúbico
      // daria um número sem significado.
      itens: { select: { quantidade: true, produto: { select: { unidade: true } } } },
    },
  });

  const pessoas = await prisma.pessoa.findMany({
    where: { id: { in: ids } },
    // O fantasia é como a operação chama o cliente; a razão social fica de
    // reserva para quem não tem fantasia cadastrado.
    select: { id: true, nomeRazaoSocial: true, nomeFantasia: true },
  });

  res.json({
    periodo: { de: primeiroDia, ate: ultimoDia },
    clientes: ids.map((id) => {
      const doCliente = notas.filter((n) => n.destinatarioId === id);
      const pessoa = pessoas.find((x) => x.id === id);

      const porUnidade = new Map();
      for (const nota of doCliente) {
        for (const item of nota.itens) {
          const unidade = (item.produto?.unidade || "UN").toUpperCase();
          porUnidade.set(unidade, (porUnidade.get(unidade) || 0) + (Number(item.quantidade) || 0));
        }
      }

      return {
        id,
        nome: pessoa?.nomeFantasia || pessoa?.nomeRazaoSocial || "—",
        razaoSocial: pessoa?.nomeRazaoSocial || "",
        notas: doCliente.length,
        // Ordenado pela maior quantidade: é a unidade principal do cliente.
        quantidades: [...porUnidade.entries()]
          .map(([unidade, quantidade]) => ({ unidade, quantidade }))
          .sort((a, b) => b.quantidade - a.quantidade),
        valor: doCliente.reduce((t, n) => t + (Number(n.valorTotal) || 0), 0),
      };
    }),
  });
}));

module.exports = router;

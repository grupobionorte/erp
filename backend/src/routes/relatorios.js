const express = require("express");

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
  const { de, ate, destinatarioId, incluirCanceladas } = req.query;
  if (!de || !ate) return res.status(400).json({ erro: "Informe o período (de e ate)" });

  const { inicio, fim } = intervaloNoFuso(de, ate);

  // Só o que virou documento: rascunho e rejeitado não entram numa relação
  // de notas emitidas.
  const status = incluirCanceladas === "1" ? ["autorizado", "cancelado"] : ["autorizado"];

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
      itens: { select: { quantidade: true, valorTotal: true, descricao: true } },
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

module.exports = router;

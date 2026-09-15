const express = require("express");
const prisma = require("../lib/prisma");
const focusNfe = require("../services/focusNfe");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const documentos = await prisma.documentoFiscal.findMany({
    include: { destinatario: true, transportadora: true, itens: true },
    orderBy: { dataEmissao: "desc" },
  });
  res.json(documentos);
}));

// Passo 1: monta o rascunho da NFe a partir dos cadastros — é aqui que os
// cadastros de clientes e produtos "viram" um documento fiscal.
router.post("/nfe/rascunho", asyncHandler(async (req, res) => {
  const { empresaId, destinatarioId, transportadoraId, itens } = req.body;

  if (!empresaId || !destinatarioId || !itens?.length) {
    return res.status(400).json({ erro: "empresaId, destinatarioId e itens são obrigatórios" });
  }

  const produtos = await prisma.produto.findMany({
    where: { id: { in: itens.map((i) => i.produtoId) } },
  });

  const itensCalculados = itens.map((item) => {
    const produto = produtos.find((p) => p.id === item.produtoId);
    if (!produto) throw new Error(`Produto ${item.produtoId} não encontrado`);
    const valorUnitario = item.valorUnitario ?? produto.valorUnitario ?? 0;
    return {
      produtoId: produto.id,
      quantidade: item.quantidade,
      valorUnitario,
      valorTotal: valorUnitario * item.quantidade,
      cfopUtilizado: item.cfopUtilizado || produto.cfopPadrao,
    };
  });

  const valorTotal = itensCalculados.reduce((soma, i) => soma + i.valorTotal, 0);

  const documento = await prisma.documentoFiscal.create({
    data: {
      tipo: "NFe",
      status: "rascunho",
      empresaId,
      destinatarioId,
      transportadoraId: transportadoraId || undefined,
      valorTotal,
      itens: { create: itensCalculados },
    },
    include: { itens: true, destinatario: true, transportadora: true },
  });

  res.status(201).json(documento);
}));

// Rascunho de CTe — o tomador do serviço normalmente é o destinatário da
// mercadoria (quem recebe e paga o frete). transportadoraId aqui é
// informativo, caso o frete seja subcontratado de terceiros.
router.post("/cte/rascunho", asyncHandler(async (req, res) => {
  const { empresaId, tomadorId, transportadoraId, valorTotal } = req.body;

  if (!empresaId || !tomadorId || !valorTotal) {
    return res.status(400).json({ erro: "empresaId, tomadorId e valorTotal são obrigatórios" });
  }

  const documento = await prisma.documentoFiscal.create({
    data: {
      tipo: "CTe",
      status: "rascunho",
      empresaId,
      destinatarioId: tomadorId,
      transportadoraId: transportadoraId || undefined,
      valorTotal,
    },
    include: { destinatario: true, transportadora: true },
  });

  res.status(201).json(documento);
}));

// Rascunho de MDFe — reúne o veículo, o motorista e as NFe/CTe (já
// autorizadas) que vão ser transportadas nessa viagem.
router.post("/mdfe/rascunho", asyncHandler(async (req, res) => {
  const { empresaId, transportadoraId, veiculoId, nomeMotorista, cpfMotorista, ufPercurso, documentosVinculadosIds } = req.body;

  if (!empresaId || !transportadoraId || !veiculoId || !documentosVinculadosIds?.length) {
    return res.status(400).json({
      erro: "empresaId, transportadoraId, veiculoId e documentosVinculadosIds são obrigatórios",
    });
  }

  const documentosVinculados = await prisma.documentoFiscal.findMany({
    where: { id: { in: documentosVinculadosIds }, status: "autorizado" },
  });

  if (documentosVinculados.length !== documentosVinculadosIds.length) {
    return res.status(400).json({
      erro: "Todos os documentos vinculados precisam existir e estar autorizados",
    });
  }

  const documento = await prisma.documentoFiscal.create({
    data: {
      tipo: "MDFe",
      status: "rascunho",
      empresaId,
      transportadoraId,
      veiculoId,
      nomeMotorista,
      cpfMotorista,
      ufPercurso,
      documentosVinculados: { connect: documentosVinculadosIds.map((id) => ({ id })) },
    },
    include: { veiculo: true, transportadora: true, documentosVinculados: true },
  });

  res.status(201).json(documento);
}));

// Passo 2: envia o rascunho para o provedor de emissão. Fica separado do
// passo 1 de propósito — permite revisar o rascunho antes de emitir de
// verdade, já que a emissão é irreversível (exige evento de cancelamento).
router.post("/:id/emitir", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const documento = await prisma.documentoFiscal.findUnique({
    where: { id },
    include: {
      empresa: true,
      destinatario: { include: { endereco: true } },
      itens: { include: { produto: true } },
      veiculo: true,
      documentosVinculados: true,
    },
  });

  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.status !== "rascunho") {
    return res.status(409).json({ erro: `Documento já está em status "${documento.status}"` });
  }

  // Cada tipo de documento tem um payload diferente — NFe leva itens de
  // produto, CTe leva o tomador do frete, MDFe leva veículo/motorista e as
  // chaves de acesso dos documentos que está transportando.
  const payload =
    documento.tipo === "NFe"
      ? focusNfe.montarPayloadNfe({
          empresa: documento.empresa,
          destinatario: documento.destinatario,
          itens: documento.itens,
        })
      : documento.tipo === "CTe"
      ? focusNfe.montarPayloadCte({
          empresa: documento.empresa,
          tomador: documento.destinatario,
          valorTotal: documento.valorTotal,
        })
      : focusNfe.montarPayloadMdfe({
          empresa: documento.empresa,
          veiculo: documento.veiculo,
          nomeMotorista: documento.nomeMotorista,
          cpfMotorista: documento.cpfMotorista,
          ufPercurso: documento.ufPercurso,
          documentosVinculados: documento.documentosVinculados,
        });

  const ref = `${documento.tipo.toLowerCase()}-${documento.id}`;

  try {
    await focusNfe.emitir({ tipo: documento.tipo, ref, payload });
    const atualizado = await prisma.documentoFiscal.update({
      where: { id },
      data: { status: "enviado" },
    });
    res.json(atualizado);
  } catch (erro) {
    await prisma.documentoFiscal.update({
      where: { id },
      data: { status: "rejeitado", motivoRejeicao: erro.message },
    });
    res.status(502).json({ erro: "Falha ao enviar para o provedor", detalhe: erro.message });
  }
}));

// Passo 3: consulta o status na Focus NFe e atualiza o registro local —
// chame periodicamente (ou via webhook do provedor) até sair de "enviado".
router.get("/:id/status", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const documento = await prisma.documentoFiscal.findUnique({ where: { id } });
  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });

  const ref = `${documento.tipo.toLowerCase()}-${documento.id}`;
  const resultado = await focusNfe.consultar({ tipo: documento.tipo, ref });

  if (resultado.status === "autorizado") {
    // A Focus NFe nomeia os campos de retorno de forma diferente por tipo
    // de documento (chave_nfe / chave_cte / chave_mdfe e o mesmo padrão
    // para o XML e o PDF — DANFE, DACTE ou DAMDFE).
    const CAMPOS_POR_TIPO = {
      NFe: { chave: "chave_nfe", xml: "caminho_xml_nota_fiscal", pdf: "caminho_danfe" },
      CTe: { chave: "chave_cte", xml: "caminho_xml_cte", pdf: "caminho_dacte" },
      MDFe: { chave: "chave_mdfe", xml: "caminho_xml_mdfe", pdf: "caminho_damdfe" },
    };
    const campos = CAMPOS_POR_TIPO[documento.tipo];

    const atualizado = await prisma.documentoFiscal.update({
      where: { id },
      data: {
        status: "autorizado",
        chaveAcesso: resultado[campos.chave],
        protocoloAutorizacao: resultado.numero_protocolo,
        dataAutorizacao: new Date(),
        xmlUrl: resultado[campos.xml],
        pdfUrl: resultado[campos.pdf],
      },
    });
    return res.json(atualizado);
  }

  if (resultado.status === "erro_autorizacao") {
    const atualizado = await prisma.documentoFiscal.update({
      where: { id },
      data: { status: "rejeitado", motivoRejeicao: resultado.mensagem_sefaz },
    });
    return res.json(atualizado);
  }

  res.json({ ...documento, statusProvedor: resultado.status });
}));

module.exports = router;

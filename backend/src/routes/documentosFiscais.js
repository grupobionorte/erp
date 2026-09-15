const express = require("express");
const prisma = require("../lib/prisma");
const focusNfe = require("../services/focusNfe");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const { tipo } = req.query;
  const { empresaId } = req.usuario;

  const documentos = await prisma.documentoFiscal.findMany({
    where: {
      ...(tipo ? { tipo } : {}),
      ...(empresaId ? { OR: [{ empresaId }, { empresaId: null }] } : { empresaId: null }),
    },
    include: { destinatario: true, transportadora: true, itens: { include: { produto: true } } },
    orderBy: { dataEmissao: "desc" },
  });
  res.json(documentos);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const documento = await prisma.documentoFiscal.findUnique({
    where: { id: Number(req.params.id) },
    include: { destinatario: true, transportadora: true, itens: { include: { produto: true } } },
  });
  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  res.json(documento);
}));

// Passo 1: monta o rascunho da NFe a partir dos cadastros — é aqui que os
// cadastros de clientes e produtos "viram" um documento fiscal. Número e
// série vêm automaticamente da numeração configurada em Configurações
// para a empresa da sessão atual (e o contador já sai incrementado, pra
// nunca repetir número mesmo com duas pessoas emitindo ao mesmo tempo).
router.post("/nfe/rascunho", asyncHandler(async (req, res) => {
  const { empresaId } = req.usuario;
  const { destinatarioId, transportadoraId, naturezaOperacao, modalidadeFrete, dataSaida, informacoesComplementares, itens } = req.body;

  if (!empresaId) {
    return res.status(400).json({ erro: "Escolha uma empresa (na tela de login) antes de emitir notas fiscais" });
  }
  if (!destinatarioId || !itens?.length) {
    return res.status(400).json({ erro: "destinatarioId e itens são obrigatórios" });
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) return res.status(400).json({ erro: "Empresa inválida" });

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

  // Incrementa o contador da empresa antes de usar o número — assim duas
  // notas nunca saem com o mesmo número, mesmo se forem criadas ao mesmo
  // tempo por pessoas diferentes.
  const empresaAtualizada = await prisma.empresa.update({
    where: { id: empresaId },
    data: { nfeProximoNumero: { increment: 1 } },
  });
  const numero = empresaAtualizada.nfeProximoNumero - 1;
  const serie = Number.parseInt(empresa.nfeSerie, 10);

  const documento = await prisma.documentoFiscal.create({
    data: {
      tipo: "NFe",
      status: "rascunho",
      empresaId,
      destinatarioId,
      transportadoraId: transportadoraId || undefined,
      numero,
      serie: Number.isNaN(serie) ? undefined : serie,
      naturezaOperacao: naturezaOperacao || undefined,
      modalidadeFrete: modalidadeFrete || undefined,
      dataSaida: dataSaida ? new Date(dataSaida) : undefined,
      informacoesComplementares: informacoesComplementares || undefined,
      valorTotal,
      itens: { create: itensCalculados },
    },
    include: { itens: { include: { produto: true } }, destinatario: true, transportadora: true },
  });

  res.status(201).json(documento);
}));

// Rascunho de CTe — o tomador do serviço normalmente é o destinatário da
// mercadoria (quem recebe e paga o frete). transportadoraId aqui é
// informativo, caso o frete seja subcontratado de terceiros.
// Rascunho de CTe — o tomador do serviço normalmente é o destinatário da
// mercadoria (quem recebe e paga o frete). Número e série vêm da
// numeração de CTe configurada em Configurações, igual a NFe.
router.post("/cte/rascunho", asyncHandler(async (req, res) => {
  const { empresaId } = req.usuario;
  const {
    tomadorId, transportadoraId, veiculoId, nomeMotorista, cpfMotorista,
    origemPercurso, destinoPercurso, naturezaOperacao, informacoesComplementares, valorTotal,
  } = req.body;

  if (!empresaId) {
    return res.status(400).json({ erro: "Escolha uma empresa (na tela de login) antes de emitir CTe" });
  }
  if (!tomadorId || !valorTotal) {
    return res.status(400).json({ erro: "tomadorId e valorTotal são obrigatórios" });
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) return res.status(400).json({ erro: "Empresa inválida" });

  const empresaAtualizada = await prisma.empresa.update({
    where: { id: empresaId },
    data: { cteProximoNumero: { increment: 1 } },
  });
  const numero = empresaAtualizada.cteProximoNumero - 1;
  const serie = Number.parseInt(empresa.cteSerie, 10);

  const documento = await prisma.documentoFiscal.create({
    data: {
      tipo: "CTe",
      status: "rascunho",
      empresaId,
      destinatarioId: tomadorId,
      transportadoraId: transportadoraId || undefined,
      veiculoId: veiculoId || undefined,
      nomeMotorista: nomeMotorista || undefined,
      cpfMotorista: cpfMotorista || undefined,
      origemPercurso: origemPercurso || undefined,
      destinoPercurso: destinoPercurso || undefined,
      naturezaOperacao: naturezaOperacao || undefined,
      informacoesComplementares: informacoesComplementares || undefined,
      numero,
      serie: Number.isNaN(serie) ? undefined : serie,
      valorTotal,
    },
    include: { destinatario: true, transportadora: true, veiculo: true },
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

// Edita um rascunho (ainda não emitido) — recalcula os itens e o total
// se uma lista nova de itens for enviada.
router.put("/:id", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const existente = await prisma.documentoFiscal.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Documento não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }
  if (existente.status !== "rascunho") {
    return res.status(409).json({ erro: "Só é possível editar documentos em rascunho" });
  }

  const {
    destinatarioId, transportadoraId, naturezaOperacao, modalidadeFrete, dataSaida, informacoesComplementares, itens,
    veiculoId, nomeMotorista, cpfMotorista, origemPercurso, destinoPercurso, valorTotal: valorTotalManual,
  } = req.body;

  let dadosItens = {};
  let valorTotal = existente.valorTotal;

  if (itens?.length) {
    const produtos = await prisma.produto.findMany({ where: { id: { in: itens.map((i) => i.produtoId) } } });
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
    valorTotal = itensCalculados.reduce((soma, i) => soma + i.valorTotal, 0);
    // Troca os itens antigos pelos novos — mais simples do que tentar
    // casar item a item, e o documento ainda é só um rascunho.
    await prisma.documentoItem.deleteMany({ where: { documentoId: id } });
    dadosItens = { itens: { create: itensCalculados } };
  } else if (valorTotalManual != null) {
    // CTe não tem itens de produto — o valor da prestação é digitado
    // direto (não é calculado a partir de uma lista).
    valorTotal = valorTotalManual;
  }

  const documento = await prisma.documentoFiscal.update({
    where: { id },
    data: {
      destinatarioId: destinatarioId || undefined,
      transportadoraId: transportadoraId === null ? null : transportadoraId || undefined,
      veiculoId: veiculoId === null ? null : veiculoId || undefined,
      nomeMotorista: nomeMotorista ?? undefined,
      cpfMotorista: cpfMotorista ?? undefined,
      origemPercurso: origemPercurso ?? undefined,
      destinoPercurso: destinoPercurso ?? undefined,
      naturezaOperacao: naturezaOperacao ?? undefined,
      modalidadeFrete: modalidadeFrete ?? undefined,
      dataSaida: dataSaida ? new Date(dataSaida) : undefined,
      informacoesComplementares: informacoesComplementares ?? undefined,
      valorTotal,
      ...dadosItens,
    },
    include: { itens: { include: { produto: true } }, destinatario: true, transportadora: true },
  });

  res.json(documento);
}));

// Cancela um rascunho (documento já emitido precisa de um evento de
// cancelamento de verdade, não simplesmente apagar — mas um rascunho
// pode ser descartado direto).
router.delete("/:id", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const existente = await prisma.documentoFiscal.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ erro: "Documento não encontrado" });
  if (existente.empresaId && existente.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }
  if (existente.status !== "rascunho") {
    return res.status(409).json({ erro: "Só é possível cancelar documentos em rascunho" });
  }

  await prisma.documentoFiscal.update({
    where: { id },
    data: { status: "cancelado" },
  });

  res.status(204).send();
}));

module.exports = router;

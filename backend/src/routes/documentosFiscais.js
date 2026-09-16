const express = require("express");
const prisma = require("../lib/prisma");
const focusNfe = require("../services/focusNfe");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// Busca NFe já autorizadas — usado no CTe pra achar a nota pela chave de
// acesso ou pelo número, sem precisar rolar a lista inteira. Exige pelo
// menos 3 caracteres pra não devolver tudo a cada tecla.
router.get("/nfes-autorizadas", asyncHandler(async (req, res) => {
  const busca = (req.query.busca || "").trim();
  const { empresaId } = req.usuario;
  if (busca.length < 3) return res.json([]);

  const somenteDigitos = busca.replace(/\D/g, "");

  const notas = await prisma.documentoFiscal.findMany({
    where: {
      tipo: "NFe",
      status: "autorizado",
      ...(empresaId ? { empresaId } : {}),
      OR: [
        ...(somenteDigitos ? [{ chaveAcesso: { contains: somenteDigitos } }, { numero: Number(somenteDigitos) || undefined }] : []),
      ],
    },
    include: { destinatario: true },
    orderBy: { dataEmissao: "desc" },
    take: 20,
  });

  res.json(notas);
}));

router.get("/", asyncHandler(async (req, res) => {
  const { tipo } = req.query;
  const { empresaId } = req.usuario;

  const documentos = await prisma.documentoFiscal.findMany({
    where: {
      ...(tipo ? { tipo } : {}),
      // Diferente dos outros cadastros, documento fiscal sempre tem uma
      // empresa (é obrigatório desde o início) — não existe "documento
      // sem empresa" pra tratar aqui.
      ...(empresaId ? { empresaId } : {}),
    },
    include: { destinatario: true, remetente: true, expedidor: true, recebedor: true, transportadora: true, veiculo: true, veiculoReboque: true, colaboradorResponsavel: true, itens: { include: { produto: true } }, notasDoCte: true },
    orderBy: { dataEmissao: "desc" },
  });
  res.json(documentos);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const documento = await prisma.documentoFiscal.findUnique({
    where: { id: Number(req.params.id) },
    include: { destinatario: true, remetente: true, expedidor: true, recebedor: true, transportadora: true, veiculo: true, veiculoReboque: true, colaboradorResponsavel: true, itens: { include: { produto: true } }, notasDoCte: true },
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
  const {
    destinatarioId, transportadoraId, veiculoId, naturezaOperacao, modalidadeFrete, dataSaida, informacoesComplementares, itens,
    finalidadeOperacao, consumidorFinal, indicadorPresenca, formaPagamento,
    valorFrete, valorSeguro, valorDesconto, quantidadeVolumes, especieVolumes, pesoBrutoTotal, pesoLiquidoTotal,
    dataEmissao, colaboradorResponsavelId,
    baseCalculoIcms, valorIcms, baseCalculoIcmsSt, valorIcmsSt, outrasDespesas, valorIpi,
  } = req.body;

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
      ncmUtilizado: item.ncmUtilizado || produto.ncm,
      cstUtilizado: item.cstUtilizado || produto.cstIcms,
    };
  });

  // Total da nota = soma dos itens + frete + seguro - desconto (mesma
  // conta que a SEFAZ usa pro vNF da NFe).
  const totalItens = itensCalculados.reduce((soma, i) => soma + i.valorTotal, 0);
  const valorTotal = totalItens + (valorFrete || 0) + (valorSeguro || 0) - (valorDesconto || 0) + (valorIpi || 0) + (outrasDespesas || 0);

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
      veiculoId: veiculoId || undefined,
      colaboradorResponsavelId: colaboradorResponsavelId || undefined,
      numero,
      serie: Number.isNaN(serie) ? undefined : serie,
      dataEmissao: dataEmissao ? new Date(dataEmissao) : undefined,
      naturezaOperacao: naturezaOperacao || undefined,
      modalidadeFrete: modalidadeFrete || undefined,
      dataSaida: dataSaida ? new Date(dataSaida) : undefined,
      informacoesComplementares: informacoesComplementares || undefined,
      finalidadeOperacao: finalidadeOperacao || undefined,
      consumidorFinal: typeof consumidorFinal === "boolean" ? consumidorFinal : undefined,
      indicadorPresenca: indicadorPresenca || undefined,
      formaPagamento: formaPagamento || undefined,
      valorFrete: valorFrete || undefined,
      valorSeguro: valorSeguro || undefined,
      valorDesconto: valorDesconto || undefined,
      quantidadeVolumes: quantidadeVolumes || undefined,
      especieVolumes: especieVolumes || undefined,
      pesoBrutoTotal: pesoBrutoTotal || undefined,
      pesoLiquidoTotal: pesoLiquidoTotal || undefined,
      baseCalculoIcms: baseCalculoIcms || undefined,
      valorIcms: valorIcms || undefined,
      baseCalculoIcmsSt: baseCalculoIcmsSt || undefined,
      valorIcmsSt: valorIcmsSt || undefined,
      outrasDespesas: outrasDespesas || undefined,
      valorIpi: valorIpi || undefined,
      valorTotal,
      itens: { create: itensCalculados },
    },
    include: { itens: { include: { produto: true } }, destinatario: true, remetente: true, expedidor: true, recebedor: true, transportadora: true, veiculo: true, veiculoReboque: true, colaboradorResponsavel: true },
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
    tomadorId, transportadoraId, veiculoId, veiculoReboqueId, nomeMotorista, cpfMotorista,
    origemPercurso, destinoPercurso, distanciaKm, ufInicio, ufFim, naturezaOperacao, informacoesComplementares, valorTotal,
    remetenteId, expedidorId, recebedorId, definicaoTomador, formaPagamento,
    cfopPrestacao, cstIcmsPrestacao, baseCalculoIcmsPrestacao, aliquotaIcmsPrestacao,
    percentualReducaoBaseIcms, valorIcmsNaoTributado, valorIcmsOutras, valorCreditoPresumidoIcms, valorFcp,
    dataEmissao, colaboradorResponsavelId, notasFiscaisIds,
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
      remetenteId: remetenteId || undefined,
      expedidorId: expedidorId || undefined,
      recebedorId: recebedorId || undefined,
      definicaoTomador: definicaoTomador || undefined,
      transportadoraId: transportadoraId || undefined,
      veiculoId: veiculoId || undefined,
      veiculoReboqueId: veiculoReboqueId || undefined,
      nomeMotorista: nomeMotorista || undefined,
      cpfMotorista: cpfMotorista || undefined,
      origemPercurso: origemPercurso || undefined,
      destinoPercurso: destinoPercurso || undefined,
      distanciaKm: distanciaKm || undefined,
      ufInicio: ufInicio || undefined,
      ufFim: ufFim || undefined,
      naturezaOperacao: naturezaOperacao || undefined,
      informacoesComplementares: informacoesComplementares || undefined,
      formaPagamento: formaPagamento || undefined,
      cfopPrestacao: cfopPrestacao || undefined,
      cstIcmsPrestacao: cstIcmsPrestacao || undefined,
      baseCalculoIcmsPrestacao: baseCalculoIcmsPrestacao || undefined,
      aliquotaIcmsPrestacao: aliquotaIcmsPrestacao || undefined,
      percentualReducaoBaseIcms: percentualReducaoBaseIcms || undefined,
      valorIcmsNaoTributado: valorIcmsNaoTributado || undefined,
      valorIcmsOutras: valorIcmsOutras || undefined,
      valorCreditoPresumidoIcms: valorCreditoPresumidoIcms || undefined,
      valorFcp: valorFcp || undefined,
      dataEmissao: dataEmissao ? new Date(dataEmissao) : undefined,
      colaboradorResponsavelId: colaboradorResponsavelId || undefined,
      numero,
      serie: Number.isNaN(serie) ? undefined : serie,
      valorTotal,
      notasDoCte: notasFiscaisIds?.length ? { connect: notasFiscaisIds.map((id) => ({ id })) } : undefined,
    },
    include: {
      destinatario: true, remetente: true, expedidor: true, recebedor: true,
      transportadora: true, veiculo: true, veiculoReboque: true,
      notasDoCte: true,
    },
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
      remetente: { include: { endereco: true } },
      expedidor: { include: { endereco: true } },
      recebedor: { include: { endereco: true } },
      itens: { include: { produto: true } },
      transportadora: true,
      veiculo: true,
      veiculoReboque: true,
      notasDoCte: true,
      documentosVinculados: true,
    },
  });

  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.empresaId && documento.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }
  if (documento.status !== "rascunho" && documento.status !== "rejeitado") {
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
          documento,
          transportadora: documento.transportadora,
          veiculo: documento.veiculo,
        })
      : documento.tipo === "CTe"
      ? focusNfe.montarPayloadCte({
          empresa: documento.empresa,
          destinatario: documento.destinatario,
          remetente: documento.remetente,
          expedidor: documento.expedidor,
          recebedor: documento.recebedor,
          veiculo: documento.veiculo,
          veiculoReboque: documento.veiculoReboque,
          documento,
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
    // Axios só coloca "Request failed with status code 400" em erro.message
    // — a explicação de verdade que a Focus NFe manda (campo inválido,
    // certificado não encontrado, etc.) vem no corpo da resposta de erro.
    const detalheProvedor = erro.response?.data
      ? JSON.stringify(erro.response.data)
      : erro.message;

    await prisma.documentoFiscal.update({
      where: { id },
      data: { status: "rejeitado", motivoRejeicao: detalheProvedor },
    });
    res.status(502).json({ erro: "Falha ao enviar para o provedor", detalhe: detalheProvedor });
  }
}));

// Manda o DANFE por e-mail — só funciona depois de autorizada (a Focus
// exige a nota já emitida). Sem e-mail no corpo, usa o e-mail cadastrado
// no destinatário.
router.post("/:id/enviar-email", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const documento = await prisma.documentoFiscal.findUnique({
    where: { id },
    include: { destinatario: true },
  });

  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.empresaId && documento.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }
  if (documento.tipo === "MDFe") {
    return res.status(400).json({ erro: "Envio por e-mail não está disponível para MDFe" });
  }
  if (documento.status !== "autorizado") {
    return res.status(409).json({ erro: "Só é possível enviar por e-mail um documento já autorizado" });
  }

  const emails = req.body.emails?.length ? req.body.emails : [documento.destinatario?.email].filter(Boolean);
  if (!emails.length) {
    return res.status(400).json({ erro: "Nenhum e-mail informado e o destinatário não tem e-mail cadastrado" });
  }

  const ref = `${documento.tipo.toLowerCase()}-${documento.id}`;
  await focusNfe.enviarPorEmail({ tipo: documento.tipo, ref, emails });
  res.json({ enviado: true, emails });
}));

// Passo 3: consulta o status na Focus NFe e atualiza o registro local —
// chame periodicamente (ou via webhook do provedor) até sair de "enviado".
router.get("/:id/status", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const documento = await prisma.documentoFiscal.findUnique({ where: { id } });
  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.empresaId && documento.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }

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
        xmlUrl: focusNfe.urlCompleta(resultado[campos.xml]),
        pdfUrl: focusNfe.urlCompleta(resultado[campos.pdf]),
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
  if (existente.status !== "rascunho" && existente.status !== "rejeitado") {
    return res.status(409).json({ erro: "Só é possível editar documentos em rascunho ou rejeitados" });
  }

  const {
    destinatarioId, transportadoraId, naturezaOperacao, modalidadeFrete, dataSaida, informacoesComplementares, itens,
    veiculoId, nomeMotorista, cpfMotorista, origemPercurso, destinoPercurso, valorTotal: valorTotalManual,
    finalidadeOperacao, consumidorFinal, indicadorPresenca, formaPagamento,
    valorFrete, valorSeguro, valorDesconto, quantidadeVolumes, especieVolumes, pesoBrutoTotal, pesoLiquidoTotal,
    dataEmissao, colaboradorResponsavelId,
    baseCalculoIcms, valorIcms, baseCalculoIcmsSt, valorIcmsSt, outrasDespesas, valorIpi,
    veiculoReboqueId, distanciaKm, ufInicio, ufFim, remetenteId, expedidorId, recebedorId, definicaoTomador,
    cfopPrestacao, cstIcmsPrestacao, baseCalculoIcmsPrestacao, aliquotaIcmsPrestacao,
    percentualReducaoBaseIcms, valorIcmsNaoTributado, valorIcmsOutras, valorCreditoPresumidoIcms, valorFcp,
    notasFiscaisIds,
  } = req.body;

  let dadosItens = {};
  let valorTotal = existente.valorTotal;
  // Frete/seguro/desconto/IPI/outras despesas podem vir atualizados mesmo
  // sem mexer nos itens — se não vierem no corpo, mantém o que já estava
  // salvo.
  const freteAtual = valorFrete ?? existente.valorFrete ?? 0;
  const seguroAtual = valorSeguro ?? existente.valorSeguro ?? 0;
  const descontoAtual = valorDesconto ?? existente.valorDesconto ?? 0;
  const ipiAtual = valorIpi ?? existente.valorIpi ?? 0;
  const outrasDespesasAtual = outrasDespesas ?? existente.outrasDespesas ?? 0;

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
        ncmUtilizado: item.ncmUtilizado || produto.ncm,
        cstUtilizado: item.cstUtilizado || produto.cstIcms,
      };
    });
    const totalItens = itensCalculados.reduce((soma, i) => soma + i.valorTotal, 0);
    valorTotal = totalItens + freteAtual + seguroAtual - descontoAtual + ipiAtual + outrasDespesasAtual;
    // Troca os itens antigos pelos novos — mais simples do que tentar
    // casar item a item, e o documento ainda é só um rascunho.
    await prisma.documentoItem.deleteMany({ where: { documentoId: id } });
    dadosItens = { itens: { create: itensCalculados } };
  } else if (valorTotalManual != null) {
    // CTe não tem itens de produto — o valor da prestação é digitado
    // direto (não é calculado a partir de uma lista).
    valorTotal = valorTotalManual;
  } else if (valorFrete != null || valorSeguro != null || valorDesconto != null || valorIpi != null || outrasDespesas != null) {
    // Só mexeram no frete/seguro/desconto/impostos, sem reenviar os
    // itens — recalcula o total em cima dos itens que já existiam.
    const totalItensExistente = valorTotal
      - (existente.valorFrete || 0) - (existente.valorSeguro || 0) + (existente.valorDesconto || 0)
      - (existente.valorIpi || 0) - (existente.outrasDespesas || 0);
    valorTotal = totalItensExistente + freteAtual + seguroAtual - descontoAtual + ipiAtual + outrasDespesasAtual;
  }

  const documento = await prisma.documentoFiscal.update({
    where: { id },
    data: {
      destinatarioId: destinatarioId || undefined,
      transportadoraId: transportadoraId === null ? null : transportadoraId || undefined,
      veiculoId: veiculoId === null ? null : veiculoId || undefined,
      veiculoReboqueId: veiculoReboqueId === null ? null : veiculoReboqueId || undefined,
      remetenteId: remetenteId === null ? null : remetenteId || undefined,
      expedidorId: expedidorId === null ? null : expedidorId || undefined,
      recebedorId: recebedorId === null ? null : recebedorId || undefined,
      definicaoTomador: definicaoTomador ?? undefined,
      distanciaKm: distanciaKm ?? undefined,
      ufInicio: ufInicio ?? undefined,
      ufFim: ufFim ?? undefined,
      cfopPrestacao: cfopPrestacao ?? undefined,
      cstIcmsPrestacao: cstIcmsPrestacao ?? undefined,
      baseCalculoIcmsPrestacao: baseCalculoIcmsPrestacao ?? undefined,
      aliquotaIcmsPrestacao: aliquotaIcmsPrestacao ?? undefined,
      percentualReducaoBaseIcms: percentualReducaoBaseIcms ?? undefined,
      valorIcmsNaoTributado: valorIcmsNaoTributado ?? undefined,
      valorIcmsOutras: valorIcmsOutras ?? undefined,
      valorCreditoPresumidoIcms: valorCreditoPresumidoIcms ?? undefined,
      valorFcp: valorFcp ?? undefined,
      notasDoCte: notasFiscaisIds ? { set: notasFiscaisIds.map((nid) => ({ id: nid })) } : undefined,
      nomeMotorista: nomeMotorista ?? undefined,
      cpfMotorista: cpfMotorista ?? undefined,
      origemPercurso: origemPercurso ?? undefined,
      destinoPercurso: destinoPercurso ?? undefined,
      naturezaOperacao: naturezaOperacao ?? undefined,
      modalidadeFrete: modalidadeFrete ?? undefined,
      dataSaida: dataSaida ? new Date(dataSaida) : undefined,
      informacoesComplementares: informacoesComplementares ?? undefined,
      finalidadeOperacao: finalidadeOperacao ?? undefined,
      consumidorFinal: typeof consumidorFinal === "boolean" ? consumidorFinal : undefined,
      indicadorPresenca: indicadorPresenca ?? undefined,
      formaPagamento: formaPagamento ?? undefined,
      valorFrete: valorFrete ?? undefined,
      valorSeguro: valorSeguro ?? undefined,
      valorDesconto: valorDesconto ?? undefined,
      quantidadeVolumes: quantidadeVolumes ?? undefined,
      especieVolumes: especieVolumes ?? undefined,
      pesoBrutoTotal: pesoBrutoTotal ?? undefined,
      pesoLiquidoTotal: pesoLiquidoTotal ?? undefined,
      baseCalculoIcms: baseCalculoIcms ?? undefined,
      valorIcms: valorIcms ?? undefined,
      baseCalculoIcmsSt: baseCalculoIcmsSt ?? undefined,
      valorIcmsSt: valorIcmsSt ?? undefined,
      outrasDespesas: outrasDespesas ?? undefined,
      valorIpi: valorIpi ?? undefined,
      dataEmissao: dataEmissao ? new Date(dataEmissao) : undefined,
      colaboradorResponsavelId: colaboradorResponsavelId === null ? null : colaboradorResponsavelId || undefined,
      valorTotal,
      ...dadosItens,
    },
    include: { itens: { include: { produto: true } }, destinatario: true, remetente: true, expedidor: true, recebedor: true, transportadora: true, veiculo: true, veiculoReboque: true, colaboradorResponsavel: true, notasDoCte: true },
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

  // Rascunho ou rejeitado: nunca chegou a ser enviado pra SEFAZ, então
  // cancelar aqui é só marcar como cancelado no nosso banco.
  if (existente.status === "rascunho" || existente.status === "rejeitado") {
    await prisma.documentoFiscal.update({ where: { id }, data: { status: "cancelado" } });
    return res.status(204).send();
  }

  // Autorizado: precisa mandar um evento de cancelamento de verdade pra
  // SEFAZ, com justificativa (entre 15 e 255 caracteres).
  if (existente.status === "autorizado") {
    const { justificativa } = req.body;
    if (!justificativa || justificativa.trim().length < 15) {
      return res.status(400).json({ erro: "A justificativa precisa ter pelo menos 15 caracteres" });
    }

    const ref = `${existente.tipo.toLowerCase()}-${existente.id}`;
    try {
      const resultado = await focusNfe.cancelar({ tipo: existente.tipo, ref, justificativa: justificativa.trim() });
      if (resultado.status !== "cancelado") {
        return res.status(409).json({ erro: `SEFAZ não confirmou o cancelamento (status: ${resultado.status})`, detalhe: resultado });
      }
      const atualizado = await prisma.documentoFiscal.update({
        where: { id },
        data: { status: "cancelado", justificativaCancelamento: justificativa.trim() },
      });
      return res.json(atualizado);
    } catch (erro) {
      const detalheProvedor = erro.response?.data ? JSON.stringify(erro.response.data) : erro.message;
      return res.status(502).json({ erro: "Falha ao cancelar junto ao provedor", detalhe: detalheProvedor });
    }
  }

  return res.status(409).json({ erro: `Documento em status "${existente.status}" não pode ser cancelado` });
}));

// Carta de Correção Eletrônica — só pra NFe já autorizada. A SEFAZ exige
// entre 15 e 1000 caracteres, e permite até 20 por nota.
router.post("/:id/carta-correcao", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { texto } = req.body;

  const documento = await prisma.documentoFiscal.findUnique({ where: { id } });
  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.empresaId && documento.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }
  if (documento.tipo === "MDFe") {
    return res.status(400).json({ erro: "Carta de correção não está disponível para MDFe" });
  }
  if (documento.status !== "autorizado") {
    return res.status(409).json({ erro: "Só é possível corrigir um documento já autorizado" });
  }
  if (!texto || texto.trim().length < 15 || texto.trim().length > 1000) {
    return res.status(400).json({ erro: "O texto da correção precisa ter entre 15 e 1000 caracteres" });
  }

  const totalExistentes = await prisma.cartaCorrecao.count({ where: { documentoId: id } });
  if (totalExistentes >= 20) {
    return res.status(409).json({ erro: "Essa nota já tem 20 cartas de correção, o máximo permitido pela SEFAZ" });
  }

  const ref = `${documento.tipo.toLowerCase()}-${documento.id}`;
  try {
    const resultado = await focusNfe.emitirCartaCorrecao({ tipo: documento.tipo, ref, texto: texto.trim() });
    const carta = await prisma.cartaCorrecao.create({
      data: {
        documentoId: id,
        texto: texto.trim(),
        numeroSequencial: resultado.numero_sequencial_evento || totalExistentes + 1,
        status: resultado.status === "erro_autorizacao" ? "erro" : "registrada",
        motivoErro: resultado.status === "erro_autorizacao" ? resultado.mensagem_sefaz : undefined,
        pdfUrl: focusNfe.urlCompleta(resultado.caminho_pdf_carta_correcao || resultado.caminho_pdf),
      },
    });
    res.status(201).json(carta);
  } catch (erro) {
    const detalheProvedor = erro.response?.data ? JSON.stringify(erro.response.data) : erro.message;
    const carta = await prisma.cartaCorrecao.create({
      data: { documentoId: id, texto: texto.trim(), numeroSequencial: totalExistentes + 1, status: "erro", motivoErro: detalheProvedor },
    });
    res.status(502).json({ erro: "Falha ao enviar a correção para o provedor", detalhe: detalheProvedor, carta });
  }
}));

router.get("/:id/carta-correcao", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const documento = await prisma.documentoFiscal.findUnique({ where: { id } });
  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.empresaId && documento.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }
  const cartas = await prisma.cartaCorrecao.findMany({
    where: { documentoId: id },
    orderBy: { numeroSequencial: "asc" },
  });
  res.json(cartas);
}));

// A Focus NFe não tem uma consulta separada por carta de correção — o
// link do PDF/XML da carta mais recente vem junto da consulta normal da
// nota (mesma que já usamos pra buscar o DANFE).
router.get("/:id/carta-correcao/:cartaId/status", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const cartaId = Number(req.params.cartaId);

  const documento = await prisma.documentoFiscal.findUnique({ where: { id } });
  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.empresaId && documento.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }

  const carta = await prisma.cartaCorrecao.findUnique({ where: { id: cartaId } });
  if (!carta || carta.documentoId !== id) return res.status(404).json({ erro: "Carta de correção não encontrada" });

  const ref = `${documento.tipo.toLowerCase()}-${documento.id}`;
  try {
    const resultado = await focusNfe.consultar({ tipo: documento.tipo, ref });
    // A Focus só expõe o PDF/XML da carta de correção mais recente por
    // aqui — se essa não for a mais recente, avisa em vez de inventar
    // um link.
    if (Number(resultado.numero_carta_correcao) !== carta.numeroSequencial) {
      return res.status(409).json({
        erro: "A Focus só disponibiliza o PDF da carta de correção mais recente — essa já foi substituída por outra mais nova.",
      });
    }
    const atualizada = await prisma.cartaCorrecao.update({
      where: { id: cartaId },
      data: {
        status: "registrada",
        pdfUrl: focusNfe.urlCompleta(resultado.caminho_pdf_carta_correcao),
      },
    });
    res.json(atualizada);
  } catch (erro) {
    const detalheProvedor = erro.response?.data ? JSON.stringify(erro.response.data) : erro.message;
    res.status(502).json({ erro: "Falha ao consultar junto ao provedor", detalhe: detalheProvedor });
  }
}));

module.exports = router;

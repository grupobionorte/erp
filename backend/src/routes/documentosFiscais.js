const express = require("express");
const prisma = require("../lib/prisma");
const focusNfe = require("../services/focusNfe");

const asyncHandler = require("../lib/asyncHandler");
const router = express.Router();

// Referência enviada ao provedor. A primeira tentativa mantém o formato
// antigo ("cte-2") pra não quebrar os documentos já emitidos; a partir da
// segunda o número da tentativa entra no fim ("cte-2-2"). Isso destrava o
// caso em que um envio fica preso em processamento no provedor: a ref
// anterior continua ocupada, mas o documento pode ser mandado de novo.
function refDocumento(documento) {
  const base = `${documento.tipo.toLowerCase()}-${documento.id}`;
  const tentativa = documento.tentativaEnvio || 1;
  return tentativa > 1 ? `${base}-${tentativa}` : base;
}

// Converte um item de "documentosTransportados" (vindo do formulário do
// CTe) no formato que o Prisma espera pra criar um CteDocumento.
function mapCteDocumento(doc) {
  return {
    notaFiscalId: doc.notaFiscalId || undefined,
    tipo: doc.tipo || "Fiscal",
    chaveAcesso: doc.chaveAcesso || undefined,
    numeroDocumento: doc.numeroDocumento || undefined,
    modelo: doc.modelo || undefined,
    serie: doc.serie || undefined,
    cfopPredominante: doc.cfopPredominante || undefined,
    dataEmissao: doc.dataEmissao ? new Date(doc.dataEmissao) : undefined,
    naturezaMercadoria: doc.naturezaMercadoria || undefined,
    outrasCaracteristicasCarga: doc.outrasCaracteristicasCarga || undefined,
    baseCalculoIcms: doc.baseCalculoIcms ?? undefined,
    valorIcms: doc.valorIcms ?? undefined,
    baseCalculoIcmsSt: doc.baseCalculoIcmsSt ?? undefined,
    valorIcmsSt: doc.valorIcmsSt ?? undefined,
    valorTotalProdutos: doc.valorTotalProdutos ?? undefined,
    valorTotalNota: doc.valorTotalNota ?? undefined,
    pesoBruto: doc.pesoBruto ?? undefined,
    m3: doc.m3 ?? undefined,
    quantidadeVolumes: doc.quantidadeVolumes ?? undefined,
    pesoLiquido: doc.pesoLiquido ?? undefined,
    pinSuframa: doc.pinSuframa || undefined,
    numeroPedido: doc.numeroPedido || undefined,
    numeroRomaneio: doc.numeroRomaneio || undefined,
    valorCargaAverbacao: doc.valorCargaAverbacao ?? undefined,
  };
}

// Busca NFe já autorizadas — usado no CTe pra achar a nota pela chave de
// acesso ou pelo número, sem precisar rolar a lista inteira. Exige pelo
// menos 3 caracteres pra não devolver tudo a cada tecla.
router.get("/nfes-autorizadas", asyncHandler(async (req, res) => {
  const busca = (req.query.busca || "").trim();
  const { empresaId } = req.usuario;
  if (busca.length < 3) return res.json([]);

  const somenteDigitos = busca.replace(/\D/g, "");
  // "número" da NFe tem no máximo 9 dígitos — uma chave de acesso inteira
  // (44 dígitos) vira um número gigante que quebra o filtro (Prisma espera
  // um Int de verdade), então só tenta essa comparação quando faz sentido.
  const numeroBusca = somenteDigitos && somenteDigitos.length <= 9 ? Number(somenteDigitos) : NaN;

  const notas = await prisma.documentoFiscal.findMany({
    where: {
      tipo: "NFe",
      status: "autorizado",
      ...(empresaId ? { empresaId } : {}),
      OR: [
        ...(somenteDigitos ? [{ chaveAcesso: { contains: somenteDigitos } }] : []),
        ...(Number.isSafeInteger(numeroBusca) ? [{ numero: numeroBusca }] : []),
      ],
    },
    include: { destinatario: true, itens: { include: { produto: true } } },
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
    include: {
      destinatario: true, remetente: true, expedidor: true, recebedor: true, transportadora: true,
      veiculo: true, veiculoReboque: true, veiculoReboque2: true, veiculoReboque3: true,
      colaboradorResponsavel: true, itens: { include: { produto: true } },
      documentosTransportados: { include: { notaFiscal: true } }, documentosVinculados: true,
    },
    orderBy: { dataEmissao: "desc" },
  });
  res.json(documentos);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const documento = await prisma.documentoFiscal.findUnique({
    where: { id: Number(req.params.id) },
    include: { destinatario: true, remetente: true, expedidor: true, recebedor: true, transportadora: true, veiculo: true, veiculoReboque: true, colaboradorResponsavel: true, itens: { include: { produto: true } }, documentosTransportados: { include: { notaFiscal: true } } },
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
    destinatarioId, transportadoraId, veiculoId, naturezaOperacao, modalidadeFrete, dataSaida, horaSaida, informacoesComplementares, itens,
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
      dataSaida: dataHoraNoFuso(dataSaida, horaSaida),
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
    tomadorId, transportadoraId, veiculoId, veiculoReboqueId, veiculoReboque2Id, veiculoReboque3Id,
    nomeMotorista, cpfMotorista, produtoPredominante, valorTotalCarga,
    unidadeMedidaCarga, volumeM3Total,
    origemPercurso, destinoPercurso, distanciaKm, ufInicio, ufFim, naturezaOperacao, informacoesComplementares, valorTotal,
    remetenteId, expedidorId, recebedorId, definicaoTomador, formaPagamento,
    cfopPrestacao, cstIcmsPrestacao, baseCalculoIcmsPrestacao, aliquotaIcmsPrestacao,
    percentualReducaoBaseIcms, valorIcmsNaoTributado, valorIcmsOutras, valorCreditoPresumidoIcms, valorFcp,
    dataEmissao, colaboradorResponsavelId, documentosTransportados, cstIbsCbsPrestacao, classificacaoTributariaIbsCbsPrestacao,
    tipoServico, dataTransporte, horaTransporte, cteGlobalizado, tipoCte,
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
      veiculoReboque2Id: veiculoReboque2Id || undefined,
      veiculoReboque3Id: veiculoReboque3Id || undefined,
      produtoPredominante: produtoPredominante || undefined,
      valorTotalCarga: valorTotalCarga ? Number(valorTotalCarga) : undefined,
      unidadeMedidaCarga: unidadeMedidaCarga || undefined,
      volumeM3Total: volumeM3Total ? Number(volumeM3Total) : undefined,
      nomeMotorista: nomeMotorista || undefined,
      cpfMotorista: cpfMotorista || undefined,
      origemPercurso: origemPercurso || undefined,
      destinoPercurso: destinoPercurso || undefined,
      distanciaKm: distanciaKm || undefined,
      ufInicio: ufInicio || undefined,
      ufFim: ufFim || undefined,
      cstIbsCbsPrestacao: cstIbsCbsPrestacao || undefined,
      classificacaoTributariaIbsCbsPrestacao: classificacaoTributariaIbsCbsPrestacao || undefined,
      tipoServico: tipoServico || undefined,
      dataTransporte: dataTransporte ? new Date(dataTransporte) : undefined,
      horaTransporte: horaTransporte || undefined,
      cteGlobalizado: typeof cteGlobalizado === "boolean" ? cteGlobalizado : undefined,
      tipoCte: tipoCte || undefined,
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
      documentosTransportados: documentosTransportados?.length
        ? { create: documentosTransportados.map(mapCteDocumento) }
        : undefined,
    },
    include: {
      destinatario: true, remetente: true, expedidor: true, recebedor: true,
      transportadora: true, veiculo: true, veiculoReboque: true,
      documentosTransportados: { include: { notaFiscal: true } },
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

// O MDF-e de carga lotação exige o NCM do produto predominante, e essa
// informação vive no cadastro de produtos. Procura pela descrição, que é o
// que foi escolhido no CT-e.
async function ncmDoProduto(descricao, empresaId) {
  if (!descricao) return null;
  const produto = await prisma.produto.findFirst({
    where: {
      empresaId: empresaId ?? undefined,
      descricao: { equals: String(descricao).trim(), mode: "insensitive" },
    },
    select: { ncm: true },
  });
  return produto?.ncm || null;
}

// Junta data e hora no fuso da operação. Sem isso, "2026-09-25" vira
// meia-noite em UTC e a hora de saída sai zerada (ou no dia anterior) no
// DANFE.
function dataHoraNoFuso(data, hora) {
  if (!data) return undefined;
  const referencia = new Date(`${data}T12:00:00Z`);
  const offsetMin = -new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.TZ_FISCAL || "America/Cuiaba",
    timeZoneName: "longOffset",
  }).formatToParts(referencia).find((p) => p.type === "timeZoneName").value
    .replace("GMT", "").split(":").reduce((h, m) => Number(h) * 60 + Math.sign(Number(h)) * Number(m));
  const sinal = offsetMin > 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const pad = (n) => String(n).padStart(2, "0");
  return new Date(`${data}T${hora || "00:00"}:00${sinal}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`);
}

// Gera um rascunho de MDFe já preenchido a partir de CT-e(s) autorizados.
// É o caminho prático: quase tudo que a SEFAZ exige no manifesto já está
// no CT-e — trajeto, veículo, motorista, carga. O usuário só confere.
router.post("/mdfe/gerar-do-cte", asyncHandler(async (req, res) => {
  const { cteIds, tipoCarga, seguro } = req.body;

  if (!cteIds?.length) {
    return res.status(400).json({ erro: "Informe ao menos um CT-e (cteIds)" });
  }

  const ctes = await prisma.documentoFiscal.findMany({
    where: { id: { in: cteIds }, tipo: "CTe", empresaId: req.usuario.empresaId },
    include: {
      veiculo: true, veiculoReboque: true, veiculoReboque2: true, veiculoReboque3: true,
      documentosTransportados: true, empresa: { include: { endereco: true } },
    },
  });

  if (ctes.length !== cteIds.length) {
    return res.status(400).json({ erro: "Algum CT-e não foi encontrado nessa empresa" });
  }
  // Um CT-e só pode estar em um manifesto: como o vínculo é uma FK no
  // próprio CT-e, gerar um segundo MDFe com ele o tiraria do primeiro sem
  // ninguém perceber.
  const jaManifestado = ctes.filter((c) => c.mdfeId);
  if (jaManifestado.length) {
    const outros = await prisma.documentoFiscal.findMany({
      where: { id: { in: jaManifestado.map((c) => c.mdfeId) }, status: { not: "cancelado" } },
      select: { id: true, numero: true, status: true },
    });
    if (outros.length) {
      return res.status(409).json({
        erro: "CT-e já vinculado a outro MDF-e",
        detalhe: `Manifesto(s): ${outros.map((m) => `nº ${m.numero || m.id} (${m.status})`).join(", ")}.`,
      });
    }
  }

  const naoAutorizado = ctes.find((c) => c.status !== "autorizado" || !c.chaveAcesso);
  if (naoAutorizado) {
    return res.status(400).json({
      erro: "Só é possível manifestar CT-e autorizado",
      detalhe: `O CT-e ${naoAutorizado.id} está em "${naoAutorizado.status}" e sem chave de acesso.`,
    });
  }

  const primeiro = ctes[0];
  const ultimo = ctes[ctes.length - 1];

  // O MDFe exige município COM código IBGE nos dois extremos; o CTe guarda
  // só o nome, então resolvemos pela tabela de municípios.
  const buscarMunicipio = async (nome, uf) => {
    if (!nome || !uf) return null;
    return prisma.municipio.findFirst({
      where: { nome: { equals: nome.trim(), mode: "insensitive" }, uf: uf.toUpperCase() },
    });
  };

  const [carregamento, descarregamento] = await Promise.all([
    buscarMunicipio(primeiro.origemPercurso, primeiro.ufInicio),
    buscarMunicipio(ultimo.destinoPercurso, ultimo.ufFim),
  ]);

  const naoResolvidos = [];
  if (!carregamento) naoResolvidos.push(`${primeiro.origemPercurso || "?"}/${primeiro.ufInicio || "?"} (carregamento)`);
  if (!descarregamento) naoResolvidos.push(`${ultimo.destinoPercurso || "?"}/${ultimo.ufFim || "?"} (descarregamento)`);
  if (naoResolvidos.length) {
    return res.status(422).json({
      erro: "Não consegui achar o código IBGE dos municípios do trajeto.",
      detalhe: `Confira a grafia em: ${naoResolvidos.join(", ")}.`,
    });
  }

  // Dentro do mesmo município o manifesto não é exigido — avisa, mas deixa
  // o usuário decidir (pode haver exigência específica da operação dele).
  const avisos = [];
  if (carregamento.codigoIbge === descarregamento.codigoIbge) {
    avisos.push(
      "Carregamento e descarregamento no mesmo município: o MDF-e normalmente não é exigido nesse caso."
    );
  }

  // Peso e valor da carga vêm da soma dos documentos transportados pelos
  // CT-es; o valor do frete não entra aqui — o que a SEFAZ quer é o valor
  // da mercadoria.
  const somar = (campo) =>
    ctes.reduce(
      (total, cte) => total + (cte.documentosTransportados || []).reduce((t, d) => t + (d[campo] || 0), 0),
      0
    );
  const pesoBruto = somar("pesoBruto");
  const valorCarga = somar("valorTotalNota") || somar("valorTotalProdutos");

  const ufsTrajeto = [...new Set(ctes.flatMap((c) => [c.ufInicio, c.ufFim]).filter(Boolean))];
  const produtoPredominanteMdfe = primeiro.produtoPredominante
    || primeiro.documentosTransportados?.[0]?.naturezaMercadoria
    || primeiro.especieVolumes
    || null;

  const documento = await prisma.documentoFiscal.create({
    data: {
      tipo: "MDFe",
      status: "rascunho",
      empresaId: req.usuario.empresaId,
      transportadoraId: primeiro.transportadoraId,
      veiculoId: primeiro.veiculoId,
      veiculoReboqueId: primeiro.veiculoReboqueId,
      veiculoReboque2Id: primeiro.veiculoReboque2Id,
      veiculoReboque3Id: primeiro.veiculoReboque3Id,
      nomeMotorista: primeiro.nomeMotorista,
      cpfMotorista: primeiro.cpfMotorista,
      ufPercurso: ufsTrajeto.join(","),
      ufInicio: primeiro.ufInicio,
      ufFim: ultimo.ufFim,

      municipioCarregamento: carregamento.nome,
      codigoMunicipioCarregamento: carregamento.codigoIbge,
      municipioDescarregamento: descarregamento.nome,
      codigoMunicipioDescarregamento: descarregamento.codigoIbge,

      tipoEmitenteMdfe: "1", // prestador de serviço de transporte
      tipoCarga: tipoCarga || undefined,
      produtoPredominante: produtoPredominanteMdfe || undefined,
      ncmProdutoPredominante: await ncmDoProduto(produtoPredominanteMdfe, req.usuario.empresaId),
      unidadeMedidaPeso: "01", // KG
      pesoBrutoCarga: pesoBruto || undefined,
      valorTotalCarga: valorCarga || undefined,

      seguroResponsavel: seguro?.responsavel || "1",
      seguroNomeSeguradora: seguro?.nomeSeguradora || undefined,
      seguroCnpjSeguradora: seguro?.cnpjSeguradora || undefined,
      seguroNumeroApolice: seguro?.numeroApolice || undefined,
      seguroNumeroAverbacao: seguro?.numeroAverbacao || undefined,

      documentosVinculados: { connect: ctes.map((c) => ({ id: c.id })) },
    },
    include: { veiculo: true, transportadora: true, documentosVinculados: true },
  });

  res.status(201).json({ ...documento, avisos });
}));

// Encerramento do MDFe — obrigatório quando a viagem termina. Sem isso a
// SEFAZ recusa o próximo manifesto da mesma placa.
router.post("/:id/encerrar", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const documento = await prisma.documentoFiscal.findUnique({ where: { id } });

  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.tipo !== "MDFe") {
    return res.status(400).json({ erro: "Encerramento só existe para MDF-e" });
  }
  if (documento.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }
  if (documento.status !== "autorizado") {
    return res.status(409).json({ erro: `Só é possível encerrar um MDF-e autorizado (atual: "${documento.status}")` });
  }
  if (documento.dataEncerramento) {
    return res.status(409).json({ erro: "Esse MDF-e já foi encerrado" });
  }

  // Por padrão encerra no município de descarregamento, que é o caso
  // comum — mas a viagem pode ter terminado em outro lugar.
  const codigoMunicipio = req.body.codigoMunicipio || documento.codigoMunicipioDescarregamento;
  const uf = req.body.uf || documento.ufFim;
  const dataEncerramento = req.body.dataEncerramento || new Date().toISOString().slice(0, 10);

  // O encerramento é pelo NOME do município, não pelo código IBGE.
  const nomeMunicipio = req.body.municipio || documento.municipioDescarregamento;

  if (!nomeMunicipio || !uf) {
    return res.status(400).json({
      erro: "Informe o município e a UF de encerramento",
      detalhe: "O manifesto não tem município de descarregamento salvo para usar como padrão.",
    });
  }

  try {
    const resultado = await focusNfe.encerrarMdfe({
      ref: refDocumento(documento),
      data: dataEncerramento,
      sigla_uf: uf,
      nome_municipio: nomeMunicipio,
    });

    const atualizado = await prisma.documentoFiscal.update({
      where: { id },
      data: {
        dataEncerramento: new Date(dataEncerramento),
        codigoMunicipioEncerramento: codigoMunicipio ? String(codigoMunicipio) : undefined,
        municipioEncerramento: nomeMunicipio,
      },
    });
    res.json({ ...atualizado, retornoProvedor: resultado });
  } catch (erro) {
    const detalheProvedor = erro.response?.data ? JSON.stringify(erro.response.data) : erro.message;
    res.status(502).json({ erro: "Não foi possível encerrar o MDF-e na SEFAZ", detalhe: detalheProvedor });
  }
}));

// Clonar: cria um rascunho novo com os mesmos dados de um documento já
// emitido. A mesma rota se repete muito — mesmo cliente, mesmo trajeto,
// mesmo veículo —, e redigitar tudo é onde o erro entra.
router.post("/:id/clonar", asyncHandler(async (req, res) => {
  const origem = await prisma.documentoFiscal.findUnique({
    where: { id: Number(req.params.id) },
    include: { documentosTransportados: true },
  });

  if (!origem) return res.status(404).json({ erro: "Documento não encontrado" });
  if (origem.empresaId && origem.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }

  // Tudo que identifica o documento original fica de fora: numeração,
  // chave, protocolo, status e o vínculo com um MDFe. O resto é o que vale
  // a pena aproveitar.
  const {
    id, numero, serie, chaveAcesso, status, protocoloAutorizacao, dataEmissao, dataAutorizacao,
    xmlUrl, pdfUrl, motivoRejeicao, tentativaEnvio, justificativaCancelamento, mdfeId,
    documentosTransportados, ...dados
  } = origem;

  // Por padrão as notas transportadas NÃO vêm junto: cada viagem carrega
  // notas diferentes, e repetir chave de NF-e num CT-e novo é erro caro.
  const copiarNotas = req.body?.copiarNotas === true;

  const clone = await prisma.documentoFiscal.create({
    data: {
      ...dados,
      status: "rascunho",
      dataEmissao: new Date(),
      documentosTransportados: copiarNotas && documentosTransportados.length ? {
        create: documentosTransportados.map(({ id: _id, cteId, notaFiscalId, ...doc }) => doc),
      } : undefined,
    },
    include: { documentosTransportados: true },
  });

  res.status(201).json({
    ...clone,
    aviso: copiarNotas
      ? "Rascunho criado com as mesmas notas transportadas — confira antes de emitir."
      : "Rascunho criado. Vincule as notas fiscais desta viagem antes de emitir.",
  });
}));

// Passo 2: envia o rascunho para o provedor de emissão. Fica separado do
// passo 1 de propósito — permite revisar o rascunho antes de emitir de
// verdade, já que a emissão é irreversível (exige evento de cancelamento).
router.post("/:id/emitir", asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const documento = await prisma.documentoFiscal.findUnique({
    where: { id },
    include: {
      empresa: { include: { endereco: true } },
      destinatario: { include: { endereco: true } },
      remetente: { include: { endereco: true } },
      expedidor: { include: { endereco: true } },
      recebedor: { include: { endereco: true } },
      itens: { include: { produto: true } },
      transportadora: true,
      veiculo: true,
      veiculoReboque: true,
      veiculoReboque2: true,
      veiculoReboque3: true,
      documentosTransportados: { include: { notaFiscal: true } },
      // Os contratantes do MDF-e saem do tomador de cada CT-e vinculado, e
      // os CEPs de carga lotação saem dos endereços dessas pessoas.
      documentosVinculados: {
        include: {
          destinatario: { include: { endereco: true } },
          remetente: { include: { endereco: true } },
          expedidor: { include: { endereco: true } },
          recebedor: { include: { endereco: true } },
        },
      },
    },
  });

  if (!documento) return res.status(404).json({ erro: "Documento não encontrado" });
  if (documento.empresaId && documento.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ erro: "Esse documento pertence a outra empresa" });
  }

  // Reenvio de um documento travado em "enviado": o provedor engasgou e o
  // status nunca resolveu. Exige confirmação explícita porque, se o envio
  // antigo ainda estiver vivo na fila, os dois podem ser autorizados e aí
  // sobra documento duplicado na SEFAZ. Consulte o status antes.
  const forcarNovoEnvio = Boolean(req.body?.forcarNovoEnvio);
  const travadoEmEnvio = documento.status === "enviado" && forcarNovoEnvio;

  if (documento.status !== "rascunho" && documento.status !== "rejeitado" && !travadoEmEnvio) {
    return res.status(409).json({
      erro: `Documento já está em status "${documento.status}"`,
      ...(documento.status === "enviado"
        ? { detalhe: "Consulte o status primeiro. Se o provedor continuar sem resposta, reenvie com nova referência." }
        : {}),
    });
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
          reboques: [documento.veiculoReboque, documento.veiculoReboque2, documento.veiculoReboque3].filter(Boolean),
          nomeMotorista: documento.nomeMotorista,
          cpfMotorista: documento.cpfMotorista,
          ufPercurso: documento.ufPercurso,
          documentosVinculados: documento.documentosVinculados,
          documento,
        });

  // A partir da segunda ida ao provedor (documento rejeitado ou travado em
  // envio), sobe o contador: assim a ref é nova e não esbarra na anterior,
  // que pode estar ocupada ou presa em processamento.
  const primeiraTentativa = documento.status === "rascunho";
  const tentativa = primeiraTentativa
    ? documento.tentativaEnvio || 1
    : (documento.tentativaEnvio || 1) + 1;
  const ref = refDocumento({ ...documento, tentativaEnvio: tentativa });

  // Validação local do CT-e: evita mandar pra SEFAZ algo que já dá pra ver
  // que vai voltar rejeitado, e explica o motivo em português na hora.
  if (documento.tipo === "MDFe" && documento.produtoPredominante && !documento.ncmProdutoPredominante) {
    // Rascunhos criados antes deste campo existir ainda não têm o NCM.
    const ncm = await ncmDoProduto(documento.produtoPredominante, documento.empresaId);
    if (ncm) {
      documento.ncmProdutoPredominante = ncm;
      await prisma.documentoFiscal.update({ where: { id }, data: { ncmProdutoPredominante: ncm } });
      payload.codigo_ncm_produto = ncm.replace(/\D/g, "");
    }
  }

  if (documento.tipo === "MDFe") {
    const problemas = focusNfe.validarPayloadMdfe(payload);
    if (problemas.length) {
      return res.status(422).json({
        erro: "O MDF-e não passou na conferência antes do envio.",
        detalhe: problemas.join(" | "),
        problemas,
      });
    }
  }

  if (documento.tipo === "CTe") {
    const problemas = focusNfe.validarPayloadCte(payload);
    if (problemas.length) {
      return res.status(422).json({
        erro: "O CT-e não passou na conferência antes do envio.",
        detalhe: problemas.join(" | "),
        problemas,
      });
    }
  }

  try {
    await focusNfe.emitir({ tipo: documento.tipo, ref, payload });
    const atualizado = await prisma.documentoFiscal.update({
      where: { id },
      // Limpa o motivo da tentativa anterior — senão a tela mostra
      // "Enviado" com a rejeição velha ao lado e parece que o documento
      // continua rejeitado.
      data: { status: "enviado", motivoRejeicao: null, tentativaEnvio: tentativa },
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
      // Guarda a tentativa mesmo no erro: se a requisição chegou a sair e
      // o provedor ficou com essa ref, a próxima já usa outra.
      data: { status: "rejeitado", motivoRejeicao: detalheProvedor, tentativaEnvio: tentativa },
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

  const ref = refDocumento(documento);
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

  const ref = refDocumento(documento);
  const resultado = await focusNfe.consultar({ tipo: documento.tipo, ref });

  if (resultado.status === "autorizado") {
    // A Focus NFe nomeia os campos de retorno de forma diferente por tipo
    // de documento (chave_nfe / chave_cte / chave_mdfe e o mesmo padrão
    // para o XML e o PDF — DANFE, DACTE ou DAMDFE). Alguns retornos vêm
    // com o nome genérico ("chave", "caminho_xml"), então tentamos os
    // candidatos em ordem em vez de depender de um nome só — era por isso
    // que a coluna Chave ficava vazia mesmo com o documento autorizado.
    const CAMPOS_POR_TIPO = {
      NFe: {
        chave: ["chave_nfe", "chave"],
        xml: ["caminho_xml_nota_fiscal", "caminho_xml", "caminho_xml_nfe"],
        pdf: ["caminho_danfe", "caminho_pdf"],
      },
      CTe: {
        chave: ["chave_cte", "chave"],
        xml: ["caminho_xml_cte", "caminho_xml"],
        pdf: ["caminho_dacte", "caminho_pdf"],
      },
      MDFe: {
        chave: ["chave_mdfe", "chave"],
        xml: ["caminho_xml_mdfe", "caminho_xml"],
        pdf: ["caminho_damdfe", "caminho_pdf"],
      },
    };
    const campos = CAMPOS_POR_TIPO[documento.tipo];
    const primeiroPreenchido = (nomes) => nomes.map((n) => resultado[n]).find(Boolean);

    // A Focus devolve a chave do CT-e com o prefixo "CTe" na frente. Guardar
    // assim quebrava o MDFe, que espera 44 dígitos limpos — e a chave com
    // prefixo também não serve para consulta em portal nenhum.
    const soDigitos = (v) => (v ? String(v).replace(/\D/g, "") || null : null);

    const atualizado = await prisma.documentoFiscal.update({
      where: { id },
      data: {
        status: "autorizado",
        chaveAcesso: soDigitos(primeiroPreenchido(campos.chave)),
        protocoloAutorizacao: resultado.numero_protocolo || resultado.protocolo,
        dataAutorizacao: new Date(),
        xmlUrl: focusNfe.urlCompleta(primeiroPreenchido(campos.xml)),
        pdfUrl: focusNfe.urlCompleta(primeiroPreenchido(campos.pdf)),
      },
    });
    return res.json(atualizado);
  }

  if (resultado.status === "erro_autorizacao") {
    // Guarda o código junto da mensagem: é por ele que se procura a regra
    // de validação da SEFAZ (ex.: "360 - Total do DFe de preenchimento
    // obrigatório").
    const motivo = [resultado.status_sefaz, resultado.mensagem_sefaz].filter(Boolean).join(" - ");
    const atualizado = await prisma.documentoFiscal.update({
      where: { id },
      data: { status: "rejeitado", motivoRejeicao: motivo || "Rejeitado pela SEFAZ" },
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
    destinatarioId, transportadoraId, naturezaOperacao, modalidadeFrete, dataSaida, horaSaida, informacoesComplementares, itens,
    veiculoId, nomeMotorista, cpfMotorista, origemPercurso, destinoPercurso, valorTotal: valorTotalManual,
    finalidadeOperacao, consumidorFinal, indicadorPresenca, formaPagamento,
    valorFrete, valorSeguro, valorDesconto, quantidadeVolumes, especieVolumes, pesoBrutoTotal, pesoLiquidoTotal,
    dataEmissao, colaboradorResponsavelId,
    baseCalculoIcms, valorIcms, baseCalculoIcmsSt, valorIcmsSt, outrasDespesas, valorIpi,
    veiculoReboqueId, veiculoReboque2Id, veiculoReboque3Id,
    produtoPredominante, valorTotalCarga, unidadeMedidaCarga, volumeM3Total,
    distanciaKm, ufInicio, ufFim, remetenteId, expedidorId, recebedorId, definicaoTomador,
    cstIbsCbsPrestacao, classificacaoTributariaIbsCbsPrestacao,
    tipoServico, dataTransporte, horaTransporte, cteGlobalizado, tipoCte,
    cfopPrestacao, cstIcmsPrestacao, baseCalculoIcmsPrestacao, aliquotaIcmsPrestacao,
    percentualReducaoBaseIcms, valorIcmsNaoTributado, valorIcmsOutras, valorCreditoPresumidoIcms, valorFcp,
    documentosTransportados,
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
      veiculoReboque2Id: veiculoReboque2Id === null ? null : veiculoReboque2Id || undefined,
      veiculoReboque3Id: veiculoReboque3Id === null ? null : veiculoReboque3Id || undefined,
      produtoPredominante: produtoPredominante ?? undefined,
      valorTotalCarga: valorTotalCarga === null ? null : (valorTotalCarga ? Number(valorTotalCarga) : undefined),
      unidadeMedidaCarga: unidadeMedidaCarga ?? undefined,
      volumeM3Total: volumeM3Total === null ? null : (volumeM3Total ? Number(volumeM3Total) : undefined),
      remetenteId: remetenteId === null ? null : remetenteId || undefined,
      expedidorId: expedidorId === null ? null : expedidorId || undefined,
      recebedorId: recebedorId === null ? null : recebedorId || undefined,
      definicaoTomador: definicaoTomador ?? undefined,
      distanciaKm: distanciaKm ?? undefined,
      ufInicio: ufInicio ?? undefined,
      ufFim: ufFim ?? undefined,
      cstIbsCbsPrestacao: cstIbsCbsPrestacao ?? undefined,
      classificacaoTributariaIbsCbsPrestacao: classificacaoTributariaIbsCbsPrestacao ?? undefined,
      tipoServico: tipoServico ?? undefined,
      dataTransporte: dataTransporte ? new Date(dataTransporte) : undefined,
      horaTransporte: horaTransporte ?? undefined,
      cteGlobalizado: typeof cteGlobalizado === "boolean" ? cteGlobalizado : undefined,
      tipoCte: tipoCte ?? undefined,
      cfopPrestacao: cfopPrestacao ?? undefined,
      cstIcmsPrestacao: cstIcmsPrestacao ?? undefined,
      baseCalculoIcmsPrestacao: baseCalculoIcmsPrestacao ?? undefined,
      aliquotaIcmsPrestacao: aliquotaIcmsPrestacao ?? undefined,
      percentualReducaoBaseIcms: percentualReducaoBaseIcms ?? undefined,
      valorIcmsNaoTributado: valorIcmsNaoTributado ?? undefined,
      valorIcmsOutras: valorIcmsOutras ?? undefined,
      valorCreditoPresumidoIcms: valorCreditoPresumidoIcms ?? undefined,
      valorFcp: valorFcp ?? undefined,
      documentosTransportados: documentosTransportados
        ? { deleteMany: {}, create: documentosTransportados.map(mapCteDocumento) }
        : undefined,
      nomeMotorista: nomeMotorista ?? undefined,
      cpfMotorista: cpfMotorista ?? undefined,
      origemPercurso: origemPercurso ?? undefined,
      destinoPercurso: destinoPercurso ?? undefined,
      naturezaOperacao: naturezaOperacao ?? undefined,
      modalidadeFrete: modalidadeFrete ?? undefined,
      dataSaida: dataHoraNoFuso(dataSaida, horaSaida),
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
    include: { itens: { include: { produto: true } }, destinatario: true, remetente: true, expedidor: true, recebedor: true, transportadora: true, veiculo: true, veiculoReboque: true, colaboradorResponsavel: true, documentosTransportados: { include: { notaFiscal: true } } },
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

  // Rascunho nunca saiu daqui: não tem número na SEFAZ, não tem valor
  // fiscal e não precisa deixar rastro. Com ?definitivo=1 ele é apagado de
  // vez, em vez de ficar sujando a lista como cancelado.
  if (existente.status === "rascunho" && req.query.definitivo === "1") {
    await prisma.$transaction([
      prisma.cteDocumento.deleteMany({ where: { cteId: id } }),
      prisma.documentoItem.deleteMany({ where: { documentoId: id } }),
      prisma.documentoEvento.deleteMany({ where: { documentoId: id } }),
      prisma.cartaCorrecao.deleteMany({ where: { documentoId: id } }),
      // Solta os documentos que este manifesto carregava, se for um MDFe.
      prisma.documentoFiscal.updateMany({ where: { mdfeId: id }, data: { mdfeId: null } }),
      prisma.documentoFiscal.delete({ where: { id } }),
    ]);
    return res.status(204).send();
  }

  // Rejeitado já foi à SEFAZ e tem retorno registrado no provedor: some da
  // operação como cancelado, mas o histórico do que foi tentado fica.
  if (existente.status === "rascunho" || existente.status === "rejeitado") {
    await prisma.documentoFiscal.update({ where: { id }, data: { status: "cancelado" } });
    return res.status(204).send();
  }

  // Autorizado: precisa mandar um evento de cancelamento de verdade pra
  // SEFAZ, com justificativa (entre 15 e 255 caracteres).
  if (existente.status === "autorizado") {
    // MDF-e encerrado não pode mais ser cancelado — a viagem já foi
    // registrada como concluída.
    if (existente.tipo === "MDFe" && existente.dataEncerramento) {
      return res.status(409).json({
        erro: "Esse MDF-e já foi encerrado e não pode mais ser cancelado.",
      });
    }

    const { justificativa } = req.body;
    if (!justificativa || justificativa.trim().length < 15) {
      return res.status(400).json({ erro: "A justificativa precisa ter pelo menos 15 caracteres" });
    }

    const ref = refDocumento(existente);
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

  const ref = refDocumento(documento);
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

  const ref = refDocumento(documento);
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

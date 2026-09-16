const axios = require("axios");

// Cliente HTTP para o provedor de emissão. Tudo que envolve assinatura com
// certificado digital, comunicação SOAP com a SEFAZ e contingência fica
// dentro do provedor — daqui só saem chamadas REST simples.
const client = axios.create({
  baseURL: process.env.FOCUS_NFE_BASE_URL,
  auth: { username: process.env.FOCUS_NFE_TOKEN, password: "" },
  // O charset explícito evita que acentos (ç, ã, í...) se percam — sem
  // isso, alguns servidores presumem Latin-1 em vez de UTF-8 e os
  // caracteres acentuados saem corrompidos do outro lado (por exemplo, no
  // PDF da carta de correção).
  headers: { "Content-Type": "application/json; charset=utf-8" },
});

// Tabelas de código da SEFAZ — convertidas a partir dos rótulos em
// português que aparecem no formulário, pra montar o payload da Focus NFe.
const CODIGO_FINALIDADE = { "Normal": 1, "Complementar": 2, "Ajuste": 3, "Devolução": 4 };
const CODIGO_PRESENCA = {
  "Não se aplica": 0, "Presencial": 1, "Internet": 2, "Teleatendimento": 3,
  "Entrega a domicílio": 4, "Presencial fora do estabelecimento": 5,
};
const CODIGO_MODALIDADE_FRETE = {
  "Por conta do emitente": 0, "Por conta do destinatário": 1, "Por conta de terceiros": 2, "Sem frete": 9,
};
const CODIGO_FORMA_PAGAMENTO = {
  "Dinheiro": "01", "Cartão de Crédito": "03", "Cartão de Débito": "04", "PIX": "17",
  "Boleto": "15", "Transferência Bancária": "16", "Sem pagamento (a prazo)": "90",
};

// Monta o payload que a Focus NFe espera para uma NFe a partir dos nossos
// registros já carregados do banco (empresa, destinatário, itens com
// produto, transportadora/veículo, colaborador responsável e os campos de
// cabeçalho preenchidos no cadastro). Ajuste os nomes de campo conforme a
// versão da documentação do provedor.
function montarPayloadNfe({ empresa, destinatario, itens, documento, transportadora, veiculo }) {
  return {
    natureza_operacao: documento.naturezaOperacao || "Venda de mercadoria",
    data_emissao: (documento.dataEmissao || new Date()).toISOString(),
    data_entrada_saida: documento.dataSaida ? documento.dataSaida.toISOString() : undefined,
    tipo_documento: 1, // 1 = saída
    finalidade_emissao: CODIGO_FINALIDADE[documento.finalidadeOperacao] ?? 1,
    consumidor_final: documento.consumidorFinal ? 1 : 0,
    presenca_comprador: CODIGO_PRESENCA[documento.indicadorPresenca] ?? 0,
    cnpj_emitente: empresa.cnpj,

    nome_destinatario: destinatario.nomeRazaoSocial,
    cpf_destinatario: destinatario.tipo === "pessoa_fisica" ? destinatario.documento : undefined,
    cnpj_destinatario: destinatario.tipo === "pessoa_juridica" ? destinatario.documento : undefined,
    inscricao_estadual_destinatario: destinatario.ie || undefined,
    indicador_inscricao_estadual_destinatario: destinatario.indicadorIe === "Contribuinte" ? 1 : destinatario.indicadorIe === "Contribuinte Isento" ? 2 : 9,
    logradouro_destinatario: destinatario.endereco?.logradouro,
    numero_destinatario: destinatario.endereco?.numero,
    complemento_destinatario: destinatario.endereco?.complemento || undefined,
    bairro_destinatario: destinatario.endereco?.bairro,
    municipio_destinatario: destinatario.endereco?.cidade,
    uf_destinatario: destinatario.endereco?.uf,
    cep_destinatario: destinatario.endereco?.cep,
    telefone_destinatario: destinatario.telefone || undefined,
    email_destinatario: destinatario.email || undefined,

    modalidade_frete: CODIGO_MODALIDADE_FRETE[documento.modalidadeFrete] ?? 9,
    nome_transportador: transportadora?.razaoSocial || undefined,
    cnpj_transportador: transportadora?.cnpj || undefined,
    veiculo_placa: veiculo?.placa || undefined,
    volumes: documento.quantidadeVolumes
      ? [{
          quantidade: documento.quantidadeVolumes,
          especie: documento.especieVolumes || undefined,
          peso_bruto: documento.pesoBrutoTotal || undefined,
          peso_liquido: documento.pesoLiquidoTotal || undefined,
        }]
      : undefined,

    formas_pagamento: [{
      forma_pagamento: CODIGO_FORMA_PAGAMENTO[documento.formaPagamento] ?? "90",
      valor_pagamento: documento.valorTotal,
    }],

    valor_frete: documento.valorFrete || undefined,
    valor_seguro: documento.valorSeguro || undefined,
    valor_desconto: documento.valorDesconto || undefined,
    valor_outras_despesas: documento.outrasDespesas || undefined,
    valor_ipi: documento.valorIpi || undefined,
    icms_base_calculo: documento.baseCalculoIcms || undefined,
    icms_valor_total: documento.valorIcms || undefined,
    icms_base_calculo_st: documento.baseCalculoIcmsSt || undefined,
    icms_valor_total_st: documento.valorIcmsSt || undefined,

    informacoes_adicionais_contribuinte: documento.informacoesComplementares || undefined,

    items: itens.map((item, indice) => ({
      numero_item: indice + 1,
      codigo_produto: item.produto.codigoInterno,
      descricao: item.produto.descricao,
      codigo_ncm: item.ncmUtilizado || item.produto.ncm,
      cfop: item.cfopUtilizado || item.produto.cfopPadrao,
      unidade_comercial: item.produto.unidade,
      quantidade_comercial: item.quantidade,
      valor_unitario_comercial: item.valorUnitario,
      valor_bruto: item.valorTotal,
      // O cadastro de produto guarda a opção inteira ("0 - Nacional"), mas
      // a Focus NFe só aceita o dígito do código.
      icms_origem: (item.produto.origemMercadoria || "0").charAt(0),
      icms_situacao_tributaria: empresa.regimeTributario === "simples_nacional"
        ? (item.produto.csosn || item.cstUtilizado || item.produto.cstIcms)
        : (item.cstUtilizado || item.produto.cstIcms),
      cest: item.produto.cest || undefined,
      // PIS/COFINS vêm do cadastro do produto agora. "07" (isenta) fica
      // como plano B só se o produto ainda não tiver isso configurado.
      pis_situacao_tributaria: item.produto.pisCst || "07",
      pis_base_calculo: item.produto.pisAliquota ? item.valorTotal : undefined,
      pis_aliquota_porcentual: item.produto.pisAliquota || undefined,
      pis_valor: item.produto.pisAliquota ? item.valorTotal * (item.produto.pisAliquota / 100) : undefined,
      cofins_situacao_tributaria: item.produto.cofinsCst || "07",
      cofins_base_calculo: item.produto.cofinsAliquota ? item.valorTotal : undefined,
      cofins_aliquota_porcentual: item.produto.cofinsAliquota || undefined,
      cofins_valor: item.produto.cofinsAliquota ? item.valorTotal * (item.produto.cofinsAliquota / 100) : undefined,
      // IBS/CBS (Reforma Tributária) — só manda se o produto já tiver isso
      // configurado (depende do contador confirmar o código certo pra
      // cada produto; não temos como advinhar isso com segurança aqui).
      // As alíquotas abaixo são as de TESTE definidas pra fase de
      // transição de 2026 (confirmado com o suporte da Focus NFe) — não
      // são as alíquotas reais de produção, que sobem gradualmente até
      // 2033.
      ibs_cbs_situacao_tributaria: item.produto.cstIbsCbs || undefined,
      ibs_cbs_classificacao_tributaria: item.produto.classificacaoTributariaIbsCbs || undefined,
      ibs_cbs_base_calculo: item.produto.cstIbsCbs ? item.valorTotal : undefined,
      ibs_uf_aliquota: item.produto.cstIbsCbs ? 0.10 : undefined,
      ibs_uf_valor: item.produto.cstIbsCbs ? item.valorTotal * (0.10 / 100) : undefined,
      ibs_mun_aliquota: item.produto.cstIbsCbs ? 0 : undefined,
      ibs_mun_valor: item.produto.cstIbsCbs ? 0 : undefined,
      cbs_aliquota: item.produto.cstIbsCbs ? 0.90 : undefined,
      cbs_valor: item.produto.cstIbsCbs ? item.valorTotal * (0.90 / 100) : undefined,
    })),
  };
}

// Monta o payload de CTe. Aqui a transportadora (ou a própria empresa, se
// ela mesma fizer o frete) é quem emite; o destinatário do cadastro de
// pessoas entra como tomador do serviço — o mais comum é o próprio
// destinatário da mercadoria pagar o frete.
function montarPayloadCte({ empresa, tomador, valorTotal }) {
  return {
    natureza_operacao: "Prestação de serviço de transporte",
    data_emissao: new Date().toISOString(),
    cnpj_emitente: empresa.cnpj,
    tomador_tipo: 0, // 0 = CNPJ/CPF do próprio tomador informado abaixo
    tomador_cnpj: tomador.tipo === "pessoa_juridica" ? tomador.documento : undefined,
    tomador_cpf: tomador.tipo === "pessoa_fisica" ? tomador.documento : undefined,
    tomador_nome: tomador.nomeRazaoSocial,
    municipio_inicio: tomador.endereco?.cidade,
    uf_inicio: tomador.endereco?.uf,
    municipio_fim: tomador.endereco?.cidade,
    uf_fim: tomador.endereco?.uf,
    valor_total_servico: valorTotal,
    valor_recebido: valorTotal,
  };
}

// Monta o payload de MDFe. Ele não carrega itens de produto — carrega as
// chaves de acesso das NFe/CTe que estão sendo transportadas na viagem.
function montarPayloadMdfe({ empresa, veiculo, nomeMotorista, cpfMotorista, ufPercurso, documentosVinculados }) {
  return {
    data_emissao: new Date().toISOString(),
    cnpj_emitente: empresa.cnpj,
    uf_ini: ufPercurso?.split(",")[0],
    uf_fim: ufPercurso?.split(",").slice(-1)[0],
    percurso: ufPercurso?.split(","),
    modal: "1", // 1 = rodoviário
    veiculo_placa: veiculo?.placa,
    veiculo_tara: veiculo?.taraKg,
    condutores: [{ nome: nomeMotorista, cpf: cpfMotorista }],
    documentos: documentosVinculados.map((doc) => ({
      chave_acesso: doc.chaveAcesso,
      tipo: doc.tipo === "NFe" ? "nfe" : "cte",
    })),
  };
}

const ENDPOINT_POR_TIPO = { NFe: "nfe", CTe: "cte", MDFe: "mdfe" };

// A Focus NFe recebe uma referência sua (ref) e processa a emissão de forma
// assíncrona — por isso o fluxo típico é: enviar, depois consultar o status.
// O mesmo par emitir/consultar serve para os três tipos de documento; só
// muda o segmento da URL.
async function emitir({ tipo, ref, payload }) {
  const { data } = await client.post(`/v2/${ENDPOINT_POR_TIPO[tipo]}?ref=${ref}`, payload);
  return data; // { status: "processando_autorizacao", ... }
}

async function consultar({ tipo, ref }) {
  const { data } = await client.get(`/v2/${ENDPOINT_POR_TIPO[tipo]}/${ref}`);
  return data; // status pode ser: autorizado | erro_autorizacao | cancelado
}

// Só existe pra NFe na Focus — manda o DANFE/XML por e-mail pro
// destinatário (ou pra qualquer e-mail que a gente passar).
async function enviarPorEmail({ ref, emails }) {
  const { data } = await client.post(`/v2/nfe/${ref}/email`, { emails });
  return data;
}

// Cancela um documento já autorizado — isso manda um evento real pra
// SEFAZ, é bem diferente de só apagar um rascunho. A SEFAZ exige uma
// justificativa entre 15 e 255 caracteres.
async function cancelar({ tipo, ref, justificativa }) {
  const { data } = await client.delete(`/v2/${ENDPOINT_POR_TIPO[tipo]}/${ref}`, {
    data: { justificativa },
  });
  return data; // status: "cancelado" quando a SEFAZ homologa o cancelamento
}

// Carta de Correção Eletrônica — só existe pra NFe. A correção deve ter
// entre 15 e 1000 caracteres, e não serve pra corrigir valores, impostos,
// dados cadastrais do emitente/destinatário ou datas — só detalhes como
// descrição, endereço de entrega, etc.
async function emitirCartaCorrecao({ ref, texto }) {
  const { data } = await client.post(`/v2/nfe/${ref}/carta_correcao`, { correcao: texto });
  return data;
}

// A Focus NFe às vezes devolve caminho_danfe/caminho_xml_* como um caminho
// relativo (ex: "/arquivos_development/..."), não a URL completa — sem
// isso o link abriria dentro do nosso próprio site em vez do da Focus.
function urlCompleta(caminho) {
  if (!caminho) return caminho;
  if (caminho.startsWith("http://") || caminho.startsWith("https://")) return caminho;
  const base = (process.env.FOCUS_NFE_BASE_URL || "").replace(/\/$/, "");
  return `${base}${caminho.startsWith("/") ? "" : "/"}${caminho}`;
}

module.exports = {
  montarPayloadNfe,
  montarPayloadCte,
  urlCompleta,
  enviarPorEmail,
  cancelar,
  emitirCartaCorrecao,
  montarPayloadMdfe,
  emitir,
  consultar,
};

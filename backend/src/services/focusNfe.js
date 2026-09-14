const axios = require("axios");

// Cliente HTTP para o provedor de emissão. Tudo que envolve assinatura com
// certificado digital, comunicação SOAP com a SEFAZ e contingência fica
// dentro do provedor — daqui só saem chamadas REST simples.
const client = axios.create({
  baseURL: process.env.FOCUS_NFE_BASE_URL,
  auth: { username: process.env.FOCUS_NFE_TOKEN, password: "" },
  headers: { "Content-Type": "application/json" },
});

// Monta o payload que a Focus NFe espera para uma NFe a partir dos nossos
// registros já carregados do banco (empresa, destinatário, itens com produto).
// Ajuste os nomes de campo conforme a versão da documentação do provedor.
function montarPayloadNfe({ empresa, destinatario, itens }) {
  return {
    natureza_operacao: "Venda de mercadoria",
    data_emissao: new Date().toISOString(),
    tipo_documento: 1, // 1 = saída
    finalidade_emissao: 1, // 1 = normal
    cnpj_emitente: empresa.cnpj,

    nome_destinatario: destinatario.nomeRazaoSocial,
    cpf_destinatario: destinatario.tipo === "pessoa_fisica" ? destinatario.documento : undefined,
    cnpj_destinatario: destinatario.tipo === "pessoa_juridica" ? destinatario.documento : undefined,
    inscricao_estadual_destinatario: destinatario.ie || undefined,
    logradouro_destinatario: destinatario.endereco?.logradouro,
    numero_destinatario: destinatario.endereco?.numero,
    bairro_destinatario: destinatario.endereco?.bairro,
    municipio_destinatario: destinatario.endereco?.cidade,
    uf_destinatario: destinatario.endereco?.uf,
    cep_destinatario: destinatario.endereco?.cep,

    items: itens.map((item, indice) => ({
      numero_item: indice + 1,
      codigo_produto: item.produto.codigoInterno,
      descricao: item.produto.descricao,
      ncm: item.produto.ncm,
      cfop: item.cfopUtilizado || item.produto.cfopPadrao,
      unidade_comercial: item.produto.unidade,
      quantidade_comercial: item.quantidade,
      valor_unitario_comercial: item.valorUnitario,
      valor_bruto: item.valorTotal,
      icms_origem: item.produto.origemMercadoria || "0",
      icms_situacao_tributaria: item.produto.cstIcms || item.produto.csosn,
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

module.exports = {
  montarPayloadNfe,
  montarPayloadCte,
  montarPayloadMdfe,
  emitir,
  consultar,
};

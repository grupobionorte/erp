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

// --- Helpers de formatação fiscal -----------------------------------------
// A SEFAZ valida os decimais com casas fixas. Multiplicação em ponto
// flutuante gera coisas como 45.00000000000001, que o schema rejeita.
function dec(valor, casas = 2) {
  if (valor === null || valor === undefined || valor === "") return undefined;
  return Number(Number(valor).toFixed(casas));
}

// Corta respeitando a palavra: "…estabelecimento industr" fica feio no
// DACTe, e quem lê o documento é gente.
function limitarTexto(texto, maximo) {
  const limpo = String(texto || "").trim();
  if (limpo.length <= maximo) return limpo;
  const cortado = limpo.slice(0, maximo);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  // Só volta até o espaço se não perder metade do texto no caminho.
  return (ultimoEspaco > maximo * 0.6 ? cortado.slice(0, ultimoEspaco) : cortado).trim();
}

function somenteDigitos(valor) {
  if (!valor) return undefined;
  return String(valor).replace(/\D/g, "") || undefined;
}

// Partes de data/hora de um instante, já no fuso informado.
function partesNoFuso(d, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((parte) => [parte.type, parte.value])
  );
}

// Offset do fuso, em minutos, para aquele instante (cobre horário de verão).
function offsetMinutos(d, timeZone) {
  const p = partesNoFuso(d, timeZone);
  const comoUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second)
  );
  return Math.round((comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

// O formulário grava a data de emissão como data pura (2026-09-16T00:00:00Z).
// Converter isso direto pro fuso jogaria a emissão pro dia anterior, então
// nesse caso mantemos o dia escolhido e usamos a hora atual — que é o que a
// SEFAZ espera (data de emissão não pode ser futura nem muito antiga).
function normalizarDataEmissao(valor, timeZone) {
  if (!valor) return new Date();
  const d = valor instanceof Date ? valor : new Date(valor);
  const ehSomenteData =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (!ehSomenteData) return d;

  const agora = new Date();
  const h = partesNoFuso(agora, timeZone);
  const alvo = Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    Number(h.hour), Number(h.minute), Number(h.second)
  );
  // Dois passos para acertar o offset (o primeiro chute pode cair em outro
  // lado de uma virada de horário de verão).
  let instante = new Date(alvo - offsetMinutos(agora, timeZone) * 60000);
  instante = new Date(alvo - offsetMinutos(instante, timeZone) * 60000);
  return instante;
}

// toISOString() devolve UTC ("...T00:00:00.000Z"), o que joga a emissão pro
// dia anterior no horário local. A SEFAZ quer a hora local com o offset
// explícito — e o servidor do Render roda em UTC, então não dá pra usar
// getHours() direto. O fuso padrão é o de Mato Grosso (UTC-4); ajuste
// TZ_FISCAL se a empresa emitir de outro estado.
function dataEmissaoSefaz(data = new Date(), timeZone = process.env.TZ_FISCAL || "America/Cuiaba") {
  const pad = (n) => String(n).padStart(2, "0");

  try {
    const d = normalizarDataEmissao(data, timeZone);
    const p = partesNoFuso(d, timeZone);
    const offsetMin = offsetMinutos(d, timeZone);
    const sinal = offsetMin < 0 ? "-" : "+";
    const abs = Math.abs(offsetMin);

    return (
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` +
      `${sinal}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
  } catch {
    // Se o fuso for inválido, cai para UTC explícito em vez de quebrar a emissão.
    const d = data instanceof Date ? data : new Date(data);
    return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
  }
}

// Monta o payload que a Focus NFe espera para uma NFe a partir dos nossos
// registros já carregados do banco (empresa, destinatário, itens com
// produto, transportadora/veículo, colaborador responsável e os campos de
// cabeçalho preenchidos no cadastro). Ajuste os nomes de campo conforme a
// versão da documentação do provedor.
function montarPayloadNfe({ empresa, destinatario, itens, documento, transportadora, veiculo }) {
  return {
    // Mesmo limite de 60 caracteres vale para a NF-e.
    natureza_operacao: limitarTexto(documento.naturezaOperacao || "Venda de mercadoria", 60),
    data_emissao: (documento.dataEmissao || new Date()).toISOString(),
    data_entrada_saida: documento.dataSaida ? documento.dataSaida.toISOString() : undefined,
    tipo_documento: 1, // 1 = saída
    finalidade_emissao: CODIGO_FINALIDADE[documento.finalidadeOperacao] ?? 1,
    consumidor_final: documento.consumidorFinal ? 1 : 0,
    presenca_comprador: CODIGO_PRESENCA[documento.indicadorPresenca] ?? 0,
    cnpj_emitente: somenteDigitos(empresa.cnpj),

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
      pis_valor: item.produto.pisAliquota ? dec(item.valorTotal * (item.produto.pisAliquota / 100)) : undefined,
      cofins_situacao_tributaria: item.produto.cofinsCst || "07",
      cofins_base_calculo: item.produto.cofinsAliquota ? item.valorTotal : undefined,
      cofins_aliquota_porcentual: item.produto.cofinsAliquota || undefined,
      cofins_valor: item.produto.cofinsAliquota ? dec(item.valorTotal * (item.produto.cofinsAliquota / 100)) : undefined,
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
      ibs_uf_valor: item.produto.cstIbsCbs ? dec(item.valorTotal * (0.10 / 100)) : undefined,
      ibs_mun_aliquota: item.produto.cstIbsCbs ? 0 : undefined,
      ibs_mun_valor: item.produto.cstIbsCbs ? 0 : undefined,
      cbs_aliquota: item.produto.cstIbsCbs ? 0.90 : undefined,
      cbs_valor: item.produto.cstIbsCbs ? dec(item.valorTotal * (0.90 / 100)) : undefined,
    })),
  };
}

// Monta o payload de CTe. Aqui a transportadora (ou a própria empresa, se
// ela mesma fizer o frete) é quem emite; o destinatário do cadastro de
// pessoas entra como tomador do serviço — o mais comum é o próprio
// destinatário da mercadoria pagar o frete.
// Código do "tomador" (quem paga o frete) que a Focus NFe usa: quando é um
// dos 4 papéis já informados no CTe, ela reaproveita os dados desse bloco
// (remetente/expedidor/recebedor/destinatário) — só quando for "Outros" é
// que precisaria de um bloco de endereço à parte (ainda não implementado).
const CODIGO_TOMADOR = { "Remetente": 0, "Expedidor": 1, "Recebedor": 2, "Destinatário": 3, "Outros": 4 };

function blocoPessoaCte(pessoa, prefixo, empresa) {
  if (!pessoa) return {};
  const doc = (pessoa.documento || "").replace(/\D/g, "");

  // A IE é obrigatória pra contribuinte (rejeição 716 "IE do Remetente não
  // informada"). Dois casos que o cadastro de pessoas costuma deixar em
  // branco:
  //  - o papel é a própria empresa emitente (ela mesma transportando a
  //    carga dela): usa a IE de Configurações;
  //  - o contribuinte é isento: a tag vai com o texto ISENTO.
  const ehAEmpresa = empresa?.cnpj && doc === String(empresa.cnpj).replace(/\D/g, "");
  const inscricaoEstadual =
    pessoa.ieIsento || pessoa.indicadorIe === "Contribuinte Isento"
      ? "ISENTO"
      : pessoa.ie || (ehAEmpresa ? empresa.ie : undefined) || undefined;

  // Telefone e endereço completo são obrigatórios pra remetente, expedidor,
  // recebedor e destinatário sempre que o bloco existe — se faltar algo no
  // cadastro dessa pessoa, é melhor a Focus apontar exatamente o campo que
  // falta do que a gente esconder o bloco inteiro e gerar um erro confuso
  // de sequência no XML.
  return {
    [`cnpj_${prefixo}`]: pessoa.tipo === "pessoa_juridica" ? doc : undefined,
    [`cpf_${prefixo}`]: pessoa.tipo === "pessoa_fisica" ? doc : undefined,
    [`inscricao_estadual_${prefixo}`]: inscricaoEstadual,
    [`nome_${prefixo}`]: pessoa.nomeRazaoSocial,
    [`nome_fantasia_${prefixo}`]: pessoa.nomeFantasia || pessoa.nomeRazaoSocial,
    [`telefone_${prefixo}`]: (pessoa.telefone || "").replace(/\D/g, "") || undefined,
    [`email_${prefixo}`]: pessoa.email || undefined,
    [`logradouro_${prefixo}`]: pessoa.endereco?.logradouro,
    [`numero_${prefixo}`]: pessoa.endereco?.numero,
    [`complemento_${prefixo}`]: pessoa.endereco?.complemento || undefined,
    [`bairro_${prefixo}`]: pessoa.endereco?.bairro,
    [`municipio_${prefixo}`]: pessoa.endereco?.cidade,
    [`uf_${prefixo}`]: pessoa.endereco?.uf,
    [`cep_${prefixo}`]: (pessoa.endereco?.cep || "").replace(/\D/g, "") || undefined,
    [`codigo_pais_${prefixo}`]: 1058,
    [`pais_${prefixo}`]: "Brasil",
  };
}

// Códigos que a SEFAZ usa pra tipo do CT-e e tipo de serviço — convertidos
// a partir dos rótulos em português que aparecem no formulário.
const CODIGO_TIPO_CTE = { "CT-e normal": 0, "Complemento de Valores": 1, "Anulação": 2, "Substituto": 3 };
const CODIGO_TIPO_SERVICO = { "Normal": 0, "Subcontratação": 1, "Redespacho": 2, "Redespacho Intermediário": 3, "Multimodal": 4 };

// Ficha da viagem para as observações gerais do DACTe.
function montarObservacoesCte(documento) {
  const linhas = [];

  // Só a placa: a descrição do cadastro é para uso interno e só ocuparia
  // espaço na observação.
  if (documento.veiculo?.placa) linhas.push(`VEICULO: ${documento.veiculo.placa}`);

  // Só os reboques que existirem: bitrem tem um, rodotrem tem dois.
  [documento.veiculoReboque, documento.veiculoReboque2, documento.veiculoReboque3]
    .map(v => v?.placa)
    .filter(Boolean)
    .forEach((placa, i) => linhas.push(`REBOQUE ${i + 1}: ${placa}`));

  if (documento.nomeMotorista) {
    const cpf = somenteDigitos(documento.cpfMotorista);
    const cpfFormatado = cpf?.length === 11
      ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
      : documento.cpfMotorista;
    linhas.push(`MOTORISTA: ${documento.nomeMotorista}${cpfFormatado ? ` - CPF ${cpfFormatado}` : ""}`);
  }

  // Data e hora da saída. Não preenchidas, valem as do envio — o CT-e é
  // emitido quando o caminhão está saindo, então é a informação mais
  // próxima da realidade, e melhor que deixar a linha em branco no DACTe.
  const zona = process.env.TZ_FISCAL || "America/Cuiaba";
  const agora = new Date();
  const data = documento.dataTransporte
    ? new Date(documento.dataTransporte).toLocaleDateString("pt-BR", { timeZone: zona })
    : agora.toLocaleDateString("pt-BR", { timeZone: zona });
  const hora = documento.horaTransporte
    || agora.toLocaleTimeString("pt-BR", { timeZone: zona, hour: "2-digit", minute: "2-digit" });
  linhas.push(`SAIDA: ${data} as ${hora}`);

  // O que o usuário escreveu vem primeiro; a ficha da viagem, depois.
  // xObs aceita 2000 caracteres.
  const texto = [documento.informacoesComplementares, linhas.join(" | ")]
    .filter(t => t && String(t).trim())
    .join(" | ");

  return texto ? texto.slice(0, 2000) : undefined;
}

function montarPayloadCte({ empresa, destinatario, remetente, expedidor, recebedor, veiculo, veiculoReboque, documento }) {
  const codigoTomador = CODIGO_TOMADOR[documento.definicaoTomador] ?? 3; // padrão: Destinatário

  // O indicador de IE precisa descrever QUEM é o tomador — se ficar fixo em
  // 9 (não contribuinte) enquanto o tomador é uma empresa com IE, a SEFAZ
  // rejeita por inconsistência entre o papel e o cadastro.
  const pessoaTomador = { 0: remetente, 1: expedidor, 2: recebedor, 3: destinatario }[codigoTomador];
  const indicadorIeTomador =
    pessoaTomador?.indicadorIe === "Contribuinte" ? 1 :
    pessoaTomador?.indicadorIe === "Contribuinte Isento" ? 2 : 9;

  // vTotDFe: obrigatório sempre que o grupo IBS/CBS for informado (NT
  // 2025.001 — rejeição 360 "Total do DFe de preenchimento obrigatório").
  // Durante 2026 o IBS e a CBS NÃO entram nesse total, então ele é igual ao
  // valor total da prestação.
  const temIbsCbs = Boolean(documento.cstIbsCbsPrestacao);

  // Carga: soma das notas transportadas, com o campo manual por cima.
  const somar = (campo) =>
    (documento.documentosTransportados || []).reduce((t, d) => t + (Number(d[campo]) || 0), 0);
  const valorDaCarga = Number(documento.valorTotalCarga) || somar("valorTotalNota") || somar("valorTotalProdutos") || undefined;
  const pesoDaCarga = Number(documento.pesoBrutoTotal) || somar("pesoBruto") || undefined;
  const pesoLiquidoDaCarga = Number(documento.pesoLiquidoTotal) || somar("pesoLiquido") || undefined;
  const volumeDaCarga = Number(documento.volumeM3Total) || somar("m3") || undefined;

  // Códigos da unidade de medida no CT-e: 00 M3, 01 KG, 02 TON, 03 UNIDADE.
  const UNIDADE = { M3: "00", KG: "01", TON: "02", UNIDADE: "03" };
  const unidadeCarga = String(documento.unidadeMedidaCarga || "KG").toUpperCase();
  // Vendido por metro cúbico o peso continua em quilo — o volume é que
  // entra como medida da negociação.
  const codigoPeso = unidadeCarga === "TON" ? UNIDADE.TON : UNIDADE.KG;

  // O tipo de medida sai com a unidade da venda (KG, TON, M3). O texto é
  // curto de propósito: a coluna "TIPO MEDIDA" do DACTe é estreita, e
  // "PESO LIQUIDO (KG)" não cabe — o gerador do PDF corta o excesso e a
  // unidade some justamente por isso.
  const rotuloPeso = unidadeCarga === "TON" ? "TON" : "KG";

  const medidasDaCarga = [];
  if (pesoDaCarga) {
    medidasDaCarga.push({ codigo_unidade_medida: codigoPeso, tipo_medida: `P.Bruto(${rotuloPeso})`, quantidade: dec(pesoDaCarga, 4) });
  }
  if (unidadeCarga === "M3" && volumeDaCarga) {
    medidasDaCarga.push({ codigo_unidade_medida: UNIDADE.M3, tipo_medida: "Volume(M3)", quantidade: dec(volumeDaCarga, 4) });
  }
  if (unidadeCarga !== "M3" && pesoLiquidoDaCarga) {
    medidasDaCarga.push({ codigo_unidade_medida: codigoPeso, tipo_medida: `P.Liqu.(${rotuloPeso})`, quantidade: dec(pesoLiquidoDaCarga, 4) });
  }
  // O schema exige ao menos uma medida; sem peso nenhum, sobra a contagem
  // de volumes.
  if (!medidasDaCarga.length) {
    medidasDaCarga.push({ codigo_unidade_medida: UNIDADE.UNIDADE, tipo_medida: "UNIDADE", quantidade: documento.quantidadeVolumes || 1 });
  }

  return {
    cfop: documento.cfopPrestacao || undefined,
    // natOp aceita no máximo 60 caracteres. Como a natureza vem da
    // descrição do CFOP, e várias passam disso, o corte é obrigatório —
    // sem ele o XML é recusado antes de chegar à SEFAZ.
    natureza_operacao: limitarTexto(documento.naturezaOperacao || "Prestação de serviço de transporte", 60),
    data_emissao: dataEmissaoSefaz(documento.dataEmissao || new Date()),
    tipo_documento: CODIGO_TIPO_CTE[documento.tipoCte] ?? 0,
    tipo_servico: CODIGO_TIPO_SERVICO[documento.tipoServico] ?? 0,
    indicador_globalizado: documento.cteGlobalizado ? 1 : undefined,
    cnpj_emitente: somenteDigitos(empresa.cnpj),

    // Município/UF de envio — quando não temos um cadastro à parte pra
    // isso, usamos o mesmo do início da prestação (é o caso mais comum).
    // Não mandamos o código IBGE — a Focus resolve sozinha a partir do
    // nome + UF, que agora vêm de um cadastro de verdade (não mais de um
    // texto livre tipo "Cidade/UF").
    municipio_envio: documento.origemPercurso,
    uf_envio: documento.ufInicio,
    municipio_inicio: documento.origemPercurso,
    uf_inicio: documento.ufInicio,
    municipio_fim: documento.destinoPercurso,
    uf_fim: documento.ufFim,

    // Indicador se o recebedor retira a mercadoria no local (aeroporto,
    // filial, porto, estação) em vez de receber entrega — 0 = Sim,
    // 1 = Não (padrão, entrega normal). "detalhes_retirar" é obrigatório
    // sempre que esse grupo aparece.
    retirar_mercadoria: 1,
    detalhes_retirar: "Não se aplica",

    indicador_inscricao_estadual_tomador: indicadorIeTomador,
    tomador: codigoTomador,

    ...blocoPessoaCte(remetente, "remetente", empresa),
    ...blocoPessoaCte(expedidor, "expedidor", empresa),
    ...blocoPessoaCte(recebedor, "recebedor", empresa),
    ...blocoPessoaCte(destinatario, "destinatario", empresa),

    valor_total: dec(documento.valorTotal),
    valor_receber: dec(documento.valorTotal),

    icms_situacao_tributaria: documento.cstIcmsPrestacao || "90",
    icms_base_calculo: dec(documento.baseCalculoIcmsPrestacao),
    icms_aliquota: dec(documento.aliquotaIcmsPrestacao),
    icms_valor: dec(documento.valorIcms),
    icms_reducao_base_calculo: dec(documento.percentualReducaoBaseIcms),
    icms_valor_credito_presumido: dec(documento.valorCreditoPresumidoIcms),

    // Total do DFe — exigido pela SEFAZ quando o grupo IBS/CBS está
    // presente. Em 2026 é igual ao valor total da prestação.
    valor_total_dfe: temIbsCbs ? dec(documento.valorTotal) : undefined,

    // Valor da CARGA, não do frete. São grandezas diferentes: o frete é o
    // que se cobra pelo transporte, a carga é quanto vale a mercadoria que
    // está no caminhão. Vem das notas vinculadas, e o campo manual do
    // formulário tem prioridade quando preenchido.
    valor_total_carga: dec(valorDaCarga),
    valor_carga_averbacao: dec(valorDaCarga),

    // O que está sendo transportado, como aparece no DACTe e como a
    // fiscalização de estrada confere na carroceria.
    produto_predominante: limitarTexto(
      documento.produtoPredominante
        || documento.documentosTransportados?.[0]?.naturezaMercadoria
        || documento.especieVolumes
        || "Carga geral",
      60
    ),
    outras_caracteristicas_carga: documento.especieVolumes || undefined,

    // Medidas da carga no DACTe. O peso bruto vai sempre — é o que a
    // balança e a fiscalização de estrada conferem. Além dele, entra o que
    // corresponde à forma como o produto é vendido: volume, quando a
    // negociação é por metro cúbico; peso líquido, quando é por peso.
    quantidades: medidasDaCarga,

    // Observações gerais do DACTe: tag xObs, que é a caixa "OBSERVAÇÕES
    // GERAIS" do documento. Não confundir com informacoes_adicionais_fisco
    // (infAdFisco), que é a caixa de interesse do Fisco, logo acima — foi
    // onde isso caiu antes e por isso não aparecia.
    // Vai a ficha da viagem: veículo, reboques, motorista e quando saiu.
    observacao: montarObservacoesCte(documento),

    // NFe(s) que esse CTe está transportando — a chave de acesso de cada
    // uma, já autorizada.
    // Só manda pra Focus os documentos do tipo "Fiscal" com chave de
    // acesso — os outros tipos (Declaração, Dutoviário, etc.) ainda não
    // têm um formato de payload confirmado.
    nfes: documento.documentosTransportados?.some((doc) => doc.tipo === "Fiscal" && (doc.chaveAcesso || doc.notaFiscal?.chaveAcesso))
      ? documento.documentosTransportados
          .filter((doc) => doc.tipo === "Fiscal" && (doc.chaveAcesso || doc.notaFiscal?.chaveAcesso))
          // Só dígitos: chave colada do DANFE vem com espaços, e a que a
          // Focus devolve vem com o prefixo "NFe".
          .map((doc) => ({ chave_nfe: somenteDigitos(doc.chaveAcesso || doc.notaFiscal?.chaveAcesso) }))
      : undefined,

    // Diferente do MDFe, o CTe não leva uma lista de veículos/condutores
    // nesse grupo — isso é coisa do MDFe (confirmado com o retorno da
    // Focus: "Campo 'veiculos' não é válido para o tipo de modal
    // especificado"). O CTe rodoviário só pede o RNTRC.
    modal_rodoviario: {
      rntrc: empresa.rntrc || undefined,
    },

    // IBS/CBS (Reforma Tributária) — no nível do documento, já que o CTe
    // não tem itens. Só manda se o CTe já tiver isso configurado, pelo
    // mesmo motivo da NFe: o código certo depende do contador confirmar,
    // não tem como advinhar aqui. As alíquotas usadas são as de TESTE da
    // fase de transição de 2026 (confirmadas com o suporte da Focus NFe).
    ibs_cbs_situacao_tributaria: documento.cstIbsCbsPrestacao || undefined,
    ibs_cbs_classificacao_tributaria: documento.classificacaoTributariaIbsCbsPrestacao || undefined,
    ibs_cbs_base_calculo: temIbsCbs ? dec(documento.valorTotal) : undefined,
    ibs_uf_aliquota: temIbsCbs ? 0.10 : undefined,
    ibs_uf_valor: temIbsCbs ? dec(documento.valorTotal * (0.10 / 100)) : undefined,
    ibs_mun_aliquota: temIbsCbs ? 0 : undefined,
    ibs_mun_valor: temIbsCbs ? 0 : undefined,
    cbs_aliquota: temIbsCbs ? 0.90 : undefined,
    cbs_valor: temIbsCbs ? dec(documento.valorTotal * (0.90 / 100)) : undefined,
  };
}

// Confere o payload do CT-e antes de gastar uma ida à SEFAZ. Cada item da
// lista corresponde a uma rejeição conhecida — é mais rápido (e mais claro
// pra quem está na tela) descobrir aqui do que esperar o retorno.
function validarPayloadCte(payload) {
  const problemas = [];

  // Rejeição 693: o grupo de documentos transportados é obrigatório, exceto
  // em redespacho intermediário (3) e serviço vinculado a multimodal (4).
  const tipoServico = Number(payload.tipo_servico ?? 0);
  const temDocumentos =
    Boolean(payload.nfes?.length) ||
    Boolean(payload.nfs?.length) ||
    Boolean(payload.outros_documentos?.length);
  if (!temDocumentos && tipoServico !== 3 && tipoServico !== 4) {
    problemas.push(
      "Nenhuma NF-e vinculada: o CT-e precisa de pelo menos um documento transportado " +
        "(informe a chave de acesso da nota que está sendo transportada)."
    );
  }

  for (const nfe of payload.nfes || []) {
    if (!/^\d{44}$/.test(nfe.chave_nfe || "")) {
      problemas.push(`Chave de NF-e inválida (precisa de 44 dígitos): ${nfe.chave_nfe || "vazia"}`);
    }
  }

  // Rejeição por RNTRC ausente no modal rodoviário.
  if (!/^\d{8}$/.test(payload.modal_rodoviario?.rntrc || "")) {
    problemas.push("RNTRC não preenchido (8 dígitos) no cadastro da empresa emitente.");
  }

  // CFOP 5xxx é dentro da UF, 6xxx é interestadual.
  if (payload.cfop && payload.uf_inicio && payload.uf_fim) {
    const interestadual = String(payload.cfop).startsWith("6");
    const ufsDiferentes = payload.uf_inicio !== payload.uf_fim;
    if (interestadual !== ufsDiferentes) {
      problemas.push(
        `CFOP ${payload.cfop} não combina com o trajeto ${payload.uf_inicio} → ${payload.uf_fim} ` +
          "(5xxx para operação dentro da UF, 6xxx para interestadual)."
      );
    }
  }

  // Rejeição 360: grupo IBS/CBS informado sem o total do DFe.
  if (payload.ibs_cbs_situacao_tributaria && payload.valor_total_dfe == null) {
    problemas.push("valor_total_dfe é obrigatório quando o grupo IBS/CBS é informado.");
  }

  // Rejeição 716 e irmãs: IE obrigatória para contribuinte em cada papel
  // informado no CT-e.
  const PAPEIS = {
    remetente: "remetente",
    expedidor: "expedidor",
    recebedor: "recebedor",
    destinatario: "destinatário",
  };
  for (const [prefixo, rotulo] of Object.entries(PAPEIS)) {
    const temBloco = payload[`cnpj_${prefixo}`] || payload[`cpf_${prefixo}`];
    // Pessoa física normalmente não tem IE — a cobrança é sobre CNPJ.
    if (temBloco && payload[`cnpj_${prefixo}`] && !payload[`inscricao_estadual_${prefixo}`]) {
      problemas.push(
        `Inscrição estadual do ${rotulo} não informada. Preencha a IE no cadastro de ` +
          `${payload[`nome_${prefixo}`] || rotulo} (ou marque como isento).`
      );
    }
  }

  if (!payload.valor_total) {
    problemas.push("Valor total da prestação não informado.");
  }

  return problemas;
}

// Monta o payload de MDFe. Ele não carrega itens de produto — carrega as
// chaves de acesso das NFe/CTe que estão sendo transportadas na viagem.
// Unidade de medida do peso no MDFe: "01" KG, "02" TON.
const UNIDADE_PESO_MDFE = { KG: "01", TON: "02" };

// Códigos do modal rodoviário. O cadastro guarda o rótulo que a operação
// usa; o XML quer o código da tabela.
const TIPO_RODADO_MDFE = {
  "TRUCK": "01", "TOCO": "02", "CAVALO MECANICO": "03", "CAVALO MECÂNICO": "03",
  "VAN": "04", "UTILITARIO": "05", "UTILITÁRIO": "05", "OUTROS": "06",
};
const TIPO_CARROCERIA_MDFE = {
  "NAO APLICAVEL": "00", "NÃO APLICÁVEL": "00", "ABERTA": "01",
  "FECHADA/BAU": "02", "FECHADA/BAÚ": "02", "GRANELEIRA": "03",
  "PORTA CONTAINER": "04", "SIDER": "05",
};

const codigoDe = (tabela, valor, padrao) =>
  tabela[String(valor || "").trim().toUpperCase()] || padrao;

// Grupo do proprietário do veículo. Só existe quando o veículo é de
// terceiro — com frota própria, informar isso gera rejeição.
function proprietarioDoVeiculo(v, sufixo = "") {
  const doc = somenteDigitos(v?.proprietarioDocumento);
  if (v?.propriedade !== "terceiro" || !doc) return {};

  const campo = (nome) => (sufixo ? `${nome}_${sufixo}` : nome);
  return {
    [campo("cpf_proprietario")]: doc.length === 11 ? doc : undefined,
    [campo("cnpj_proprietario")]: doc.length === 14 ? doc : undefined,
    [campo("rntrc_proprietario")]: somenteDigitos(v.proprietarioRntrc),
    [campo("razao_social_proprietario")]: v.proprietarioNome || undefined,
    [campo("inscricao_estadual_proprietario")]: v.proprietarioIe || undefined,
    [campo("uf_proprietario")]: v.proprietarioUf || undefined,
    [campo("tipo_proprietario")]: v.proprietarioTipo || undefined,
  };
}

// Quem contratou o frete em cada CT-e. A SEFAZ exige esse grupo no MDF-e
// de prestador de serviço (rejeição 578), e a informação já existe: é o
// tomador do conhecimento.
function contratantesDosCtes(ctes) {
  const porDocumento = new Map();

  for (const cte of ctes || []) {
    const pessoa = {
      "Remetente": cte.remetente,
      "Expedidor": cte.expedidor,
      "Recebedor": cte.recebedor,
      "Destinatário": cte.destinatario,
    }[cte.definicaoTomador] || cte.destinatario;

    const doc = somenteDigitos(pessoa?.documento);
    if (!doc || porDocumento.has(doc)) continue;

    porDocumento.set(doc, {
      nome: pessoa.nomeRazaoSocial,
      cpf: doc.length === 11 ? doc : undefined,
      cnpj: doc.length === 14 ? doc : undefined,
    });
  }

  return porDocumento.size ? [...porDocumento.values()] : undefined;
}

// Quem paga o frete, quanto e como. A SEFAZ exige esse grupo no MDF-e de
// carga lotação (rejeição 302) — e os dados são os do próprio CT-e: o
// tomador paga, e o valor é o da prestação.
function pagamentosDosCtes(ctes, empresa) {
  const porDocumento = new Map();

  for (const cte of ctes || []) {
    const pessoa = {
      "Remetente": cte.remetente,
      "Expedidor": cte.expedidor,
      "Recebedor": cte.recebedor,
      "Destinatário": cte.destinatario,
    }[cte.definicaoTomador] || cte.destinatario;

    const doc = somenteDigitos(pessoa?.documento);
    const valor = Number(cte.valorTotal) || 0;
    if (!doc || !valor) continue;

    const atual = porDocumento.get(doc);
    if (atual) {
      atual.valor += valor;
    } else {
      porDocumento.set(doc, {
        nome: pessoa.nomeRazaoSocial,
        cpf: doc.length === 11 ? doc : undefined,
        cnpj: doc.length === 14 ? doc : undefined,
        valor,
      });
    }
  }

  if (!porDocumento.size) return undefined;

  return [...porDocumento.values()].map((p) => ({
    nome: p.nome,
    cpf: p.cpf,
    cnpj: p.cnpj,
    // 04 = Frete. Pedágio e impostos teriam componentes próprios.
    componentes: [{ tipo: "04", valor: dec(p.valor) }],
    valor_total_contrato: dec(p.valor),
    // No MDF-e, "a prazo" quer dizer PARCELADO — e exige o grupo das
    // parcelas no XML. Frete pago na entrega continua sendo à vista.
    forma_pagamento: "0",

    // O schema exige ao menos um destes depois da forma de pagamento:
    // adiantamento, parcelas ou dados bancários. Na prática sobrou o
    // último: o indicador de adiantamento sozinho não é emitido, e o
    // elemento PIX foi recusado nessa posição. Banco e agência são a
    // forma clássica, aceita pelo layout.
    indicador_adiantamento: "0",
    numero_banco: empresa?.bancoNumero || undefined,
    numero_agencia: empresa?.bancoAgencia || undefined,
  }));
}

function montarPayloadMdfe({
  empresa,
  veiculo,
  veiculoReboque,
  reboques,
  nomeMotorista,
  cpfMotorista,
  ufPercurso,
  documentosVinculados,
  documento = {},
}) {
  const ufs = (ufPercurso || "").split(",").map((u) => u.trim().toUpperCase()).filter(Boolean);
  const ufInicio = ufs[0];
  const ufFim = ufs[ufs.length - 1];
  // O percurso são as UFs INTERMEDIÁRIAS — início e fim não entram aqui,
  // senão a SEFAZ acusa percurso inválido.
  const percursoIntermediario = ufs.slice(1, -1);

  const chavesPorTipo = (tipo) =>
    (documentosVinculados || []).filter((d) => d.tipo === tipo && d.chaveAcesso);

  const ctes = chavesPorTipo("CTe");
  const nfes = chavesPorTipo("NFe");

  const ufEmpresa = empresa.endereco?.uf;

  // Um documento só = carga lotação.
  const cargaLotacao = ctes.length + nfes.length === 1;
  const unico = ctes[0] || nfes[0];
  const cepCarregamento = unico?.remetente?.endereco?.cep
    || unico?.expedidor?.endereco?.cep
    || empresa.endereco?.cep;
  const cepDescarregamento = unico?.destinatario?.endereco?.cep
    || unico?.recebedor?.endereco?.cep;
  const listaReboques = (reboques || [veiculoReboque]).filter(Boolean).slice(0, 3);

  return {
    // 1 = prestador de serviço de transporte, 2 = carga própria.
    emitente: documento.tipoEmitenteMdfe || "1",
    // Tipo de transportador (tpTransp) só pode ir quando o veículo de
    // tração tem proprietário declarado — ou seja, quando ele NÃO é da
    // empresa emitente. Com frota própria, informar isso gera a rejeição
    // 745. Por isso o campo só sai se for preenchido de propósito.
    // Só sai quando o veículo de tração é de terceiro e tem proprietário
    // declarado. Do contrário: rejeição 745.
    tipo_transporte: veiculo?.propriedade === "terceiro" && veiculo?.proprietarioDocumento
      ? (veiculo.tipoTransportador || documento.tipoTransportador || undefined)
      : undefined,
    data_emissao: dataEmissaoSefaz(documento.dataEmissao || new Date()),

    cnpj_emitente: somenteDigitos(empresa.cnpj),
    inscricao_estadual_emitente: empresa.ie || undefined,
    nome_emitente: empresa.razaoSocial,
    nome_fantasia_emitente: empresa.nomeFantasia || undefined,
    logradouro_emitente: empresa.endereco?.logradouro,
    numero_emitente: empresa.endereco?.numero,
    complemento_emitente: empresa.endereco?.complemento || undefined,
    bairro_emitente: empresa.endereco?.bairro,
    codigo_municipio_emitente: empresa.endereco?.codigoIbgeCidade || undefined,
    municipio_emitente: empresa.endereco?.cidade,
    cep_emitente: somenteDigitos(empresa.endereco?.cep),
    uf_emitente: ufEmpresa,
    telefone_emitente: somenteDigitos(empresa.telefone),
    email_emitente: empresa.email || undefined,

    uf_inicio: ufInicio,
    uf_fim: ufFim,
    percursos: percursoIntermediario.map((uf) => ({ uf_percurso: uf })),

    municipios_carregamento: documento.codigoMunicipioCarregamento
      ? [{ codigo: Number(documento.codigoMunicipioCarregamento), nome: documento.municipioCarregamento }]
      : undefined,

    // Os documentos vão DENTRO do município de descarregamento — é assim
    // que o MDF-e se organiza: cada município de entrega lista o que será
    // descarregado nele.
    municipios_descarregamento: documento.codigoMunicipioDescarregamento
      ? [{
          codigo: Number(documento.codigoMunicipioDescarregamento),
          nome: documento.municipioDescarregamento,
          conhecimentos_transporte: ctes.length
            ? ctes.map((d) => ({ chave_cte: somenteDigitos(d.chaveAcesso) }))
            : undefined,
          notas_fiscais: nfes.length
            ? nfes.map((d) => ({ chave_nfe: somenteDigitos(d.chaveAcesso) }))
            : undefined,
        }]
      : undefined,

    quantidade_total_cte: ctes.length || undefined,
    quantidade_total_nfe: nfes.length || undefined,

    // Carga lotação: manifesto com um único documento. Nesse caso a SEFAZ
    // exige saber o ponto exato onde a carga foi pega e onde será
    // entregue — o município não basta (rejeição 726). Usamos o CEP do
    // remetente e do destinatário do CT-e.
    ...(cargaLotacao ? {
      cep_carregamento: somenteDigitos(cepCarregamento),
      cep_descarregamento: somenteDigitos(cepDescarregamento),
    } : {}),

    // Totalizadores da carga.
    valor_total_carga: dec(documento.valorTotalCarga),
    codigo_unidade_medida_peso_bruto: documento.unidadeMedidaPeso || "01",
    peso_bruto: dec(documento.pesoBrutoCarga, 4),
    tipo_carga: documento.tipoCarga || undefined,
    descricao_produto: documento.produtoPredominante || undefined,
    // NCM só é exigido na carga lotação, mas mandar sempre não atrapalha.
    codigo_ncm_produto: somenteDigitos(documento.ncmProdutoPredominante) || undefined,

    // Seguro da carga — obrigatório no rodoviário depois da Lei 11.442/07.
    seguros_carga: documento.seguroNomeSeguradora
      ? [
          {
            responsavel_seguro: documento.seguroResponsavel || "1",
            cnpj_responsavel:
              (documento.seguroResponsavel || "1") === "1" ? somenteDigitos(empresa.cnpj) : undefined,
            nome_seguradora: documento.seguroNomeSeguradora,
            cnpj_seguradora: somenteDigitos(documento.seguroCnpjSeguradora),
            numero_apolice: documento.seguroNumeroApolice || undefined,
            numero_averbacao: documento.seguroNumeroAverbacao || undefined,
          },
        ]
      : undefined,

    // Modal rodoviário: o nome do grupo é modal_rodoviario, e os dados do
    // veículo de tração são campos planos aqui dentro (não um objeto
    // separado). Reboques e condutores são coleções.
    modal_rodoviario: {
      registro_nacional_transporte: somenteDigitos(empresa.rntrc),
      contratantes: contratantesDosCtes(ctes),
      pagamentos: pagamentosDosCtes(ctes, empresa),
      ciot: documento.ciot
        ? [{ ciot: somenteDigitos(documento.ciot), cnpj_responsavel: somenteDigitos(empresa.cnpj) }]
        : undefined,

      placa_veiculo: veiculo?.placa?.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      renavam_veiculo: somenteDigitos(veiculo?.renavam),
      tara_veiculo: veiculo?.taraKg ? Math.round(veiculo.taraKg) : undefined,
      capacidade_kg_veiculo: veiculo?.capacidadeKg ? Math.round(veiculo.capacidadeKg) : undefined,
      capacidade_m3_veiculo: veiculo?.capacidadeM3 ? Math.round(veiculo.capacidadeM3) : undefined,
      tipo_rodado_veiculo: codigoDe(TIPO_RODADO_MDFE, veiculo?.tipoRodado, "06"),
      tipo_carroceria_veiculo: codigoDe(TIPO_CARROCERIA_MDFE, veiculo?.tipoCarroceria, "00"),
      uf_licenciamento_veiculo: veiculo?.ufLicenciamento || veiculo?.uf || ufEmpresa,
      // Os campos do proprietário levam o sufixo "_veiculo" no grupo de
      // tração; nos reboques, não.
      ...proprietarioDoVeiculo(veiculo, "veiculo"),

      condutores: nomeMotorista
        ? [{ nome: nomeMotorista, cpf: somenteDigitos(cpfMotorista) }]
        : undefined,

      veiculos_reboque: listaReboques.length
        ? listaReboques.map((r) => ({
            placa: r.placa?.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
            renavam: somenteDigitos(r.renavam),
            tara: r.taraKg ? Math.round(r.taraKg) : undefined,
            capacidade_kg: r.capacidadeKg ? Math.round(r.capacidadeKg) : undefined,
            capacidade_m3: r.capacidadeM3 ? Math.round(r.capacidadeM3) : undefined,
            tipo_carroceria: codigoDe(TIPO_CARROCERIA_MDFE, r.tipoCarroceria, "00"),
            uf_licenciamento: r.ufLicenciamento || r.uf || ufEmpresa,
            ...proprietarioDoVeiculo(r),
          }))
        : undefined,
    },

    informacao_complementar: documento.informacoesComplementares || undefined,
  };
}


// Conferência do MDFe antes do envio, no mesmo espírito da do CT-e.
function validarPayloadMdfe(payload) {
  const problemas = [];

  if (!payload.uf_inicio || !payload.uf_fim) {
    problemas.push("UF de início e de fim do percurso não informadas.");
  }
  if (!payload.municipios_carregamento?.length) {
    problemas.push("Município de carregamento não informado (precisa do código IBGE).");
  }
  if (!payload.municipios_descarregamento?.length) {
    problemas.push("Município de descarregamento não informado (precisa do código IBGE).");
  }

  // Os documentos ficam dentro de cada município de descarregamento.
  const ctes = (payload.municipios_descarregamento || []).flatMap((m) => m.conhecimentos_transporte || []);
  const nfes = (payload.municipios_descarregamento || []).flatMap((m) => m.notas_fiscais || []);

  if (!ctes.length && !nfes.length) {
    problemas.push("Nenhum CT-e ou NF-e vinculado ao manifesto.");
  }
  for (const cte of ctes) {
    if (!/^\d{44}$/.test(cte.chave_cte || "")) {
      problemas.push(`Chave de CT-e inválida: ${cte.chave_cte || "vazia"}`);
    }
  }
  for (const nfe of nfes) {
    if (!/^\d{44}$/.test(nfe.chave_nfe || "")) {
      problemas.push(`Chave de NF-e inválida: ${nfe.chave_nfe || "vazia"}`);
    }
  }
  if (!payload.valor_total_carga) {
    problemas.push("Valor total da carga não informado.");
  }
  if (!payload.peso_bruto) {
    problemas.push("Peso bruto da carga não informado.");
  }
  const modal = payload.modal_rodoviario || {};
  if (!/^\d{8}$/.test(modal.registro_nacional_transporte || "")) {
    problemas.push("RNTRC não preenchido (8 dígitos) no cadastro da empresa emitente.");
  }
  if (!modal.placa_veiculo) problemas.push("Veículo de tração sem placa.");
  // Tara e UF de licenciamento são obrigatórias no XML; sem elas a SEFAZ
  // rejeita e a mensagem que volta é pouco clara.
  if (!modal.tara_veiculo) problemas.push("Tara do veículo não preenchida no cadastro de veículos.");
  if (!modal.uf_licenciamento_veiculo) problemas.push("UF de licenciamento do veículo não informada.");
  // Carga lotação: sem os CEPs, a SEFAZ recusa com a rejeição 726.
  const umDocumentoSo = (payload.quantidade_total_cte || 0) + (payload.quantidade_total_nfe || 0) === 1;
  if (umDocumentoSo && !payload.codigo_ncm_produto) {
    problemas.push(
      "Manifesto de carga lotação exige o NCM do produto predominante. " +
      "Confira se o produto está cadastrado com NCM em Produtos."
    );
  }
  if (umDocumentoSo && (!payload.cep_carregamento || !payload.cep_descarregamento)) {
    problemas.push(
      "Manifesto com um documento só (carga lotação) exige o CEP de carregamento e de descarregamento. " +
      "Preencha o CEP no cadastro do remetente e do destinatário do CT-e."
    );
  }
  if (!modal.contratantes?.length) {
    problemas.push("Contratante do serviço não identificado. Confira o tomador dos CT-es vinculados.");
  }
  const pagamentoSemBanco = (modal.pagamentos || []).some((p) => !p.numero_banco || !p.numero_agencia);
  if (umDocumentoSo && pagamentoSemBanco) {
    problemas.push(
      "O grupo de pagamento do MDF-e exige banco e agência de recebimento. " +
      "Preencha em Configurações, no cadastro da empresa."
    );
  }
  if (umDocumentoSo && !modal.pagamentos?.length) {
    problemas.push(
      "Manifesto de carga lotação exige as informações de pagamento do frete. " +
      "Confira se o CT-e vinculado tem tomador e valor da prestação."
    );
  }
  if (!modal.condutores?.length) {
    problemas.push("Condutor não informado (nome e CPF).");
  } else if (!/^\d{11}$/.test(modal.condutores[0].cpf || "")) {
    problemas.push("CPF do condutor inválido.");
  }
  for (const reboque of modal.veiculos_reboque || []) {
    if (!reboque.tara) problemas.push(`Tara não preenchida no cadastro do reboque ${reboque.placa || ""}.`);
  }
  if (!payload.seguros_carga?.length) {
    problemas.push(
      "Seguro da carga não informado — obrigatório no modal rodoviário (seguradora, CNPJ e apólice)."
    );
  }
  // O percurso lista só as UFs intermediárias.
  if ((payload.percursos || []).some((p) => p.uf_percurso === payload.uf_inicio || p.uf_percurso === payload.uf_fim)) {
    problemas.push("O percurso deve conter apenas as UFs intermediárias, sem repetir a de início e a de fim.");
  }

  return problemas;
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
async function enviarPorEmail({ tipo, ref, emails }) {
  const { data } = await client.post(`/v2/${ENDPOINT_POR_TIPO[tipo]}/${ref}/email`, { emails });
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
async function emitirCartaCorrecao({ tipo, ref, texto }) {
  const { data } = await client.post(`/v2/${ENDPOINT_POR_TIPO[tipo]}/${ref}/carta_correcao`, { correcao: texto });
  return data;
}

// Encerramento do MDF-e. Não é opcional: enquanto um manifesto não for
// encerrado, a SEFAZ recusa o próximo da mesma placa ("Existe MDF-e não
// encerrado para esta placa"). Deve ser feito quando a carga chega ao
// destino, informando onde e quando terminou a viagem.
async function encerrarMdfe({ ref, data, sigla_uf, nome_municipio }) {
  // O caminho é /encerrar (não /encerramento), e a SEFAZ quer o NOME do
  // município, não o código IBGE.
  const resposta = await client.post(`/v2/mdfe/${ref}/encerrar`, {
    data,
    sigla_uf,
    nome_municipio,
  });
  return resposta.data;
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
  validarPayloadCte,
  validarPayloadMdfe,
  encerrarMdfe,
  urlCompleta,
  enviarPorEmail,
  cancelar,
  emitirCartaCorrecao,
  montarPayloadMdfe,
  emitir,
  consultar,
};

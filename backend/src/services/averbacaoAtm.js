/* ===========================================================================
   Averbação do seguro de carga na AT&M (a averbadora da AKAD).

   A averbação não passa pela Focus nem pela SEFAZ: o XML autorizado do CT-e
   vai para o webservice SOAP da AT&M, que devolve o protocolo e o número da
   averbação. É esse número que vai no seguro do MDF-e (infSeg/nAver). Era o
   que o Quinto Eixo fazia sozinho a cada CT-e autorizado.

   Cancelar o CT-e na SEFAZ não cancela a averbação: o XML do cancelamento
   precisa ir para a mesma operação (averbaCTe), que entende pelo conteúdo.

   Credenciais só no Render, nunca no banco nem no código:
     ATM_USUARIO_<CNPJ>, ATM_SENHA_<CNPJ>, ATM_CODIGO_<CNPJ>  (por empresa)
     ATM_USUARIO, ATM_SENHA, ATM_CODIGO                      (padrão)
   Sem elas, a averbação simplesmente não acontece.

   Formato do serviço (WS 2.0), o mesmo que bibliotecas abertas usam
   (nfephp-org/sped-averbacao): POST SOAP com SOAPAction
   "urn:ATMWebSvr#averbaCTe" e o corpo <averbaCTe><usuario/><senha/>
   <codatm/><xmlCTe><![CDATA[...]]></xmlCTe></averbaCTe>.
   =========================================================================== */

const URL_PRODUCAO = "https://webserver.averba.com.br/20/index.soap";
const URL_HOMOLOGACAO = "https://homologaws.averba.com.br/20/index.soap";

const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const limpar = (v) => String(v || "").trim();
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function credenciais(cnpj) {
  const d = soDigitos(cnpj);
  const ler = (nome) => limpar((d && process.env[`${nome}_${d}`]) || process.env[nome]);
  const usuario = ler("ATM_USUARIO");
  const senha = ler("ATM_SENHA");
  const codigo = ler("ATM_CODIGO");
  return usuario && senha && codigo ? { usuario, senha, codigo } : null;
}

const configurada = (cnpj) => Boolean(credenciais(cnpj));

// Texto entre <tag> e </tag>, com ou sem prefixo de namespace.
function tag(xml, nome) {
  const m = new RegExp(`<(?:\\w+:)?${nome}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(xml);
  return m ? m[1].trim() : null;
}

const desescapar = (t) => String(t || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Lê a resposta da AT&M: averbado (protocolo, número, data) ou os erros.
 * A resposta às vezes vem com o XML interno escapado; desescapa antes.
 */
function lerResposta(corpo) {
  const xml = /&lt;\w/.test(corpo) ? desescapar(corpo) : corpo;
  const averbado = tag(xml, "Averbado");
  const erros = [...xml.matchAll(/<(?:\w+:)?Erro\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Erro>/g)]
    .map((m) => [tag(m[1], "Codigo"), tag(m[1], "Descricao")].filter(Boolean).join(" - "))
    .filter(Boolean);
  const falhaSoap = tag(xml, "faultstring");
  if (averbado) {
    return {
      ok: true,
      protocolo: tag(averbado, "Protocolo"),
      numero: tag(averbado, "NumeroAverbacao"),
      data: tag(averbado, "dhAverbacao"),
    };
  }
  return { ok: false, mensagem: erros.join(" | ") || falhaSoap || "A AT&M não confirmou a averbação" };
}

/**
 * Envia um XML (CT-e autorizado ou o cancelamento dele) para a AT&M.
 * ambiente: "producao" ou "homologacao" (o mesmo do CT-e: XML de
 * homologação averbado em produção volta como TESTE e não vale).
 */
async function averbarXmlCte({ xml, cnpj, ambiente }) {
  const cred = credenciais(cnpj);
  if (!cred) return { ok: false, semConfiguracao: true, mensagem: "Averbação AT&M não configurada para esta empresa" };

  const corpo = '<?xml version="1.0" encoding="utf-8"?>'
    + '<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
    + ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"'
    + ' xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ATMWebSvr">'
    + "<soapenv:Body><averbaCTe>"
    // Senha com & ou < quebraria o envelope: escapa.
    + `<usuario>${esc(cred.usuario)}</usuario><senha>${esc(cred.senha)}</senha><codatm>${esc(cred.codigo)}</codatm>`
    // CDATA: o XML vai inteiro, sem escapar; "]]>" dentro dele quebraria o bloco.
    + `<xmlCTe><![CDATA[${String(xml).replace(/]]>/g, "]]]]><![CDATA[>")}]]></xmlCTe>`
    + "</averbaCTe></soapenv:Body></soapenv:Envelope>";

  // ATM_URL troca o endereço sem nova versão, se a AT&M mudar o dela.
  const url = limpar(process.env.ATM_URL) || (ambiente === "homologacao" ? URL_HOMOLOGACAO : URL_PRODUCAO);
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml;charset=UTF-8", SOAPAction: "urn:ATMWebSvr#averbaCTe" },
    body: corpo,
    signal: AbortSignal.timeout(30000),
  });
  const texto = await resposta.text();
  const lido = lerResposta(texto);
  if (!lido.ok && !resposta.ok) lido.mensagem = `HTTP ${resposta.status}: ${lido.mensagem}`;
  return lido;
}

module.exports = { averbarXmlCte, configurada, lerResposta };

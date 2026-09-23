const nodemailer = require("nodemailer");

/* ===========================================================================
   Envio de e-mail pelo SMTP do domínio.

   Duas regras aqui:
   - E-mail nunca atrapalha a operação. Se o servidor de e-mail estiver fora,
     a batida já está gravada e o envio apenas falha em silêncio no log. Ponto
     não pode depender de SMTP.
   - Sem configuração, o módulo fica desligado em vez de quebrar. Assim o
     sistema roda igual em quem não usa e-mail.
   =========================================================================== */

let transportador = null;
let avisouFaltaConfig = false;

function configurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USUARIO && process.env.SMTP_SENHA);
}

function obterTransportador() {
  if (!configurado()) {
    if (!avisouFaltaConfig) {
      console.warn("[email] SMTP não configurado — envios desativados.");
      avisouFaltaConfig = true;
    }
    return null;
  }
  if (transportador) return transportador;

  const porta = Number(process.env.SMTP_PORTA || 587);
  transportador = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    // 465 é TLS direto; 587 começa em texto claro e sobe para TLS (STARTTLS).
    secure: porta === 465,
    auth: { user: process.env.SMTP_USUARIO, pass: process.env.SMTP_SENHA },
  });
  return transportador;
}

async function enviarEmail({ para, assunto, texto, html }) {
  const transporte = obterTransportador();
  if (!transporte || !para) return { enviado: false, motivo: "sem configuração ou sem destinatário" };

  try {
    const info = await transporte.sendMail({
      from: process.env.EMAIL_REMETENTE || process.env.SMTP_USUARIO,
      to: para,
      subject: assunto,
      text: texto,
      html,
    });
    return { enviado: true, id: info.messageId };
  } catch (erro) {
    console.error(`[email] falha ao enviar para ${para}: ${erro.message}`);
    return { enviado: false, motivo: erro.message, codigo: erro.code, resposta: erro.response };
  }
}

/**
 * Comprovante de registro de ponto (Portaria MTP 671/2021).
 * Os campos são os que a portaria pede no comprovante entregue ao
 * trabalhador: identificação do empregador e do trabalhador, local, NSR e o
 * momento da marcação.
 */
async function enviarComprovantePonto({ colaborador, marcacao, rep, empresa, fuso }) {
  if (!colaborador?.email) return { enviado: false, motivo: "colaborador sem e-mail" };

  const zona = fuso || process.env.TZ_FISCAL || "America/Cuiaba";
  const quando = new Date(marcacao.dataHora);
  const data = quando.toLocaleDateString("pt-BR", { timeZone: zona });
  const hora = quando.toLocaleTimeString("pt-BR", { timeZone: zona, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const linhas = [
    ["Empregador", empresa?.razaoSocial || "—"],
    ["CNPJ", empresa?.cnpj || "—"],
    ["Local de registro", [rep?.identificador, rep?.localizacao].filter(Boolean).join(" · ") || "—"],
    ["Trabalhador", colaborador.nome],
    ["CPF", colaborador.cpf],
    ["Data", data],
    ["Hora", hora],
    ["NSR", String(marcacao.nsr)],
  ];

  const texto = [
    "COMPROVANTE DE REGISTRO DE PONTO",
    "",
    ...linhas.map(([r, v]) => `${r}: ${v}`),
    "",
    "Guarde este comprovante. Ele confirma o registro feito no horário acima.",
    "Se algo estiver diferente do que você registrou, procure o setor responsável.",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color:#23231F; max-width:520px;">
      <h2 style="color:#1F3B57; font-size:17px; margin:0 0 4px;">Comprovante de registro de ponto</h2>
      <p style="color:#6B6B68; font-size:13px; margin:0 0 16px;">Portaria MTP 671/2021</p>
      <table style="border-collapse:collapse; width:100%; font-size:14px;">
        ${linhas.map(([r, v]) => `
          <tr>
            <td style="padding:7px 0; color:#6B6B68; width:170px;">${r}</td>
            <td style="padding:7px 0; font-weight:600;">${v}</td>
          </tr>`).join("")}
      </table>
      <p style="font-size:12.5px; color:#6B6B68; margin-top:18px; line-height:1.5;">
        Guarde este comprovante. Ele confirma o registro feito no horário acima.
        Se algo estiver diferente do que você registrou, procure o setor responsável.
      </p>
    </div>`;

  return enviarEmail({
    para: colaborador.email,
    assunto: `Registro de ponto · ${data} ${hora}`,
    texto,
    html,
  });
}

/**
 * Conta o que está configurado, sem revelar a senha. Serve para a tela de
 * diagnóstico responder "o servidor tem as variáveis?" antes de investigar
 * qualquer outra coisa.
 */
function situacao() {
  const mascarar = (v) => (v ? `${String(v).slice(0, 3)}***${String(v).slice(-8)}` : null);
  return {
    configurado: configurado(),
    host: process.env.SMTP_HOST || null,
    porta: Number(process.env.SMTP_PORTA || 587),
    usuario: mascarar(process.env.SMTP_USUARIO),
    remetente: process.env.EMAIL_REMETENTE || process.env.SMTP_USUARIO || null,
    comprovanteLigado: process.env.EMAIL_COMPROVANTE_PONTO !== "false",
  };
}

/**
 * Conversa com o servidor de e-mail sem enviar nada. Separa os dois tipos de
 * problema: credencial e conexão de um lado, endereço e entrega do outro.
 */
async function verificarConexao() {
  const transporte = obterTransportador();
  if (!transporte) return { ok: false, erro: "SMTP não configurado no servidor" };
  try {
    await transporte.verify();
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: erro.message, codigo: erro.code, resposta: erro.response };
  }
}

module.exports = { enviarEmail, enviarComprovantePonto, configurado, situacao, verificarConexao };

const webpush = require("web-push");

const prisma = require("./prisma");

/* ---------------------------------------------------------------------------
   Notificações push.

   As chaves VAPID identificam o servidor perante o serviço de push do
   navegador. São geradas uma vez (scripts/gerar-vapid.js) e guardadas nas
   variáveis de ambiente — trocá-las invalida todas as inscrições.
--------------------------------------------------------------------------- */

// Espaço e quebra de linha colados no valor ao copiar do terminal são o
// erro mais comum aqui, e deixam a chave inválida sem dizer por quê.
const limpar = (valor) => String(valor || "").trim().replace(/\s/g, "");

const CHAVE_PUBLICA = limpar(process.env.VAPID_PUBLIC_KEY);
const CHAVE_PRIVADA = limpar(process.env.VAPID_PRIVATE_KEY);

// O contato precisa ser uma URL: e-mail puro tem que vir com mailto:.
const contatoInformado = String(process.env.VAPID_CONTATO || "").trim();
const CONTATO = contatoInformado && !/^(mailto:|https?:)/i.test(contatoInformado)
  ? `mailto:${contatoInformado}`
  : (contatoInformado || "mailto:contato@bionorte.com.br");

// A chave pública, decodificada, tem exatamente 65 bytes. Conferir aqui
// evita o erro aparecer só no celular, na hora de ativar.
function chavePublicaValida(chave) {
  try {
    return Buffer.from(chave, "base64url").length === 65;
  } catch {
    return false;
  }
}

let configurado = false;

if (CHAVE_PUBLICA && CHAVE_PRIVADA) {
  if (!chavePublicaValida(CHAVE_PUBLICA)) {
    console.error(
      `[push] VAPID_PUBLIC_KEY inválida (${CHAVE_PUBLICA.length} caracteres; ` +
      "a correta tem 87 e decodifica para 65 bytes). Notificações desligadas."
    );
  } else {
    try {
      webpush.setVapidDetails(CONTATO, CHAVE_PUBLICA, CHAVE_PRIVADA);
      configurado = true;
    } catch (erro) {
      // Configuração errada desliga as notificações e nada mais: derrubar o
      // servidor por causa disso deixaria o ERP inteiro fora do ar.
      console.error("[push] configuração inválida, notificações desligadas:", erro.message);
    }
  }
}

/**
 * Envia para todos os aparelhos de um usuário. Inscrição recusada pelo
 * serviço de push (aparelho trocado, app desinstalado) é removida: manter
 * inscrição morta faria toda rodada de lembrete falhar em silêncio.
 */
async function enviarPush(usuarioId, { titulo, corpo, url, tag }) {
  if (!configurado || !usuarioId) return { enviados: 0, removidos: 0 };

  const inscricoes = await prisma.inscricaoPush.findMany({ where: { usuarioId } });
  let enviados = 0;
  let removidos = 0;

  for (const inscricao of inscricoes) {
    try {
      await webpush.sendNotification(
        {
          endpoint: inscricao.endpoint,
          keys: { p256dh: inscricao.p256dh, auth: inscricao.auth },
        },
        JSON.stringify({ titulo, corpo, url, tag })
      );
      enviados++;
      await prisma.inscricaoPush.update({
        where: { id: inscricao.id },
        data: { ultimoEnvio: new Date() },
      });
    } catch (erro) {
      // 404 e 410 significam inscrição morta.
      if (erro.statusCode === 404 || erro.statusCode === 410) {
        await prisma.inscricaoPush.delete({ where: { id: inscricao.id } });
        removidos++;
      } else {
        console.error("[push] falha ao enviar:", erro.statusCode, erro.body || erro.message);
      }
    }
  }

  return { enviados, removidos };
}

// Um colaborador pode ter login — é por ele que a notificação chega.
async function enviarPushParaColaborador(colaboradorId, mensagem) {
  if (!colaboradorId) return { enviados: 0 };
  const usuario = await prisma.usuario.findFirst({
    where: { colaboradorId: Number(colaboradorId) },
    select: { id: true },
  });
  if (!usuario) return { enviados: 0 };
  return enviarPush(usuario.id, mensagem);
}

module.exports = {
  enviarPush,
  enviarPushParaColaborador,
  // Funções em vez de valores: o estado é decidido na subida do servidor.
  get configurado() { return configurado; },
  get chavePublica() { return configurado ? CHAVE_PUBLICA : null; },
};

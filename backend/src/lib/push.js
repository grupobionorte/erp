const webpush = require("web-push");

const prisma = require("./prisma");

/* ---------------------------------------------------------------------------
   Notificações push.

   As chaves VAPID identificam o servidor perante o serviço de push do
   navegador. São geradas uma vez (scripts/gerar-vapid.js) e guardadas nas
   variáveis de ambiente — trocá-las invalida todas as inscrições.
--------------------------------------------------------------------------- */

const configurado = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

if (configurado) {
  webpush.setVapidDetails(
    process.env.VAPID_CONTATO || "mailto:contato@bionorte.com.br",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
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

module.exports = { enviarPush, enviarPushParaColaborador, configurado };

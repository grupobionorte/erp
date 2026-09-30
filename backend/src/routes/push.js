const express = require("express");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const push = require("../lib/push");
const { enviarPush } = push;

const router = express.Router();

/* ---------------------------------------------------------------------------
   Notificações push: inscrição dos aparelhos e disparo dos lembretes.
--------------------------------------------------------------------------- */

// A chave pública é pedida pelo navegador antes de se inscrever. Não é
// segredo — a privada é que fica só no servidor.
router.get("/chave", (req, res) => {
  // A chave vai já limpa: espaço colado no valor do ambiente fazia o
  // navegador recusar com "P-256 public key inválida".
  res.json({ chave: push.chavePublica, configurado: push.configurado });
});

router.post("/inscrever", asyncHandler(async (req, res) => {
  const { endpoint, keys, aparelho } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ erro: "Inscrição inválida" });
  }

  // O mesmo aparelho reinscrevendo atualiza o registro em vez de duplicar.
  const inscricao = await prisma.inscricaoPush.upsert({
    where: { endpoint },
    create: {
      endpoint, p256dh: keys.p256dh, auth: keys.auth,
      aparelho: aparelho || undefined,
      usuarioId: req.usuario.id,
    },
    update: { p256dh: keys.p256dh, auth: keys.auth, usuarioId: req.usuario.id },
  });

  res.status(201).json({ id: inscricao.id });
}));

router.delete("/inscricao", asyncHandler(async (req, res) => {
  if (req.body?.endpoint) {
    await prisma.inscricaoPush.deleteMany({ where: { endpoint: req.body.endpoint } });
  }
  res.status(204).send();
}));

router.get("/situacao", asyncHandler(async (req, res) => {
  res.json({
    configurado: push.configurado,
    aparelhos: await prisma.inscricaoPush.count({ where: { usuarioId: req.usuario.id } }),
  });
}));

router.post("/teste", asyncHandler(async (req, res) => {
  const resultado = await enviarPush(req.usuario.id, {
    titulo: "Notificação de teste",
    corpo: "Se você está lendo isso, os lembretes da agenda vão funcionar.",
    url: "/agenda.html",
    tag: "teste",
  });
  res.json(resultado);
}));

module.exports = router;

const express = require("express");
const bcrypt = require("bcryptjs");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const { exigirAdmin } = require("../middleware/auth");
const { contarBase, zerarBase } = require("../lib/zerarBase");

const router = express.Router();

/* ---------------------------------------------------------------------------
   Manutenção da base.

   Existe porque o plano gratuito do Render não dá acesso ao terminal, e
   sem isso não haveria como limpar os dados de teste antes de entrar em
   produção.

   Três travas, porque é a operação mais destrutiva do sistema:
     1. Só administrador.
     2. Precisa da senha do próprio usuário.
     3. Bloqueada quando a emissão está em produção — documento fiscal
        autorizado precisa ser guardado por cinco anos.
--------------------------------------------------------------------------- */

router.get("/base", exigirAdmin, asyncHandler(async (req, res) => {
  res.json(await contarBase());
}));

router.post("/base/zerar", exigirAdmin, asyncHandler(async (req, res) => {
  const { senha, confirmacao } = req.body;

  if (confirmacao !== "ZERAR") {
    return res.status(400).json({
      erro: "Confirmação inválida",
      detalhe: 'Digite ZERAR, em maiúsculas, para confirmar.',
    });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
  if (!usuario || !(await bcrypt.compare(String(senha || ""), usuario.senhaHash))) {
    return res.status(401).json({ erro: "Senha incorreta" });
  }

  const antes = await contarBase();

  try {
    await zerarBase();
  } catch (erro) {
    return res.status(erro.status || 500).json({
      erro: erro.message,
      detalhe: erro.status === 403
        ? "Com a emissão em produção, os documentos autorizados têm valor fiscal e não podem ser apagados."
        : undefined,
    });
  }

  console.log(`[manutenção] base zerada por ${usuario.email} (${antes.total} registros)`);
  res.json({ zerado: true, registrosRemovidos: antes.total });
}));

module.exports = router;

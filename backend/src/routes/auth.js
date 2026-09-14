const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { autenticar } = require("../middleware/auth");

const router = express.Router();

function gerarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, papel: usuario.papel, nome: usuario.nome },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

// Cria um usuário. O primeiro usuário do sistema vira admin automaticamente
// e não precisa de token (é o "bootstrap" — sem isso ninguém conseguiria
// criar o primeiro login). A partir do segundo usuário, só um admin logado
// pode cadastrar novas pessoas.
router.post("/registrar", async (req, res) => {
  const { nome, email, senha, papel } = req.body;
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: "nome, email e senha são obrigatórios" });
  }
  if (senha.length < 8) {
    return res.status(400).json({ erro: "senha precisa ter pelo menos 8 caracteres" });
  }

  const totalUsuarios = await prisma.usuario.count();

  if (totalUsuarios > 0) {
    // Não é o primeiro usuário — exige token de admin válido.
    const cabecalho = req.headers.authorization;
    const token = cabecalho?.startsWith("Bearer ") ? cabecalho.slice(7) : null;
    if (!token) return res.status(401).json({ erro: "Necessário estar logado como admin para criar usuários" });

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.papel !== "admin") {
        return res.status(403).json({ erro: "Só um admin pode criar novos usuários" });
      }
    } catch {
      return res.status(401).json({ erro: "Token inválido ou expirado" });
    }
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const usuario = await prisma.usuario.create({
    data: {
      nome,
      email,
      senhaHash,
      papel: totalUsuarios === 0 ? "admin" : papel === "admin" ? "admin" : "operador",
    },
  });

  res.status(201).json({ id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel });
});

router.post("/login", async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ erro: "email e senha são obrigatórios" });
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario || !usuario.ativo) {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }

  const senhaConfere = await bcrypt.compare(senha, usuario.senhaHash);
  if (!senhaConfere) {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }

  res.json({
    token: gerarToken(usuario),
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
  });
});

// Usado pelo frontend pra saber se o token salvo ainda é válido ao abrir a tela.
router.get("/me", autenticar, async (req, res) => {
  res.json(req.usuario);
});

module.exports = router;

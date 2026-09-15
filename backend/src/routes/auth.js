const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { autenticar } = require("../middleware/auth");

const router = express.Router();

function gerarToken(usuario, empresaId) {
  return jwt.sign(
    { sub: usuario.id, papel: usuario.papel, nome: usuario.nome, empresaId: empresaId ?? null },
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

// Lista pública (sem login) das empresas ativas, só com o essencial —
// é o que preenche o seletor de empresa na própria tela de login, antes
// de existir qualquer token.
router.get("/empresas", async (req, res) => {
  const empresas = await prisma.empresa.findMany({
    where: { ativo: true },
    select: { id: true, razaoSocial: true },
    orderBy: { razaoSocial: "asc" },
  });
  res.json(empresas);
});

router.post("/login", async (req, res) => {
  const { email, senha, empresaId } = req.body;
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

  // Só exige escolher uma empresa se já existir alguma cadastrada — assim
  // o primeiro admin consegue logar antes de cadastrar a primeira empresa
  // em Configurações.
  const totalEmpresas = await prisma.empresa.count({ where: { ativo: true } });
  let empresa = null;

  if (totalEmpresas > 0) {
    if (!empresaId) {
      return res.status(400).json({ erro: "Selecione uma empresa para continuar" });
    }
    empresa = await prisma.empresa.findFirst({
      where: { id: Number(empresaId), ativo: true },
      select: { id: true, razaoSocial: true },
    });
    if (!empresa) {
      return res.status(400).json({ erro: "Empresa inválida" });
    }
  }

  res.json({
    token: gerarToken(usuario, empresa?.id),
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
    empresa,
  });
});

// Usado pelo frontend pra saber se o token salvo ainda é válido ao abrir a
// tela — devolve também a empresa em uso, pra sobreviver a um F5.
router.get("/me", autenticar, async (req, res) => {
  let empresa = null;
  if (req.usuario.empresaId) {
    empresa = await prisma.empresa.findUnique({
      where: { id: req.usuario.empresaId },
      select: { id: true, razaoSocial: true },
    });
  }
  res.json({ ...req.usuario, empresa });
});

module.exports = router;

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { autenticar } = require("../middleware/auth");

const asyncHandler = require("../lib/asyncHandler");
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
//
// empresaIds: quais empresas esse usuário pode acessar ao logar. Só tem
// efeito prático pra quem é "operador" — um "admin" acessa todas as
// empresas ativas automaticamente, então a lista é ignorada nesse caso.
router.post("/registrar", asyncHandler(async (req, res) => {
  const { nome, email, senha, papel, empresaIds, colaboradorId } = req.body;
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

  // Um colaborador só pode ter um login. Sem isso o erro voltaria como
  // violação de índice único, sem dizer de quem é o vínculo.
  if (colaboradorId) {
    const jaVinculado = await prisma.usuario.findUnique({
      where: { colaboradorId: Number(colaboradorId) },
      select: { nome: true },
    });
    if (jaVinculado) {
      return res.status(409).json({
        erro: "Esse colaborador já está vinculado a outro usuário",
        detalhe: `Vinculado a ${jaVinculado.nome}.`,
      });
    }
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const usuario = await prisma.usuario.create({
    data: {
      nome,
      email,
      senhaHash,
      papel: totalUsuarios === 0 ? "admin" : papel === "admin" ? "admin" : "operador",
      empresas: empresaIds?.length ? { connect: empresaIds.map((id) => ({ id: Number(id) })) } : undefined,
      // Liga o login à ficha de colaborador, quando informada.
      colaborador: colaboradorId ? { connect: { id: Number(colaboradorId) } } : undefined,
    },
    include: {
      empresas: { select: { id: true, razaoSocial: true, logoUrl: true } },
      colaborador: { select: { id: true, nome: true, cargo: true, setor: true } },
    },
  });

  res.status(201).json({
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    empresas: usuario.empresas,
    colaboradorId: usuario.colaboradorId,
    colaborador: usuario.colaborador,
  });
}));

// Login em duas etapas:
//  1. { email, senha } — se o usuário só tiver acesso a 0 ou 1 empresa
//     (ou nenhuma empresa existir ainda), já devolve o token de uma vez.
//     Se tiver acesso a mais de uma, devolve { requerEmpresa: true, empresas }
//     em vez de token, e o frontend pede pra escolher.
//  2. { email, senha, empresaId } — reenvia com a empresa escolhida (tem
//     que ser uma das que esse usuário realmente pode acessar).
// Pública — usada na tela de login pra mostrar a logo da empresa lembrada
// (localStorage) antes mesmo de logar. Só devolve a logo, nada sensível.
router.get("/empresas/:id/logo", asyncHandler(async (req, res) => {
  const empresa = await prisma.empresa.findFirst({
    where: { id: Number(req.params.id), ativo: true },
    select: { logoUrl: true },
  });
  res.json({ logoUrl: empresa?.logoUrl || null });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const { email, senha, empresaId } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ erro: "email e senha são obrigatórios" });
  }

  const usuario = await prisma.usuario.findUnique({
    where: { email },
    include: { empresas: { where: { ativo: true }, select: { id: true, razaoSocial: true, logoUrl: true } } },
  });
  if (!usuario || !usuario.ativo) {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }

  const senhaConfere = await bcrypt.compare(senha, usuario.senhaHash);
  if (!senhaConfere) {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }

  const totalEmpresas = await prisma.empresa.count({ where: { ativo: true } });

  // Ninguém cadastrou nenhuma empresa ainda — deixa logar sem empresa (é
  // o que permite o primeiro admin acessar Configurações e criar a
  // primeira empresa).
  if (totalEmpresas === 0) {
    return res.json({
      token: gerarToken(usuario, null),
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel, colaboradorId: usuario.colaboradorId ?? null },
      empresa: null,
    });
  }

  // Admin enxerga todas as empresas ativas automaticamente, mesmo sem
  // estar explicitamente vinculado a elas.
  const empresasPermitidas = usuario.papel === "admin"
    ? await prisma.empresa.findMany({ where: { ativo: true }, select: { id: true, razaoSocial: true, logoUrl: true }, orderBy: { razaoSocial: "asc" } })
    : usuario.empresas;

  if (empresasPermitidas.length === 0) {
    return res.status(403).json({ erro: "Seu usuário não tem acesso a nenhuma empresa. Peça para um admin liberar o acesso." });
  }

  // Só uma opção — loga direto nela, sem precisar perguntar.
  if (empresasPermitidas.length === 1 && !empresaId) {
    const unica = empresasPermitidas[0];
    return res.json({
      token: gerarToken(usuario, unica.id),
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel, colaboradorId: usuario.colaboradorId ?? null },
      empresa: unica,
    });
  }

  // Mais de uma opção e ainda não escolheu — devolve a lista pro frontend
  // mostrar o seletor, sem emitir token ainda.
  if (!empresaId) {
    return res.json({ requerEmpresa: true, empresas: empresasPermitidas });
  }

  const empresaEscolhida = empresasPermitidas.find((e) => e.id === Number(empresaId));
  if (!empresaEscolhida) {
    return res.status(400).json({ erro: "Você não tem acesso a essa empresa" });
  }

  res.json({
    token: gerarToken(usuario, empresaEscolhida.id),
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel, colaboradorId: usuario.colaboradorId ?? null },
    empresa: empresaEscolhida,
  });
}));

// Usado pelo frontend pra saber se o token salvo ainda é válido ao abrir a
// tela — devolve também a empresa em uso, pra sobreviver a um F5.
router.get("/me", autenticar, asyncHandler(async (req, res) => {
  let empresa = null;
  if (req.usuario.empresaId) {
    empresa = await prisma.empresa.findUnique({
      where: { id: req.usuario.empresaId },
      select: { id: true, razaoSocial: true, logoUrl: true },
    });
  }
  // O colaborador vinculado vem junto: é ele que os documentos usam como
  // responsável, preenchido a partir de quem está logado.
  const dados = await prisma.usuario.findUnique({
    where: { id: req.usuario.id },
    select: { colaboradorId: true, colaborador: { select: { id: true, nome: true } } },
  });

  res.json({ ...req.usuario, ...dados, empresa });
}));

module.exports = router;

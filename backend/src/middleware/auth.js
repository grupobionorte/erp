const jwt = require("jsonwebtoken");

// Protege qualquer rota em que for aplicado: exige um header
// "Authorization: Bearer <token>" válido, gerado em /auth/login.
function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization;
  const token = cabecalho?.startsWith("Bearer ") ? cabecalho.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erro: "Token de autenticação ausente" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = { id: payload.sub, papel: payload.papel, nome: payload.nome, empresaId: payload.empresaId ?? null };
    next();
  } catch {
    return res.status(401).json({ erro: "Token inválido ou expirado" });
  }
}

// Usa depois de autenticar — bloqueia operadores de ações restritas a admin
// (ex.: excluir cadastros, criar novos usuários).
function exigirAdmin(req, res, next) {
  if (req.usuario?.papel !== "admin") {
    return res.status(403).json({ erro: "Ação restrita a administradores" });
  }
  next();
}

module.exports = { autenticar, exigirAdmin };

/* ---------------------------------------------------------------------------
   Permissões de menu.

   A lista de menus vive aqui, no servidor, e não só na tela. Esconder o
   botão no navegador organiza a vida de quem usa, mas não impede ninguém de
   chamar a rota direto — a trava precisa existir dos dois lados.
--------------------------------------------------------------------------- */

// Cada menu e os caminhos de API que ele usa.
const MENUS = {
  dashboard: { rotulo: "Visão geral", rotas: [] },
  agenda: { rotulo: "Agenda", rotas: ["/agenda"] },
  clientes: { rotulo: "Clientes", rotas: [] },
  fornecedores: { rotulo: "Fornecedores", rotas: [] },
  produtos: { rotulo: "Produtos", rotas: ["/produtos"] },
  transportadoras: { rotulo: "Transportadoras", rotas: ["/transportadoras"] },
  veiculos: { rotulo: "Veículos", rotas: ["/veiculos"] },
  motoristas: { rotulo: "Motoristas", rotas: ["/motoristas"] },
  colaboradores: { rotulo: "Colaboradores", rotas: ["/colaboradores"] },
  operacoes: { rotulo: "Operações", rotas: ["/operacoes"] },
  notasFiscais: { rotulo: "Vendas / NF-e", rotas: [] },
  cte: { rotulo: "CT-e", rotas: [] },
  emissao: { rotulo: "MDF-e", rotas: [] },
  manutencao: { rotulo: "Manutenção", rotas: ["/manutencao/equipamentos", "/manutencao/ordens"] },
  contasPagar: { rotulo: "Contas a pagar", rotas: ["/contas-pagar"] },
  ponto: { rotulo: "Ponto", rotas: ["/ponto"] },
  empresas: { rotulo: "Configurações", rotas: ["/empresas"] },
  usuarios: { rotulo: "Usuários", rotas: ["/usuarios"] },
};

// Clientes e fornecedores dividem a rota /pessoas, e os três documentos
// fiscais dividem /documentos-fiscais. Nesses casos, basta ter um dos
// menus para a rota liberar — separar por tipo de documento exigiria
// inspecionar o corpo de cada requisição, e o ganho não compensa.
const ROTAS_COMPARTILHADAS = [
  { prefixo: "/pessoas", menus: ["clientes", "fornecedores"] },
  { prefixo: "/documentos-fiscais", menus: ["notasFiscais", "cte", "emissao"] },
  { prefixo: "/relatorios", menus: ["notasFiscais", "cte", "emissao"] },
  { prefixo: "/cfops", menus: ["notasFiscais", "cte", "produtos"] },
  { prefixo: "/ncms", menus: ["notasFiscais", "produtos"] },
  { prefixo: "/municipios", menus: ["notasFiscais", "cte", "emissao"] },
];

// Rotas que todo usuário autenticado usa, independentemente do menu.
const SEMPRE_LIBERADAS = ["/auth", "/push", "/manutencao/ambiente"];

function menuDaRota(caminho) {
  for (const compartilhada of ROTAS_COMPARTILHADAS) {
    if (caminho.startsWith(compartilhada.prefixo)) return compartilhada.menus;
  }

  // Do mais específico para o mais genérico: /manutencao/equipamentos antes
  // de /manutencao, senão o primeiro venceria sempre.
  const candidatos = Object.entries(MENUS)
    .flatMap(([chave, cfg]) => cfg.rotas.map((rota) => ({ chave, rota })))
    .sort((a, b) => b.rota.length - a.rota.length);

  const achado = candidatos.find(({ rota }) => caminho.startsWith(rota));
  return achado ? [achado.chave] : null;
}

/**
 * Bloqueia o que o usuário não tem liberado.
 *
 * Admin passa por tudo — é quem configura as permissões, e trancá-lo fora
 * de alguma tela criaria o problema de ninguém conseguir destravar.
 */
function exigirPermissaoDeMenu(req, res, next) {
  const usuario = req.usuario;
  if (!usuario || usuario.papel === "admin") return next();

  const permissoes = usuario.permissoes || [];
  // Lista vazia é "tudo liberado": usuário antigo, antes de a trava existir.
  if (!permissoes.length) return next();

  const caminho = req.baseUrl + req.path;
  if (SEMPRE_LIBERADAS.some((rota) => caminho.startsWith(rota))) return next();

  const menus = menuDaRota(caminho);
  if (!menus) return next();

  if (menus.some((menu) => permissoes.includes(menu))) return next();

  return res.status(403).json({
    erro: "Seu usuário não tem acesso a essa parte do sistema",
    detalhe: "Peça a um administrador para liberar em Usuários.",
  });
}

module.exports = { MENUS, exigirPermissaoDeMenu };

const prisma = require("./prisma");

/* ---------------------------------------------------------------------------
   Diesel: o saldo de cada tanque não é gravado em lugar nenhum. Ele sai da
   soma dos movimentos (entradas + ajustes - saídas), e por isso nunca fica
   diferente do histórico que o explica.
--------------------------------------------------------------------------- */

const arredondar = (v, casas = 2) => {
  const f = 10 ** casas;
  return Math.round((Number(v) || 0) * f) / f;
};

// Litros com sinal: o que o movimento faz com o saldo do tanque.
const efeito = (m) => (m.tipo === "saida" ? -m.litros : m.litros);

/**
 * Saldo e custo médio de cada tanque da empresa. O custo médio é o das
 * compras registradas com valor (total pago / litros comprados): é o que
 * transforma litros abastecidos em custo, na operação e por máquina.
 */
async function situacaoDosTanques(empresaId, { incluirInativos = false, tanqueIds } = {}) {
  const tanques = await prisma.tanqueDiesel.findMany({
    where: {
      empresaId,
      ...(incluirInativos ? {} : { ativo: true }),
      ...(tanqueIds ? { id: { in: tanqueIds } } : {}),
    },
    orderBy: { nome: "asc" },
  });
  if (!tanques.length) return [];
  const movimentos = await prisma.movimentoDiesel.findMany({
    where: { tanqueId: { in: tanques.map((t) => t.id) } },
    select: { tanqueId: true, tipo: true, litros: true, valorTotal: true },
  });
  return tanques.map((t) => {
    const deste = movimentos.filter((m) => m.tanqueId === t.id);
    const compras = deste.filter((m) => m.tipo === "entrada" && m.valorTotal != null && m.litros > 0);
    const litrosComprados = compras.reduce((s, m) => s + m.litros, 0);
    const pago = compras.reduce((s, m) => s + m.valorTotal, 0);
    return {
      ...t,
      saldo: arredondar(deste.reduce((s, m) => s + efeito(m), 0)),
      custoMedio: litrosComprados ? arredondar(pago / litrosComprados, 4) : null,
    };
  });
}

module.exports = { arredondar, efeito, situacaoDosTanques };

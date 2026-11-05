// Soma meses preservando o fim do mês: vencimento dia 31 em fevereiro cai
// no último dia, não no dia 3 de março.
function somarMeses(data, meses) {
  const d = new Date(data);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimoDia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimoDia));
  return d;
}

// Divide o total em parcelas iguais. A sobra de centavos vai na primeira,
// para a soma fechar com o valor total.
function dividirEmParcelas(total, vezes) {
  const parcela = Math.floor((total / vezes) * 100) / 100;
  const sobra = Number((total - parcela * vezes).toFixed(2));
  return Array.from({ length: vezes }, (_, i) => Number((parcela + (i === 0 ? sobra : 0)).toFixed(2)));
}

module.exports = { somarMeses, dividirEmParcelas };

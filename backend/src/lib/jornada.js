/* ===========================================================================
   Apuração de jornada.

   Duas decisões que moldam tudo aqui:

   1. Escala com revezamento não cabe em "dia da semana". Numa 6x1 a folga
      anda: cai na segunda, depois no domingo, depois no sábado. Por isso o
      dia de trabalho é calculado por posição no ciclo, contada a partir de
      uma data de referência — e não por uma tabela de segunda a domingo.

   2. Todo cálculo acontece no fuso da operação, não no do servidor. O Render
      roda em UTC; uma batida às 22h de Mato Grosso cairia no dia seguinte se
      alguém confiasse no relógio do servidor, e o dia de trabalho inteiro
      sairia errado.
   =========================================================================== */

const FUSO_PADRAO = process.env.TZ_FISCAL || "America/Cuiaba";

// Partes de data/hora de um instante, já no fuso da operação.
function partesNoFuso(data, timeZone = FUSO_PADRAO) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(data).map((x) => [x.type, x.value])
  );
  return {
    dia: `${p.year}-${p.month}-${p.day}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
    hora: `${p.hour}:${p.minute}`,
  };
}

const paraMinutos = (hhmm) => {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const paraHora = (minutos) => {
  if (minutos === null || minutos === undefined) return null;
  const sinal = minutos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutos));
  return `${sinal}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

// Percorre os dias do período no fuso da operação, sem depender do relógio
// do servidor.
function diasDoPeriodo(de, ate) {
  const dias = [];
  const atual = new Date(`${de}T12:00:00Z`);   // meio-dia evita virada de fuso
  const fim = new Date(`${ate}T12:00:00Z`);
  while (atual <= fim) {
    dias.push(atual.toISOString().slice(0, 10));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return dias;
}

const diaDaSemana = (dia) => new Date(`${dia}T12:00:00Z`).getUTCDay();   // 0 = domingo

/**
 * O que estava previsto para aquele dia, segundo a jornada vigente.
 * Devolve null quando não há jornada cadastrada — nesse caso o espelho
 * mostra as batidas sem cobrar nada, que é o comportamento honesto.
 */
function previstoNoDia(jornada, dia) {
  if (!jornada) return null;

  const dentroDaVigencia =
    (!jornada.vigenciaInicio || dia >= String(jornada.vigenciaInicio).slice(0, 10)) &&
    (!jornada.vigenciaFim || dia <= String(jornada.vigenciaFim).slice(0, 10));
  if (!dentroDaVigencia) return null;

  if (jornada.tipo === "escala") {
    const referencia = String(jornada.dataReferencia || jornada.vigenciaInicio || dia).slice(0, 10);
    const diasTrabalho = jornada.diasTrabalho || 6;
    const cicloDias = diasTrabalho + (jornada.diasFolga || 1);
    const passados = Math.round(
      (new Date(`${dia}T12:00:00Z`) - new Date(`${referencia}T12:00:00Z`)) / 86400000
    );

    // Numa 6x1 o ciclo fecha em 7 dias, o mesmo tamanho da semana — então a
    // folga cairia sempre no mesmo dia. O revezamento é justamente o
    // contrário disso: a cada ciclo completo a folga anda alguns dias.
    // deslocamentoPorCiclo = 0 mantém a folga fixa no dia da semana.
    const deslocamento = jornada.deslocamentoPorCiclo || 0;
    const ciclosCompletos = Math.floor(passados / cicloDias);
    const bruto = (passados % cicloDias) - deslocamento * ciclosCompletos;
    // Resto sempre positivo: datas anteriores à referência também caem certo.
    const posicao = ((bruto % cicloDias) + cicloDias) % cicloDias;
    const trabalha = posicao < diasTrabalho;

    if (!trabalha) return { folga: true, minutos: 0, posicaoCiclo: posicao + 1, cicloDias };
    return {
      folga: false,
      posicaoCiclo: posicao + 1,
      cicloDias,
      entrada: jornada.entrada,
      intervaloInicio: jornada.intervaloInicio,
      intervaloFim: jornada.intervaloFim,
      saida: jornada.saida,
      minutos: minutosPrevistos(jornada),
    };
  }

  // Jornada fixa por dia da semana.
  const config = (jornada.dias || []).find((d) => d.diaSemana === diaDaSemana(dia));
  if (!config || config.folga) return { folga: true, minutos: 0 };
  return {
    folga: false,
    entrada: config.entrada,
    intervaloInicio: config.intervaloInicio,
    intervaloFim: config.intervaloFim,
    saida: config.saida,
    minutos: minutosPrevistos(config),
  };
}

function minutosPrevistos(config) {
  const entrada = paraMinutos(config.entrada);
  const saida = paraMinutos(config.saida);
  if (entrada === null || saida === null) return 0;
  // Turno que vira o dia (entra 22h, sai 6h) conta as horas até a virada.
  let total = saida >= entrada ? saida - entrada : 24 * 60 - entrada + saida;
  const ini = paraMinutos(config.intervaloInicio);
  const fim = paraMinutos(config.intervaloFim);
  if (ini !== null && fim !== null && fim > ini) total -= fim - ini;
  return total;
}

/**
 * Apura um dia: casa as batidas em pares e compara com o previsto.
 */
function apurarDia({ dia, batidas, previsto, toleranciaMinutos = 10 }) {
  const marcacoes = batidas
    .map((b) => ({ ...b, ...partesNoFuso(new Date(b.dataHora)) }))
    .sort((a, b) => a.minutos - b.minutos);

  // Batidas em número ímpar significam registro faltando (esqueceu a saída,
  // por exemplo). Não inventamos o par que falta: marcamos como inconsistente
  // para o RH resolver com um tratamento.
  const inconsistente = marcacoes.length % 2 !== 0;

  let trabalhado = 0;
  for (let i = 0; i + 1 < marcacoes.length; i += 2) {
    trabalhado += marcacoes[i + 1].minutos - marcacoes[i].minutos;
  }

  let intervalo = null;
  if (marcacoes.length >= 4) intervalo = marcacoes[2].minutos - marcacoes[1].minutos;

  const previstoMin = previsto && !previsto.folga ? previsto.minutos : 0;
  const diferenca = trabalhado - previstoMin;

  // Tolerância legal: variações pequenas não viram crédito nem débito.
  const dentroDaTolerancia = Math.abs(diferenca) <= toleranciaMinutos;

  const situacoes = [];
  if (previsto?.folga) {
    if (trabalhado > 0) situacoes.push("trabalho em folga");
  } else if (previsto) {
    if (!marcacoes.length) situacoes.push("falta");
    else {
      const entradaPrevista = paraMinutos(previsto.entrada);
      if (entradaPrevista !== null && marcacoes[0].minutos > entradaPrevista + toleranciaMinutos) {
        situacoes.push("atraso");
      }
      if (!dentroDaTolerancia && diferenca > 0) situacoes.push("hora extra");
      if (!dentroDaTolerancia && diferenca < 0) situacoes.push("saldo negativo");
      // Intervalo menor que uma hora em jornada acima de 6h é irregular
      // (CLT art. 71) — vale sinalizar, não corrigir sozinho.
      if (previstoMin > 360 && intervalo !== null && intervalo < 60) {
        situacoes.push("intervalo abaixo de 1h");
      }
    }
  }
  if (inconsistente) situacoes.push("batida faltando");

  return {
    dia,
    diaSemana: diaDaSemana(dia),
    folga: Boolean(previsto?.folga),
    posicaoCiclo: previsto?.posicaoCiclo,
    previstoMinutos: previstoMin,
    previstoTexto: previsto && !previsto.folga
      ? [previsto.entrada, previsto.intervaloInicio, previsto.intervaloFim, previsto.saida].filter(Boolean).join(" · ")
      : null,
    batidas: marcacoes.map((m) => ({
      id: m.id, nsr: m.nsr, hora: m.hora,
      metodo: m.metodoIdentificacao, offline: m.origemOffline,
      temTratamento: Boolean(m.tratamentos?.length),
    })),
    trabalhadoMinutos: trabalhado,
    trabalhadoTexto: paraHora(trabalhado),
    intervaloMinutos: intervalo,
    diferencaMinutos: dentroDaTolerancia ? 0 : diferenca,
    diferencaTexto: paraHora(dentroDaTolerancia ? 0 : diferenca),
    inconsistente,
    situacoes,
  };
}

/**
 * Espelho do período: um registro por dia, mais os totais.
 */
function apurarPeriodo({ de, ate, marcacoes, jornada, toleranciaMinutos }) {
  const tolerancia = toleranciaMinutos ?? jornada?.toleranciaMinutos ?? 10;

  // Agrupa as batidas pelo dia no fuso da operação.
  const porDia = {};
  for (const m of marcacoes) {
    const { dia } = partesNoFuso(new Date(m.dataHora));
    (porDia[dia] = porDia[dia] || []).push(m);
  }

  const dias = diasDoPeriodo(de, ate).map((dia) =>
    apurarDia({
      dia,
      batidas: porDia[dia] || [],
      previsto: previstoNoDia(jornada, dia),
      toleranciaMinutos: tolerancia,
    })
  );

  const somar = (campo) => dias.reduce((t, d) => t + (d[campo] || 0), 0);
  const trabalhado = somar("trabalhadoMinutos");
  const previsto = somar("previstoMinutos");

  return {
    de, ate, tolerancia,
    temJornada: Boolean(jornada),
    dias,
    totais: {
      trabalhadoMinutos: trabalhado,
      trabalhadoTexto: paraHora(trabalhado),
      previstoMinutos: previsto,
      previstoTexto: paraHora(previsto),
      saldoMinutos: somar("diferencaMinutos"),
      saldoTexto: paraHora(somar("diferencaMinutos")),
      extrasMinutos: dias.reduce((t, d) => t + Math.max(0, d.diferencaMinutos), 0),
      devidasMinutos: dias.reduce((t, d) => t + Math.max(0, -d.diferencaMinutos), 0),
      diasTrabalhados: dias.filter((d) => d.trabalhadoMinutos > 0).length,
      faltas: dias.filter((d) => d.situacoes.includes("falta")).length,
      atrasos: dias.filter((d) => d.situacoes.includes("atraso")).length,
      inconsistencias: dias.filter((d) => d.inconsistente).length,
    },
  };
}

module.exports = {
  FUSO_PADRAO, partesNoFuso, paraMinutos, paraHora,
  previstoNoDia, minutosPrevistos, apurarDia, apurarPeriodo, diasDoPeriodo,
};

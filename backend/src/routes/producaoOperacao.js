const express = require("express");
const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const { intervaloNoFuso } = require("../lib/fuso");
const { arredondar, situacaoDosTanques } = require("../lib/diesel");

/* ---------------------------------------------------------------------------
   Boletim diário de produção da operação: uma linha por máquina, por dia e
   turno. Digita-se horímetro (ou hodômetro), produção, paradas e diesel; o
   trabalhado é conta. O abastecimento vira saída do tanque e o horímetro
   final vira a leitura do equipamento, que a Manutenção usa para os planos.
   Montado em /operacoes, junto da rota da operação.
--------------------------------------------------------------------------- */

const router = express.Router();

const dataDoDia = (valor) =>
  valor && /^\d{4}-\d{2}-\d{2}/.test(String(valor)) ? new Date(`${String(valor).slice(0, 10)}T12:00:00-04:00`) : null;
const diaDe = (d) => new Date(d).toISOString().slice(0, 10); // meio-dia -04: o dia não muda
const diaBr = (d) => diaDe(d).split("-").reverse().join("/");
const texto = (v) => String(v || "").trim() || null;
const numero = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const br = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const TIPOS_SERVICO = ["corte", "enleiramento", "tracamento", "arraste", "picagem", "transporte"];
const UNIDADES = ["m3", "kg", "ha", "alq"];
const MOTIVOS_PARADA = ["chuva", "manutencao", "abastecimento", "sem_frente", "outro"];

const incluirLinha = {
  equipamento: { select: { id: true, codigo: true, nome: true, controle: true } },
  colaborador: { select: { id: true, nome: true } },
  diesel: { select: { id: true, litros: true, tanqueId: true, tanque: { select: { nome: true } } } },
};

async function operacaoDaEmpresa(id, req) {
  return prisma.operacao.findFirst({
    where: { id: Number(id), empresaId: req.usuario.empresaId || undefined },
  });
}

// Unidade em que o serviço é medido nesta operação; sem ela no cadastro, m³.
const unidadeDoServico = (operacao, servico) =>
  (operacao.servicos || []).find((s) => s.tipo === servico)?.unidade || "m3";

/**
 * O horímetro final passa a ser a leitura do equipamento quando é a maior
 * registrada. Se a leitura atual veio de uma linha que foi corrigida ou
 * excluída, volta para a maior que sobrou: um dígito a mais digitado errado
 * não pode deixar o horímetro da máquina adiantado para sempre.
 */
async function sincronizarLeitura(tx, equipamentoId, finalAntigo) {
  const equipamento = await tx.equipamento.findUnique({ where: { id: equipamentoId } });
  if (!equipamento || !["horimetro", "hodometro"].includes(equipamento.controle)) return;
  const maior = (await tx.producaoOperacao.aggregate({
    where: { equipamentoId, leituraFinal: { not: null } },
    _max: { leituraFinal: true },
  }))._max.leituraFinal;
  const atual = equipamento.leituraAtual;
  const veioDaLinhaMudada = finalAntigo != null && atual != null && Math.abs(atual - finalAntigo) < 0.001;
  let nova = null;
  if (maior != null && (atual == null || maior > atual)) nova = maior;
  else if (veioDaLinhaMudada && maior != null && maior !== atual) nova = maior;
  if (nova != null) {
    await tx.equipamento.update({ where: { id: equipamentoId }, data: { leituraAtual: nova, leituraAtualizada: new Date() } });
  }
}

// ------------------------------------------------------------------ apoio

// Tudo o que o lançamento precisa escolher, num pedido só: as máquinas que
// passaram pela operação (com a última leitura, para sugerir o inicial),
// os operadores, os serviços da operação e os tanques com saldo.
router.get("/:id/producao/apoio", asyncHandler(async (req, res) => {
  const operacao = await operacaoDaEmpresa(req.params.id, req);
  if (!operacao) return res.status(404).json({ erro: "Operação não encontrada" });
  const [alocacoes, colaboradores, tanques] = await Promise.all([
    prisma.operacaoEquipamento.findMany({
      where: { operacaoId: operacao.id },
      include: { equipamento: { select: { id: true, codigo: true, nome: true, controle: true, leituraAtual: true, ativo: true } } },
      orderBy: [{ dataSaida: { sort: "desc", nulls: "first" } }],
    }),
    // Demitido continua na lista, marcado: lançamento antigo com ele não
    // pode perder o operador ao ser editado.
    prisma.colaborador.findMany({
      where: { empresaId: req.usuario.empresaId || undefined, ativo: true },
      select: { id: true, nome: true, situacao: true },
      orderBy: [{ situacao: "asc" }, { nome: "asc" }],
    }),
    situacaoDosTanques(req.usuario.empresaId),
  ]);
  const vistos = new Set();
  const equipamentos = alocacoes
    .filter((a) => !vistos.has(a.equipamentoId) && vistos.add(a.equipamentoId))
    .map((a) => ({ ...a.equipamento, naOperacao: !a.dataSaida }));
  const servicos = (operacao.servicos || []).length
    ? operacao.servicos.map((s) => ({ tipo: s.tipo, unidade: s.unidade || "m3" }))
    : TIPOS_SERVICO.map((tipo) => ({ tipo, unidade: "m3" }));
  res.json({ equipamentos, colaboradores, servicos, tanques: tanques.map(({ id, nome, saldo }) => ({ id, nome, saldo })) });
}));

// -------------------------------------------------------------- listagem

router.get("/:id/producao", asyncHandler(async (req, res) => {
  const operacao = await operacaoDaEmpresa(req.params.id, req);
  if (!operacao) return res.status(404).json({ erro: "Operação não encontrada" });
  const { de, ate } = req.query;
  if (!de || !ate) return res.status(400).json({ erro: "Informe o período (de e ate)" });
  const { inicio, fim } = intervaloNoFuso(de, ate);

  const [linhas, acumulado, tanques] = await Promise.all([
    prisma.producaoOperacao.findMany({
      where: { operacaoId: operacao.id, data: { gte: inicio, lte: fim } },
      include: incluirLinha,
      orderBy: [{ data: "desc" }, { turno: "asc" }, { id: "asc" }],
    }),
    // Desde o início da operação, para comparar com a previsão do contrato.
    prisma.producaoOperacao.groupBy({
      by: ["servico", "unidade"],
      where: { operacaoId: operacao.id },
      _sum: { quantidade: true },
    }),
    situacaoDosTanques(req.usuario.empresaId, { incluirInativos: true }),
  ]);
  const custoDoTanque = Object.fromEntries(tanques.map((t) => [t.id, t.custoMedio]));

  // Por máquina e serviço: a mesma máquina pode fazer dois serviços, e
  // somar m³ de picagem com hectare de corte não faz sentido.
  const porMaquina = {};
  const porServico = {};
  let dieselLitros = 0;
  let dieselCusto = 0;
  let dieselSemCusto = false;
  for (const l of linhas) {
    const chave = `${l.equipamentoId}|${l.servico}`;
    const m = (porMaquina[chave] = porMaquina[chave] || {
      equipamento: l.equipamento, servico: l.servico, unidade: l.unidade,
      trabalhado: 0, quantidade: 0, horasParadas: 0, dieselLitros: 0, lancamentos: 0,
    });
    m.lancamentos += 1;
    m.trabalhado += l.trabalhado || 0;
    m.quantidade += l.quantidade || 0;
    m.horasParadas += l.horasParadas || 0;
    if (l.diesel) {
      m.dieselLitros += l.diesel.litros;
      dieselLitros += l.diesel.litros;
      const custo = custoDoTanque[l.diesel.tanqueId];
      if (custo == null) dieselSemCusto = true;
      else dieselCusto += l.diesel.litros * custo;
    }
    const s = (porServico[`${l.servico}|${l.unidade}`] = porServico[`${l.servico}|${l.unidade}`] || { servico: l.servico, unidade: l.unidade, quantidade: 0 });
    s.quantidade += l.quantidade || 0;
  }

  // Previsão do contrato na mesma unidade do serviço: m³ e hectare são os
  // que a operação guarda.
  const previsao = (unidade) => (unidade === "m3" ? operacao.previsaoM3 : unidade === "ha" ? operacao.hectaresContrato : null);
  const contrato = acumulado.map((a) => ({
    servico: a.servico, unidade: a.unidade,
    acumulado: arredondar(a._sum.quantidade || 0, 3),
    previsto: previsao(a.unidade) ?? null,
  }));

  res.json({
    linhas,
    resumo: {
      porMaquina: Object.values(porMaquina).map((m) => ({
        ...m,
        trabalhado: arredondar(m.trabalhado, 2),
        quantidade: arredondar(m.quantidade, 3),
        horasParadas: arredondar(m.horasParadas, 2),
        dieselLitros: arredondar(m.dieselLitros, 2),
        // Produtividade e consumo só para horímetro: por km não diz nada.
        porHora: m.equipamento.controle === "horimetro" && m.trabalhado > 0 ? arredondar(m.quantidade / m.trabalhado, 2) : null,
        litrosPorHora: m.equipamento.controle === "horimetro" && m.trabalhado > 0 && m.dieselLitros > 0
          ? arredondar(m.dieselLitros / m.trabalhado, 2) : null,
      })),
      porServico: Object.values(porServico).map((s) => ({ ...s, quantidade: arredondar(s.quantidade, 3) })),
      dieselLitros: arredondar(dieselLitros, 2),
      dieselCusto: arredondar(dieselCusto, 2),
      dieselSemCusto,
    },
    contrato,
  });
}));

// --------------------------------------------------------- gravar / apagar

/**
 * Confere o lançamento e devolve os dados prontos. A conta do trabalhado é
 * daqui: a tela mostra, mas não manda.
 */
async function validar(body, operacao, req, linhaAtual) {
  const data = dataDoDia(body.data);
  if (!data) return { erro: "Informe a data" };
  const turno = Number(body.turno) === 2 ? 2 : 1;
  const servico = TIPOS_SERVICO.includes(body.servico) ? body.servico : null;
  if (!servico) return { erro: "Escolha o serviço" };

  const equipamento = await prisma.equipamento.findFirst({
    where: { id: Number(body.equipamentoId), empresaId: req.usuario.empresaId || undefined },
  });
  if (!equipamento) return { erro: "Escolha a máquina" };

  let colaboradorId = null;
  if (body.colaboradorId) {
    const c = await prisma.colaborador.findFirst({
      where: { id: Number(body.colaboradorId), empresaId: req.usuario.empresaId || undefined },
    });
    if (!c) return { erro: "Operador não encontrado" };
    colaboradorId = c.id;
  }

  const leituraInicial = numero(body.leituraInicial);
  const leituraFinal = numero(body.leituraFinal);
  let trabalhado = null;
  const medeLeitura = ["horimetro", "hodometro"].includes(equipamento.controle);
  const nomeLeitura = equipamento.controle === "hodometro" ? "hodômetro" : "horímetro";
  if (medeLeitura && (leituraInicial !== null || leituraFinal !== null)) {
    if (leituraInicial === null || leituraFinal === null) return { erro: `Informe o ${nomeLeitura} inicial e o final` };
    if (!(leituraInicial >= 0) || !(leituraFinal >= 0)) return { erro: `${nomeLeitura} inválido` };
    if (leituraFinal < leituraInicial) return { erro: `O ${nomeLeitura} final é menor que o inicial` };
    trabalhado = arredondar(leituraFinal - leituraInicial, 2);
    // Num turno não cabem mais de 24 horas: é quase sempre um dígito a mais.
    if (equipamento.controle === "horimetro" && trabalhado > 24) {
      return { erro: `Deu ${br(trabalhado)} horas num turno. Confira o horímetro inicial e o final.` };
    }
  }

  const quantidade = numero(body.quantidade);
  if (quantidade !== null && !(quantidade >= 0)) return { erro: "Produção inválida" };
  const horasParadas = numero(body.horasParadas);
  if (horasParadas !== null && !(horasParadas >= 0 && horasParadas <= 24)) return { erro: "Horas paradas inválidas" };
  const motivoParada = MOTIVOS_PARADA.includes(body.motivoParada) ? body.motivoParada : null;
  if (horasParadas > 0 && !motivoParada) return { erro: "Diga o motivo da parada" };

  const litros = numero(body.dieselLitros);
  let tanque = null;
  if (litros !== null && litros !== 0) {
    if (!(litros > 0)) return { erro: "Litros de diesel inválidos" };
    tanque = await prisma.tanqueDiesel.findFirst({
      where: { id: Number(body.tanqueId), empresaId: req.usuario.empresaId, ativo: true },
    });
    if (!tanque) return { erro: "Escolha de qual tanque saiu o diesel" };
  }

  // Mesma máquina, mesmo dia e turno: já lançado (em qualquer operação).
  const repetida = await prisma.producaoOperacao.findFirst({
    where: { equipamentoId: equipamento.id, data, turno, ...(linhaAtual ? { id: { not: linhaAtual.id } } : {}) },
    include: { operacao: { select: { codigo: true } } },
  });
  if (repetida) {
    return { erro: `${equipamento.nome} já tem lançamento em ${diaBr(data)}, ${turno}º turno (operação ${repetida.operacao.codigo})`, status: 409 };
  }

  // Continuidade do horímetro: o inicial de hoje não pode ser menor que o
  // final do lançamento anterior da mesma máquina, nem o final passar do
  // inicial do seguinte. Diferença para mais é normal (a máquina rodou sem
  // boletim); para menos, quase sempre é digitação. Pode ser troca de
  // horímetro: aí a pessoa confirma.
  if (trabalhado !== null && !body.confirmarLeitura) {
    const outra = { equipamentoId: equipamento.id, ...(linhaAtual ? { id: { not: linhaAtual.id } } : {}) };
    const [anterior, seguinte] = await Promise.all([
      prisma.producaoOperacao.findFirst({
        where: { ...outra, leituraFinal: { not: null }, OR: [{ data: { lt: data } }, { data, turno: { lt: turno } }] },
        orderBy: [{ data: "desc" }, { turno: "desc" }],
      }),
      prisma.producaoOperacao.findFirst({
        where: { ...outra, leituraInicial: { not: null }, OR: [{ data: { gt: data } }, { data, turno: { gt: turno } }] },
        orderBy: [{ data: "asc" }, { turno: "asc" }],
      }),
    ]);
    if (anterior && leituraInicial < anterior.leituraFinal - 0.001) {
      return {
        confirmar: `O ${nomeLeitura} final de ${equipamento.nome} em ${diaBr(anterior.data)} (${anterior.turno}º turno) foi ${br(anterior.leituraFinal)}, e o inicial deste lançamento é ${br(leituraInicial)}, menor. Foi troca de ${nomeLeitura}?`,
      };
    }
    if (seguinte && leituraFinal > seguinte.leituraInicial + 0.001) {
      return {
        confirmar: `O ${nomeLeitura} inicial de ${equipamento.nome} em ${diaBr(seguinte.data)} (${seguinte.turno}º turno) foi ${br(seguinte.leituraInicial)}, e o final deste lançamento é ${br(leituraFinal)}, maior. Foi troca de ${nomeLeitura}?`,
      };
    }
  }

  return {
    dados: {
      data, turno, servico,
      unidade: UNIDADES.includes(unidadeDoServico(operacao, servico)) ? unidadeDoServico(operacao, servico) : "m3",
      equipamentoId: equipamento.id,
      colaboradorId,
      leituraInicial: medeLeitura ? leituraInicial : null,
      leituraFinal: medeLeitura ? leituraFinal : null,
      trabalhado,
      quantidade,
      horasParadas,
      motivoParada: horasParadas > 0 ? motivoParada : null,
      observacao: texto(body.observacao),
    },
    diesel: tanque ? { litros: arredondar(litros), tanqueId: tanque.id } : null,
  };
}

function responderValidacao(res, v) {
  if (v.confirmar) return res.status(409).json({ erro: "Confira o horímetro", confirmar: v.confirmar });
  return res.status(v.status || 400).json({ erro: v.erro });
}

// O abastecimento da linha, no mesmo passo: nasce, muda ou some com ela.
async function gravarDiesel(tx, linha, diesel, operacao, req) {
  const existente = await tx.movimentoDiesel.findUnique({ where: { producaoId: linha.id } });
  if (!diesel) {
    if (existente) await tx.movimentoDiesel.delete({ where: { id: existente.id } });
    return;
  }
  const dados = {
    tipo: "saida", data: linha.data, litros: diesel.litros, tanqueId: diesel.tanqueId,
    equipamentoId: linha.equipamentoId, operacaoId: operacao.id,
    observacao: `Boletim de produção — ${linha.turno}º turno`,
  };
  if (existente) await tx.movimentoDiesel.update({ where: { id: existente.id }, data: dados });
  else await tx.movimentoDiesel.create({ data: { ...dados, producaoId: linha.id, empresaId: req.usuario.empresaId, criadoPorId: req.usuario.id } });
}

router.post("/:id/producao", asyncHandler(async (req, res) => {
  const operacao = await operacaoDaEmpresa(req.params.id, req);
  if (!operacao) return res.status(404).json({ erro: "Operação não encontrada" });
  const v = await validar(req.body, operacao, req, null);
  if (!v.dados) return responderValidacao(res, v);
  const linha = await prisma.$transaction(async (tx) => {
    const criada = await tx.producaoOperacao.create({
      data: { ...v.dados, operacaoId: operacao.id, criadoPorId: req.usuario.id },
    });
    await gravarDiesel(tx, criada, v.diesel, operacao, req);
    await sincronizarLeitura(tx, criada.equipamentoId, null);
    return tx.producaoOperacao.findUnique({ where: { id: criada.id }, include: incluirLinha });
  });
  res.status(201).json(linha);
}));

async function linhaDaOperacao(req) {
  const operacao = await operacaoDaEmpresa(req.params.id, req);
  if (!operacao) return {};
  const linha = await prisma.producaoOperacao.findFirst({ where: { id: Number(req.params.linhaId), operacaoId: operacao.id } });
  return { operacao, linha };
}

router.put("/:id/producao/:linhaId", asyncHandler(async (req, res) => {
  const { operacao, linha } = await linhaDaOperacao(req);
  if (!linha) return res.status(404).json({ erro: "Lançamento não encontrado" });
  const v = await validar(req.body, operacao, req, linha);
  if (!v.dados) return responderValidacao(res, v);
  const atualizada = await prisma.$transaction(async (tx) => {
    const salva = await tx.producaoOperacao.update({ where: { id: linha.id }, data: v.dados });
    await gravarDiesel(tx, salva, v.diesel, operacao, req);
    await sincronizarLeitura(tx, salva.equipamentoId, linha.leituraFinal);
    // Trocou a máquina: a leitura da antiga também precisa ser refeita.
    if (linha.equipamentoId !== salva.equipamentoId) await sincronizarLeitura(tx, linha.equipamentoId, linha.leituraFinal);
    return tx.producaoOperacao.findUnique({ where: { id: salva.id }, include: incluirLinha });
  });
  res.json(atualizada);
}));

router.delete("/:id/producao/:linhaId", asyncHandler(async (req, res) => {
  const { linha } = await linhaDaOperacao(req);
  if (!linha) return res.status(404).json({ erro: "Lançamento não encontrado" });
  await prisma.$transaction(async (tx) => {
    // O abastecimento vai junto (cascata no banco).
    await tx.producaoOperacao.delete({ where: { id: linha.id } });
    await sincronizarLeitura(tx, linha.equipamentoId, linha.leituraFinal);
  });
  res.status(204).send();
}));

module.exports = router;

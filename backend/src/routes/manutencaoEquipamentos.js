const express = require("express");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");
const { hojeNoFuso } = require("../lib/fuso");

const router = express.Router();

/* ---------------------------------------------------------------------------
   Manutenção de equipamentos.

   O cálculo de "quando vence a próxima" fica aqui, e não na tela: é a mesma
   conta para a listagem, para o painel e para qualquer aviso que venha
   depois. Duas implementações divergiriam no primeiro ajuste.
--------------------------------------------------------------------------- */

const UNIDADE = { horimetro: "h", hodometro: "km", prazo: "meses" };

const incluirEquipamento = {
  planos: { where: { ativo: true }, orderBy: { descricao: "asc" } },
  veiculo: { select: { id: true, placa: true } },
};

/**
 * Situação de um plano: quanto falta para vencer, e se já passou.
 *
 * Em horímetro e hodômetro a conta é por leitura; em prazo, por data. Quando
 * o plano nunca foi executado, a base é a leitura atual ou a data de hoje —
 * o primeiro serviço passa a contar a partir de agora, em vez de aparecer
 * como vencido desde sempre.
 */
function situacaoDoPlano(plano, equipamento) {
  if (equipamento.controle !== "prazo") {
    const atual = Number(equipamento.leituraAtual) || 0;
    const base = plano.ultimaLeitura ?? atual;
    const proxima = base + Number(plano.intervalo);
    const falta = proxima - atual;

    return {
      tipo: "leitura",
      unidade: UNIDADE[equipamento.controle],
      proxima,
      falta,
      vencida: falta <= 0,
      proximo: falta > 0 && falta <= (plano.antecedencia ?? Number(plano.intervalo) * 0.1),
      // Sem leitura cadastrada não dá para dizer nada — e dizer "vencida"
      // seria pior do que admitir que falta informação.
      semLeitura: equipamento.leituraAtual == null,
    };
  }

  // Dias contados de meio-dia a meio-dia, a partir do dia de Cuiabá: com a
  // hora do servidor, o plano virava "vencido" no meio da noite.
  const hoje = new Date(`${hojeNoFuso()}T12:00:00Z`);
  const base = plano.ultimaData ? new Date(plano.ultimaData) : hoje;
  const proxima = new Date(base);
  proxima.setUTCMonth(proxima.getUTCMonth() + Number(plano.intervalo));
  const faltaDias = Math.round((proxima - hoje) / 86400000);

  return {
    tipo: "prazo",
    unidade: "dias",
    proximaData: proxima,
    falta: faltaDias,
    vencida: faltaDias <= 0,
    proximo: faltaDias > 0 && faltaDias <= (plano.antecedencia ?? 15),
    semLeitura: false,
  };
}

function comSituacao(equipamento) {
  const planos = (equipamento.planos || []).map((p) => ({ ...p, situacao: situacaoDoPlano(p, equipamento) }));
  return {
    ...equipamento,
    planos,
    alerta: planos.some((p) => p.situacao.vencida && !p.situacao.semLeitura)
      ? "vencida"
      : planos.some((p) => p.situacao.proximo) ? "proxima" : null,
  };
}

const prepararPlanos = (planos) =>
  (planos || [])
    .filter((p) => p.descricao && p.intervalo)
    .map((p) => ({
      descricao: String(p.descricao).trim(),
      intervalo: Number(p.intervalo),
      antecedencia: p.antecedencia ? Number(p.antecedencia) : undefined,
      ultimaLeitura: p.ultimaLeitura !== undefined && p.ultimaLeitura !== "" ? Number(p.ultimaLeitura) : undefined,
      ultimaData: p.ultimaData ? new Date(`${String(p.ultimaData).slice(0, 10)}T12:00:00Z`) : undefined,
    }));

// ---------------------------------------------------------------------------
// Equipamentos
// ---------------------------------------------------------------------------
router.get("/equipamentos", asyncHandler(async (req, res) => {
  const equipamentos = await prisma.equipamento.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ativo: req.query.inativos === "1" ? undefined : true,
    },
    include: incluirEquipamento,
    orderBy: { nome: "asc" },
  });

  const comAlerta = equipamentos.map(comSituacao);

  res.json({
    equipamentos: comAlerta,
    totais: {
      equipamentos: comAlerta.length,
      vencidas: comAlerta.filter((e) => e.alerta === "vencida").length,
      proximas: comAlerta.filter((e) => e.alerta === "proxima").length,
    },
  });
}));

router.post("/equipamentos", asyncHandler(async (req, res) => {
  const { nome, planos, veiculoId, leituraAtual, ...dados } = req.body;
  if (!nome) return res.status(400).json({ erro: "Informe o nome do equipamento" });

  const temLeitura = leituraAtual !== undefined && leituraAtual !== "" && leituraAtual !== null;

  const equipamento = await prisma.equipamento.create({
    data: {
      ...dados,
      nome,
      ano: dados.ano ? Number(dados.ano) : undefined,
      leituraAtual: temLeitura ? Number(leituraAtual) : undefined,
      leituraAtualizada: temLeitura ? new Date() : undefined,
      veiculoId: veiculoId ? Number(veiculoId) : undefined,
      empresaId: req.usuario.empresaId || undefined,
      planos: prepararPlanos(planos).length ? { create: prepararPlanos(planos) } : undefined,
    },
    include: incluirEquipamento,
  });

  res.status(201).json(comSituacao(equipamento));
}));

router.put("/equipamentos/:id", asyncHandler(async (req, res) => {
  const { planos, veiculoId, empresaId, leituraAtual, ...dados } = req.body;
  const id = Number(req.params.id);

  // Planos são substituídos por inteiro quando informados, como em outros
  // conjuntos do sistema: é mais previsível do que casar o que mudou.
  if (Array.isArray(planos)) {
    await prisma.planoManutencao.deleteMany({ where: { equipamentoId: id } });
  }

  const temLeitura = leituraAtual !== undefined && leituraAtual !== "" && leituraAtual !== null;

  const equipamento = await prisma.equipamento.update({
    where: { id },
    data: {
      ...dados,
      ano: dados.ano ? Number(dados.ano) : undefined,
      leituraAtual: temLeitura ? Number(leituraAtual) : undefined,
      leituraAtualizada: temLeitura ? new Date() : undefined,
      veiculoId: veiculoId === null || veiculoId === "" ? null : (veiculoId ? Number(veiculoId) : undefined),
      planos: Array.isArray(planos) && prepararPlanos(planos).length
        ? { create: prepararPlanos(planos) }
        : undefined,
    },
    include: incluirEquipamento,
  });

  res.json(comSituacao(equipamento));
}));

// Atualizar a leitura é a operação mais repetida: o horímetro anda todo dia.
router.post("/equipamentos/:id/leitura", asyncHandler(async (req, res) => {
  const leitura = Number(req.body?.leitura);
  if (!Number.isFinite(leitura)) return res.status(400).json({ erro: "Informe a leitura" });

  const equipamento = await prisma.equipamento.findUnique({ where: { id: Number(req.params.id) } });
  if (!equipamento) return res.status(404).json({ erro: "Equipamento não encontrado" });

  // Horímetro e hodômetro não voltam. Avisar é melhor do que gravar um
  // número que bagunça todos os cálculos de vencimento.
  if (equipamento.leituraAtual != null && leitura < equipamento.leituraAtual) {
    return res.status(409).json({
      erro: "A leitura informada é menor que a atual",
      detalhe: `O equipamento está em ${equipamento.leituraAtual}. Se o aparelho foi trocado ou zerado, ajuste pelo cadastro.`,
    });
  }

  const atualizado = await prisma.equipamento.update({
    where: { id: equipamento.id },
    data: { leituraAtual: leitura, leituraAtualizada: new Date() },
    include: incluirEquipamento,
  });

  res.json(comSituacao(atualizado));
}));

router.delete("/equipamentos/:id", asyncHandler(async (req, res) => {
  await prisma.equipamento.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Ordens de manutenção
// ---------------------------------------------------------------------------
const incluirOrdem = {
  equipamento: { select: { id: true, nome: true, controle: true } },
  plano: { select: { id: true, descricao: true } },
  responsavel: { select: { id: true, nome: true } },
};

router.get("/ordens", asyncHandler(async (req, res) => {
  const { equipamentoId, de, ate } = req.query;

  const ordens = await prisma.ordemManutencao.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ...(equipamentoId ? { equipamentoId: Number(equipamentoId) } : {}),
      ...(de || ate ? {
        data: {
          ...(de ? { gte: new Date(`${de}T00:00:00`) } : {}),
          ...(ate ? { lte: new Date(`${ate}T23:59:59`) } : {}),
        },
      } : {}),
    },
    include: incluirOrdem,
    orderBy: { data: "desc" },
    take: 300,
  });

  const custo = (o) => (Number(o.custoPecas) || 0) + (Number(o.custoServico) || 0);

  res.json({
    ordens,
    totais: {
      quantidade: ordens.length,
      custoTotal: ordens.reduce((t, o) => t + custo(o), 0),
      pecas: ordens.reduce((t, o) => t + (Number(o.custoPecas) || 0), 0),
      servico: ordens.reduce((t, o) => t + (Number(o.custoServico) || 0), 0),
    },
  });
}));

router.post("/ordens", asyncHandler(async (req, res) => {
  const { equipamentoId, data, descricao, leitura, planoId, responsavelId, ...dados } = req.body;

  if (!equipamentoId || !data || !descricao) {
    return res.status(400).json({ erro: "Informe equipamento, data e descrição" });
  }

  const ordem = await prisma.ordemManutencao.create({
    data: {
      ...dados,
      descricao,
      data: new Date(`${String(data).slice(0, 10)}T12:00:00Z`),
      leitura: leitura !== undefined && leitura !== "" ? Number(leitura) : undefined,
      custoPecas: dados.custoPecas ? Number(dados.custoPecas) : undefined,
      custoServico: dados.custoServico ? Number(dados.custoServico) : undefined,
      equipamentoId: Number(equipamentoId),
      planoId: planoId ? Number(planoId) : undefined,
      responsavelId: responsavelId ? Number(responsavelId) : undefined,
      empresaId: req.usuario.empresaId || undefined,
    },
    include: incluirOrdem,
  });

  // Registrar o serviço reposiciona o plano e atualiza a leitura do
  // equipamento. Sem isso, a pessoa teria que lembrar de fazer as duas
  // coisas à mão, e o aviso de vencimento nunca sairia do vermelho.
  if (ordem.planoId) {
    await prisma.planoManutencao.update({
      where: { id: ordem.planoId },
      data: { ultimaLeitura: ordem.leitura ?? undefined, ultimaData: ordem.data },
    });
  }

  if (ordem.leitura != null) {
    const equipamento = await prisma.equipamento.findUnique({ where: { id: ordem.equipamentoId } });
    if (equipamento && (equipamento.leituraAtual == null || ordem.leitura > equipamento.leituraAtual)) {
      await prisma.equipamento.update({
        where: { id: equipamento.id },
        data: { leituraAtual: ordem.leitura, leituraAtualizada: new Date() },
      });
    }
  }

  res.status(201).json(ordem);
}));

router.put("/ordens/:id", asyncHandler(async (req, res) => {
  const { equipamentoId, data, leitura, planoId, responsavelId, empresaId, ...dados } = req.body;

  res.json(await prisma.ordemManutencao.update({
    where: { id: Number(req.params.id) },
    data: {
      ...dados,
      data: data ? new Date(`${String(data).slice(0, 10)}T12:00:00Z`) : undefined,
      leitura: leitura !== undefined && leitura !== "" ? Number(leitura) : undefined,
      custoPecas: dados.custoPecas !== undefined ? (dados.custoPecas === "" ? null : Number(dados.custoPecas)) : undefined,
      custoServico: dados.custoServico !== undefined ? (dados.custoServico === "" ? null : Number(dados.custoServico)) : undefined,
      equipamentoId: equipamentoId ? Number(equipamentoId) : undefined,
      planoId: planoId === null || planoId === "" ? null : (planoId ? Number(planoId) : undefined),
      responsavelId: responsavelId === null || responsavelId === "" ? null : (responsavelId ? Number(responsavelId) : undefined),
    },
    include: incluirOrdem,
  }));
}));

router.delete("/ordens/:id", asyncHandler(async (req, res) => {
  await prisma.ordemManutencao.delete({ where: { id: Number(req.params.id) } });
  res.status(204).send();
}));

module.exports = router;

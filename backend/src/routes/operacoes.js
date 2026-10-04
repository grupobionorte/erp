const express = require("express");

const prisma = require("../lib/prisma");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

// Data vinda da tela é só o dia; grava ao meio-dia no fuso da operação para
// o dia não escorregar conforme o fuso de quem olha.
const dataDoDia = (valor) =>
  valor ? new Date(`${String(valor).slice(0, 10)}T12:00:00-04:00`) : null;

router.get("/", asyncHandler(async (req, res) => {
  res.json(await prisma.operacao.findMany({
    where: {
      empresaId: req.usuario.empresaId || undefined,
      ativo: req.query.inativas === "1" ? undefined : true,
    },
    include: { fornecedor: { select: { id: true, nomeRazaoSocial: true, documento: true } } },
    orderBy: [{ dataInicio: "desc" }, { codigo: "asc" }],
  }));
}));

router.post("/", asyncHandler(async (req, res) => {
  const { codigo, descricao, dataInicio, dataFim, valorUnitarioMateriaPrima, fornecedorId, umidade } = req.body;
  if (!codigo || !descricao) {
    return res.status(400).json({ erro: "Informe o código e a descrição" });
  }

  res.status(201).json(await prisma.operacao.create({
    data: {
      codigo: String(codigo).trim(),
      descricao: String(descricao).trim(),
      dataInicio: dataDoDia(dataInicio) || undefined,
      dataFim: dataDoDia(dataFim) || undefined,
      valorUnitarioMateriaPrima: valorUnitarioMateriaPrima !== undefined && valorUnitarioMateriaPrima !== ""
        ? Number(valorUnitarioMateriaPrima) : undefined,
      fornecedorId: fornecedorId ? Number(fornecedorId) : undefined,
      umidade: umidade !== undefined && umidade !== "" ? Number(umidade) : undefined,
      empresaId: req.usuario.empresaId || undefined,
    },
  }));
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { codigo, descricao, dataInicio, dataFim, ativo, valorUnitarioMateriaPrima, fornecedorId, umidade } = req.body;

  res.json(await prisma.operacao.update({
    where: { id: Number(req.params.id) },
    data: {
      codigo: codigo !== undefined ? String(codigo).trim() : undefined,
      descricao: descricao !== undefined ? String(descricao).trim() : undefined,
      // Campo em branco limpa a data; ausente deixa como está.
      dataInicio: dataInicio === "" || dataInicio === null ? null : (dataInicio ? dataDoDia(dataInicio) : undefined),
      dataFim: dataFim === "" || dataFim === null ? null : (dataFim ? dataDoDia(dataFim) : undefined),
      ativo: typeof ativo === "boolean" ? ativo : undefined,
      valorUnitarioMateriaPrima: valorUnitarioMateriaPrima === "" || valorUnitarioMateriaPrima === null
        ? null
        : (valorUnitarioMateriaPrima !== undefined ? Number(valorUnitarioMateriaPrima) : undefined),
      fornecedorId: fornecedorId === "" || fornecedorId === null
        ? null
        : (fornecedorId !== undefined ? Number(fornecedorId) : undefined),
      umidade: umidade === "" || umidade === null
        ? null
        : (umidade !== undefined ? Number(umidade) : undefined),
    },
  }));
}));

// Exclusão lógica, como nos demais cadastros: operação encerrada ainda é
// referência do que já aconteceu.
router.delete("/:id", asyncHandler(async (req, res) => {
  await prisma.operacao.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
  res.status(204).send();
}));

/* ---------------------------------------------------------------------------
   Viagens da operação.

   Os totais são calculados a partir das quantidades e dos valores
   unitários, e podem ser corrigidos à mão quando a realidade não fecha com
   a conta — é comum a descarga vir diferente do carregamento.
--------------------------------------------------------------------------- */

const numero = (valor) =>
  valor === "" || valor === null || valor === undefined ? null : Number(valor);

/**
 * Todos os valores da viagem saem de quatro números digitados: as duas
 * quantidades e os dois valores unitários, mais o preço da matéria-prima
 * que vem da operação.
 *
 * O cálculo mora aqui, no servidor. A tela mostra os mesmos valores
 * enquanto se digita, mas quem grava é este trecho — assim não existe a
 * possibilidade de a tela e o banco discordarem.
 */
function calcularTotais(dados, valorUnitarioMateriaPrima) {
  const quantidadeNf = numero(dados.quantidadeNf);
  const unitarioNf = numero(dados.valorUnitarioNf);
  const quantidadeDescarga = numero(dados.quantidadeDescarga);
  const unitarioTransporte = numero(dados.valorUnitarioTransporte);
  const unitarioMateriaPrima = numero(valorUnitarioMateriaPrima);

  const arredondar = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const multiplicar = (a, b) => (a != null && b != null ? arredondar(a * b) : null);

  // Nota fiscal: o que foi carregado.
  const totalNf = multiplicar(quantidadeNf, unitarioNf);

  // CT-e: documenta o que saiu, então usa a quantidade da nota.
  const totalTransporte = multiplicar(quantidadeNf, unitarioTransporte);

  // Custo real do frete: sobre o que efetivamente chegou.
  const custoTransporte = multiplicar(quantidadeDescarga, unitarioTransporte);

  // Receita: o que foi aceito na balança do destino.
  const totalServico = multiplicar(quantidadeDescarga, unitarioNf);

  // Matéria-prima: o preço da operação aplicado ao que chegou.
  const custoMateriaPrima = multiplicar(quantidadeDescarga, unitarioMateriaPrima);

  const lucro = totalServico != null
    ? arredondar(totalServico - (custoMateriaPrima || 0) - (custoTransporte || 0))
    : null;

  return { totalNf, totalTransporte, custoTransporte, totalServico, custoMateriaPrima, lucro };
}

function montarViagem(dados, valorUnitarioMateriaPrima) {
  const calculado = calcularTotais(dados, valorUnitarioMateriaPrima);

  return {
    dataLancamento: dataDoDia(dados.dataLancamento) || new Date(),
    numeroNf: dados.numeroNf || null,
    quantidadeNf: numero(dados.quantidadeNf),
    valorUnitarioNf: numero(dados.valorUnitarioNf),
    valorTotalNf: calculado.totalNf,
    clienteDestino: dados.clienteDestino || null,

    dataCte: dataDoDia(dados.dataCte),
    numeroCte: dados.numeroCte || null,
    tomador: dados.tomador || null,
    placa: dados.placa ? String(dados.placa).toUpperCase() : null,
    valorUnitarioTransporte: numero(dados.valorUnitarioTransporte),
    valorTotalTransporte: calculado.totalTransporte,

    dataDescarga: dataDoDia(dados.dataDescarga),
    quantidadeDescarga: numero(dados.quantidadeDescarga),
    quantidadeBrutaDescarga: numero(dados.quantidadeBrutaDescarga),
    umidadeDescarga: numero(dados.umidadeDescarga),
    ticket: dados.ticket || null,

    custoTransporte: calculado.custoTransporte,
    valorTotalServico: calculado.totalServico,
    custoMateriaPrima: calculado.custoMateriaPrima,
    lucroBruto: calculado.lucro,

    observacao: dados.observacao || null,
  };
}

// Dia inteiro no fuso da operação: a descarga é gravada ao meio-dia de
// Cuiabá, e o filtro precisa pegar o dia de MT, não o de UTC.
const diaValido = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));
const inicioDoDia = (dia) => new Date(`${dia}T00:00:00-04:00`);
const fimDoDia = (dia) => new Date(`${dia}T23:59:59.999-04:00`);

// Filtro pela data da descarga. Os totais saem só das viagens filtradas,
// para o resumo da tela bater com a lista que aparece.
function filtroDescarga({ descargaDe, descargaAte }) {
  if (!diaValido(descargaDe) && !diaValido(descargaAte)) return {};
  return {
    dataDescarga: {
      gte: diaValido(descargaDe) ? inicioDoDia(descargaDe) : undefined,
      lte: diaValido(descargaAte) ? fimDoDia(descargaAte) : undefined,
    },
  };
}

function totaisDasViagens(viagens) {
  const somar = (campo) => viagens.reduce((t, v) => t + (Number(v[campo]) || 0), 0);
  return {
    viagens: viagens.length,
    quantidadeNf: somar("quantidadeNf"),
    quantidadeDescarga: somar("quantidadeDescarga"),
    valorNf: somar("valorTotalNf"),
    transporte: somar("valorTotalTransporte"),
    custoTransporte: somar("custoTransporte"),
    servico: somar("valorTotalServico"),
    materiaPrima: somar("custoMateriaPrima"),
    lucro: somar("lucroBruto"),
  };
}

// CPF/CNPJ do jeito que a tela grava no cliente da viagem (nome - documento).
function documentoFormatado(documento) {
  const d = String(documento || "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return null;
}

// Viagens de um cliente, de todas as operações. Fica aqui, e não em
// /pessoas, para seguir a permissão do menu Operações: quem não vê as
// operações também não vê as viagens pelo cadastro do cliente.
//
// O cliente da viagem é gravado como texto ("NOME - CNPJ"), então a busca é
// pelo CNPJ/CPF, que não muda — trocar a razão social no cadastro não faz
// as viagens antigas sumirem. Texto digitado sem o documento não entra.
router.get("/viagens-por-cliente/:pessoaId", asyncHandler(async (req, res) => {
  const pessoa = await prisma.pessoa.findUnique({
    where: { id: Number(req.params.pessoaId) },
    select: { documento: true },
  });
  const documento = documentoFormatado(pessoa?.documento);
  if (!documento) return res.json({ viagens: [], totais: totaisDasViagens([]) });

  const viagens = await prisma.viagemOperacao.findMany({
    where: {
      clienteDestino: { contains: documento },
      operacao: { empresaId: req.usuario.empresaId || undefined },
      ...filtroDescarga(req.query),
    },
    include: { operacao: { select: { id: true, codigo: true, descricao: true } } },
    orderBy: [{ dataLancamento: "desc" }, { id: "desc" }],
  });

  res.json({ viagens, totais: totaisDasViagens(viagens) });
}));

router.get("/:id/viagens", asyncHandler(async (req, res) => {
  const viagens = await prisma.viagemOperacao.findMany({
    where: { operacaoId: Number(req.params.id), ...filtroDescarga(req.query) },
    include: { fatura: { select: { numero: true } } },
    orderBy: [{ dataLancamento: "desc" }, { id: "desc" }],
  });

  res.json({ viagens, totais: totaisDasViagens(viagens) });
}));

// O preço da matéria-prima é da operação, não da viagem: mudou o preço,
// mudam os lançamentos novos — os antigos guardam o custo da época.
async function precoMateriaPrima(operacaoId) {
  const operacao = await prisma.operacao.findUnique({
    where: { id: Number(operacaoId) },
    select: { valorUnitarioMateriaPrima: true },
  });
  return operacao?.valorUnitarioMateriaPrima ?? null;
}

router.post("/:id/viagens", asyncHandler(async (req, res) => {
  const preco = await precoMateriaPrima(req.params.id);
  res.status(201).json(await prisma.viagemOperacao.create({
    data: { ...montarViagem(req.body, preco), operacaoId: Number(req.params.id) },
  }));
}));

// Viagem já cobrada não muda: o total da fatura deixaria de bater com as
// viagens dela. Para corrigir, cancela-se a fatura, corrige e fatura de novo.
async function recusarSeFaturada(viagemId, res) {
  const viagem = await prisma.viagemOperacao.findUnique({
    where: { id: Number(viagemId) },
    select: { fatura: { select: { numero: true } } },
  });
  if (!viagem?.fatura) return false;
  res.status(409).json({
    erro: `Essa viagem está na fatura nº ${viagem.fatura.numero}. ` +
      "Para alterar ou excluir, cancele a fatura antes (aba Faturas).",
  });
  return true;
}

router.put("/:id/viagens/:viagemId", asyncHandler(async (req, res) => {
  if (await recusarSeFaturada(req.params.viagemId, res)) return;
  const preco = await precoMateriaPrima(req.params.id);
  res.json(await prisma.viagemOperacao.update({
    where: { id: Number(req.params.viagemId) },
    data: montarViagem(req.body, preco),
  }));
}));

router.delete("/:id/viagens/:viagemId", asyncHandler(async (req, res) => {
  if (await recusarSeFaturada(req.params.viagemId, res)) return;
  await prisma.viagemOperacao.delete({ where: { id: Number(req.params.viagemId) } });
  res.status(204).send();
}));

/* ---------------------------------------------------------------------------
   Resumo de receitas e despesas da operação.

   Receita: o serviço das viagens. Despesas: o que as próprias viagens já
   carregam (matéria-prima e transporte real) mais as contas a pagar
   lançadas para a operação. Conta cancelada não entra; aberta e paga
   entram pelo valor da conta, porque a despesa existe mesmo antes de paga.
--------------------------------------------------------------------------- */
router.get("/:id/resumo", asyncHandler(async (req, res) => {
  const operacaoId = Number(req.params.id);
  const arredondar = (valor) => Math.round((Number(valor) || 0) * 100) / 100;
  const [viagens, contas] = await Promise.all([
    prisma.viagemOperacao.findMany({ where: { operacaoId } }),
    prisma.contaPagar.findMany({
      where: { operacaoId, status: { not: "cancelada" } },
      select: { valor: true, status: true },
    }),
  ]);

  const v = totaisDasViagens(viagens);
  const somar = (lista) => arredondar(lista.reduce((t, c) => t + (Number(c.valor) || 0), 0));
  const despesas = {
    total: somar(contas),
    pagas: somar(contas.filter((c) => c.status === "paga")),
    abertas: somar(contas.filter((c) => c.status === "aberta")),
    quantidade: contas.length,
  };
  const receitas = arredondar(v.servico);
  const materiaPrima = arredondar(v.materiaPrima);
  const transporte = arredondar(v.custoTransporte);

  res.json({
    viagens: v.viagens,
    receitas,
    materiaPrima,
    transporte,
    despesas,
    resultado: arredondar(receitas - materiaPrima - transporte - despesas.total),
  });
}));

/* ---------------------------------------------------------------------------
   Faturas da operação.

   Cobram do cliente de destino o valor do serviço (unitário da NF ×
   quantidade descarregada) das viagens descarregadas num período. Cada
   viagem entra em uma fatura só.
--------------------------------------------------------------------------- */

// Viagens que podem entrar numa fatura: do cliente, descarregadas no
// período, ainda sem fatura e com o valor do serviço calculado (sem a
// quantidade descarregada não há o que cobrar).
function filtroFaturaveis(operacaoId, { cliente, de, ate }) {
  return {
    operacaoId: Number(operacaoId),
    faturaId: null,
    clienteDestino: cliente,
    valorTotalServico: { not: null },
    dataDescarga: { gte: inicioDoDia(de), lte: fimDoDia(ate) },
  };
}

function lerPeriodo(fonte) {
  const cliente = String(fonte.cliente || "").trim();
  const { de, ate } = fonte;
  if (!cliente) return { erro: "Escolha o cliente." };
  if (!diaValido(de) || !diaValido(ate)) return { erro: "Informe a data inicial e a final da descarga." };
  if (de > ate) return { erro: "A data inicial é depois da final." };
  return { cliente, de, ate };
}

// Vencimento e observação: o que a fatura tem além das viagens.
function dadosLivresDaFatura(corpo) {
  return {
    vencimento: diaValido(corpo.vencimento) ? dataDoDia(corpo.vencimento) : null,
    observacao: String(corpo.observacao || "").trim() || null,
  };
}

// Clientes que aparecem nas viagens da operação, para a lista da tela.
router.get("/:id/faturas/clientes", asyncHandler(async (req, res) => {
  const linhas = await prisma.viagemOperacao.findMany({
    where: { operacaoId: Number(req.params.id), clienteDestino: { not: null } },
    distinct: ["clienteDestino"],
    select: { clienteDestino: true },
    orderBy: { clienteDestino: "asc" },
  });
  res.json(linhas.map((l) => l.clienteDestino).filter(Boolean));
}));

router.get("/:id/faturas/previa", asyncHandler(async (req, res) => {
  const periodo = lerPeriodo(req.query);
  if (periodo.erro) return res.status(400).json({ erro: periodo.erro });

  const viagens = await prisma.viagemOperacao.findMany({
    where: filtroFaturaveis(req.params.id, periodo),
    orderBy: [{ dataDescarga: "asc" }, { id: "asc" }],
  });
  res.json({ viagens, totais: totaisDasViagens(viagens) });
}));

router.get("/:id/faturas", asyncHandler(async (req, res) => {
  res.json(await prisma.faturaOperacao.findMany({
    where: { operacaoId: Number(req.params.id) },
    include: { _count: { select: { viagens: true } } },
    orderBy: { numero: "desc" },
  }));
}));

router.post("/:id/faturas", asyncHandler(async (req, res) => {
  const periodo = lerPeriodo(req.body);
  if (periodo.erro) return res.status(400).json({ erro: periodo.erro });
  const ids = (Array.isArray(req.body.viagemIds) ? req.body.viagemIds : []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ erro: "Selecione ao menos uma viagem." });

  const operacao = await prisma.operacao.findUnique({
    where: { id: Number(req.params.id) },
    select: { id: true, empresaId: true },
  });
  if (!operacao) return res.status(404).json({ erro: "Operação não encontrada." });

  const gerar = () => prisma.$transaction(async (tx) => {
    // As viagens são conferidas de novo aqui: entre a prévia e o clique
    // alguém pode ter faturado ou alterado uma delas.
    const viagens = await tx.viagemOperacao.findMany({
      where: { ...filtroFaturaveis(operacao.id, periodo), id: { in: ids } },
    });
    if (viagens.length !== ids.length) {
      throw Object.assign(new Error(
        "Alguma viagem selecionada já foi faturada ou mudou. Atualize a prévia e tente de novo."
      ), { status: 409 });
    }

    const ultima = await tx.faturaOperacao.findFirst({
      where: { empresaId: operacao.empresaId },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });
    const totais = totaisDasViagens(viagens);

    const criada = await tx.faturaOperacao.create({
      data: {
        numero: (ultima?.numero || 0) + 1,
        empresaId: operacao.empresaId,
        operacaoId: operacao.id,
        cliente: periodo.cliente,
        descargaDe: dataDoDia(periodo.de),
        descargaAte: dataDoDia(periodo.ate),
        quantidadeTotal: totais.quantidadeDescarga,
        valorTotal: totais.servico,
        ...dadosLivresDaFatura(req.body),
      },
    });
    await tx.viagemOperacao.updateMany({ where: { id: { in: ids } }, data: { faturaId: criada.id } });
    return criada;
  });

  // O tratamento geral de erros não olha o status do erro; a recusa
  // prevista vira 409 aqui, com a mensagem para a tela.
  try {
    res.status(201).json(await gerar());
  } catch (erro) {
    if (erro.status) return res.status(erro.status).json({ erro: erro.message });
    throw erro;
  }
}));

// Para editar: as viagens que já estão na fatura e as que ainda podem
// entrar — do mesmo cliente, no período dela, sem outra fatura.
router.get("/:id/faturas/:faturaId/edicao", asyncHandler(async (req, res) => {
  const fatura = await prisma.faturaOperacao.findFirst({
    where: { id: Number(req.params.faturaId), operacaoId: Number(req.params.id) },
  });
  if (!fatura) return res.status(404).json({ erro: "Fatura não encontrada." });
  if (fatura.canceladaEm) return res.status(409).json({ erro: "Fatura cancelada não pode ser editada." });

  const viagens = await prisma.viagemOperacao.findMany({
    where: {
      OR: [
        { faturaId: fatura.id },
        { ...filtroFaturaveis(fatura.operacaoId, periodoDaFatura(fatura)) },
      ],
    },
    orderBy: [{ dataDescarga: "asc" }, { id: "asc" }],
  });
  res.json({ fatura, viagens });
}));

// O período gravado volta para o formato do filtro (AAAA-MM-DD, dia de MT).
function periodoDaFatura(fatura) {
  const dia = (d) => new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
  return { cliente: fatura.cliente, de: dia(fatura.descargaDe), ate: dia(fatura.descargaAte) };
}

// Edita a fatura: troca as viagens (o número continua o mesmo, os totais
// são recalculados) e o vencimento e a observação.
router.put("/:id/faturas/:faturaId", asyncHandler(async (req, res) => {
  const ids = (Array.isArray(req.body.viagemIds) ? req.body.viagemIds : []).map(Number).filter(Boolean);
  if (!ids.length) {
    return res.status(400).json({ erro: "A fatura precisa de ao menos uma viagem. Para desfazer, cancele a fatura." });
  }

  const editar = () => prisma.$transaction(async (tx) => {
    const fatura = await tx.faturaOperacao.findFirst({
      where: { id: Number(req.params.faturaId), operacaoId: Number(req.params.id) },
    });
    if (!fatura) throw Object.assign(new Error("Fatura não encontrada."), { status: 404 });
    if (fatura.canceladaEm) throw Object.assign(new Error("Fatura cancelada não pode ser editada."), { status: 409 });

    // Cada viagem escolhida tem que já ser desta fatura ou estar livre para
    // ela (mesmo cliente, dentro do período) — conferido de novo aqui.
    const permitidas = await tx.viagemOperacao.findMany({
      where: {
        id: { in: ids },
        OR: [
          { faturaId: fatura.id },
          { ...filtroFaturaveis(fatura.operacaoId, periodoDaFatura(fatura)) },
        ],
      },
    });
    if (permitidas.length !== ids.length) {
      throw Object.assign(new Error(
        "Alguma viagem escolhida já está em outra fatura ou mudou. Abra a edição de novo e confira."
      ), { status: 409 });
    }

    await tx.viagemOperacao.updateMany({
      where: { faturaId: fatura.id, id: { notIn: ids } },
      data: { faturaId: null },
    });
    await tx.viagemOperacao.updateMany({ where: { id: { in: ids } }, data: { faturaId: fatura.id } });

    const totais = totaisDasViagens(permitidas);
    return tx.faturaOperacao.update({
      where: { id: fatura.id },
      data: {
        quantidadeTotal: totais.quantidadeDescarga,
        valorTotal: totais.servico,
        ...dadosLivresDaFatura(req.body),
      },
    });
  });

  try {
    res.json(await editar());
  } catch (erro) {
    if (erro.status) return res.status(erro.status).json({ erro: erro.message });
    throw erro;
  }
}));

// Fatura completa, para a impressão: com as viagens e os dados da empresa.
router.get("/:id/faturas/:faturaId", asyncHandler(async (req, res) => {
  const fatura = await prisma.faturaOperacao.findFirst({
    where: { id: Number(req.params.faturaId), operacaoId: Number(req.params.id) },
    include: {
      viagens: { orderBy: [{ dataDescarga: "asc" }, { id: "asc" }] },
      operacao: { select: { codigo: true, descricao: true } },
    },
  });
  if (!fatura) return res.status(404).json({ erro: "Fatura não encontrada." });

  const empresa = fatura.empresaId
    ? await prisma.empresa.findUnique({
        where: { id: fatura.empresaId },
        select: { razaoSocial: true, nomeFantasia: true, cnpj: true, logoUrl: true },
      })
    : null;
  res.json({ ...fatura, empresa });
}));

// Cancelar libera as viagens para outra fatura, mas a fatura fica
// gravada: apagar faria o número dela voltar a ser usado, e uma fatura já
// enviada ao cliente teria o mesmo número de outra.
router.delete("/:id/faturas/:faturaId", asyncHandler(async (req, res) => {
  const fatura = await prisma.faturaOperacao.findFirst({
    where: { id: Number(req.params.faturaId), operacaoId: Number(req.params.id) },
    select: { id: true, canceladaEm: true },
  });
  if (!fatura) return res.status(404).json({ erro: "Fatura não encontrada." });
  if (fatura.canceladaEm) return res.status(409).json({ erro: "Essa fatura já está cancelada." });

  await prisma.$transaction([
    prisma.viagemOperacao.updateMany({ where: { faturaId: fatura.id }, data: { faturaId: null } }),
    prisma.faturaOperacao.update({ where: { id: fatura.id }, data: { canceladaEm: new Date() } }),
  ]);
  res.status(204).send();
}));

module.exports = router;

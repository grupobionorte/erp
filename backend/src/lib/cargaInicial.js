const prisma = require("./prisma");
const { CFOPS } = require("./tabelaCfop");

/* ---------------------------------------------------------------------------
   Carga inicial das tabelas de apoio.

   Roda na subida do servidor e só age quando a tabela está vazia. Existe por
   um motivo prático: essas tabelas não vêm nas migrations e precisavam de um
   script rodado à mão contra o banco — o que exige acesso externo ao
   Postgres, nem sempre disponível. Sem elas, a busca de CFOP não acha nada e
   o MDF-e não resolve o código IBGE dos municípios.

   É seguro rodar sempre: se já há dados, não faz nada. E nunca apaga.
--------------------------------------------------------------------------- */

async function carregarCfops() {
  const total = await prisma.cfop.count();
  if (total > 0) return { tabela: "cfop", jaTinha: total };

  // createMany é bem mais rápido que upsert em lote, e aqui a tabela está
  // comprovadamente vazia, então não há conflito a tratar.
  await prisma.cfop.createMany({
    data: CFOPS.map(([codigo, descricao]) => ({ codigo, descricao })),
    skipDuplicates: true,
  });
  return { tabela: "cfop", carregados: CFOPS.length };
}

async function carregarMunicipios() {
  const total = await prisma.municipio.count();
  if (total > 0) return { tabela: "municipio", jaTinha: total };

  // Os municípios vêm da API do IBGE. Se não houver internet ou a API estiver
  // fora, o servidor sobe do mesmo jeito — só o MDF-e fica sem resolver
  // código IBGE até a próxima tentativa.
  const resposta = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios");
  if (!resposta.ok) throw new Error(`IBGE respondeu ${resposta.status}`);
  const lista = await resposta.json();

  const dados = lista.map((m) => ({
    codigoIbge: String(m.id),
    nome: m.nome,
    uf: m.microrregiao?.mesorregiao?.UF?.sigla
      || m["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla
      || "",
  })).filter((m) => m.uf);

  await prisma.municipio.createMany({ data: dados, skipDuplicates: true });
  return { tabela: "municipio", carregados: dados.length };
}

/**
 * Chamado na subida do servidor. Nunca derruba a aplicação: uma tabela de
 * apoio faltando atrapalha uma tela, mas não pode impedir o sistema de subir.
 */
async function carregarTabelasDeApoio() {
  for (const carregar of [carregarCfops, carregarMunicipios]) {
    try {
      const r = await carregar();
      if (r.carregados) console.log(`[carga inicial] ${r.tabela}: ${r.carregados} registros carregados.`);
    } catch (erro) {
      console.error(`[carga inicial] falhou: ${erro.message}`);
    }
  }
}

module.exports = { carregarTabelasDeApoio, carregarCfops, carregarMunicipios };

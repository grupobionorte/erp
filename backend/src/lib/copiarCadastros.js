const prisma = require("./prisma");

/* ---------------------------------------------------------------------------
   Copia cadastros de uma empresa para outra do grupo.

   É CÓPIA, nunca mudança de dono: o cadastro da origem já aparece em notas,
   CT-e e MDF-e emitidos, e registro citado em documento fiscal precisa
   continuar existindo onde está.

   Sem aplicar, só conta (prévia). Aplicando, grava tudo numa transação: ou
   entra tudo ou não entra nada.
--------------------------------------------------------------------------- */

const TIPOS = ["clientes", "fornecedores", "transportadoras", "motoristas", "veiculos"];

const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const placaLimpa = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Campos que nunca vão junto: a identidade do registro novo é dele.
const sem = (registro, ...campos) => {
  const copia = { ...registro };
  for (const campo of campos) delete copia[campo];
  return copia;
};

async function copiarEndereco(tx, enderecoId) {
  if (!enderecoId) return null;
  const endereco = await tx.endereco.findUnique({ where: { id: enderecoId } });
  if (!endereco) return null;
  // Endereço novo, não compartilhado: editar o de uma empresa não pode mexer
  // no da outra.
  const criado = await tx.endereco.create({ data: sem(endereco, "id") });
  return criado.id;
}

async function executar({ origemId, destinoId, tipos, aplicar }) {
  const resumo = {};
  const avisos = [];

  const trabalho = async (tx) => {
    // Mapas "id na origem → id no destino". Servem para refazer os vínculos
    // (veículo → motorista, transportadora, reboques) com os registros novos
    // ou com os que o destino já tinha.
    const mapaTransportadora = new Map();
    const mapaMotorista = new Map();
    const mapaVeiculo = new Map();

    const novoResumo = () => ({ copiar: 0, pular: 0, pulados: [] });

    // ---- Clientes e fornecedores -----------------------------------------
    for (const papel of ["cliente", "fornecedor"]) {
      const tipo = papel === "cliente" ? "clientes" : "fornecedores";
      if (!tipos.includes(tipo)) continue;
      resumo[tipo] = novoResumo();

      const origem = await tx.pessoa.findMany({ where: { empresaId: origemId, papel, ativo: true } });
      const existentes = await tx.pessoa.findMany({ where: { empresaId: destinoId, papel }, select: { documento: true } });
      const jaTem = new Set(existentes.map((p) => soDigitos(p.documento)));

      for (const pessoa of origem) {
        if (jaTem.has(soDigitos(pessoa.documento))) {
          resumo[tipo].pular++;
          resumo[tipo].pulados.push(`${pessoa.nomeRazaoSocial} (já existe)`);
          continue;
        }
        resumo[tipo].copiar++;
        if (!aplicar) continue;
        const enderecoId = await copiarEndereco(tx, pessoa.enderecoId);
        await tx.pessoa.create({ data: { ...sem(pessoa, "id", "criadoEm", "enderecoId", "empresaId"), enderecoId, empresaId: destinoId } });
      }
    }

    // ---- Transportadoras --------------------------------------------------
    // O mapa precisa existir também quando só motoristas ou veículos forem
    // copiados: o vínculo é refeito com a transportadora que o destino já tem.
    {
      const copiando = tipos.includes("transportadoras");
      if (copiando) resumo.transportadoras = novoResumo();

      const origem = await tx.transportadora.findMany({ where: { empresaId: origemId, ativo: true } });
      const existentes = await tx.transportadora.findMany({ where: { empresaId: destinoId } });
      const porCnpj = new Map(existentes.map((t) => [soDigitos(t.cnpj), t.id]));

      for (const t of origem) {
        const igual = porCnpj.get(soDigitos(t.cnpj));
        if (igual) {
          mapaTransportadora.set(t.id, igual);
          if (copiando) { resumo.transportadoras.pular++; resumo.transportadoras.pulados.push(`${t.razaoSocial} (já existe)`); }
          continue;
        }
        if (!copiando) continue;
        resumo.transportadoras.copiar++;
        // Na prévia nada é gravado; o marcador só faz o vínculo contar como
        // "vai existir" nos avisos dos veículos.
        if (!aplicar) { mapaTransportadora.set(t.id, -1); continue; }
        const enderecoId = await copiarEndereco(tx, t.enderecoId);
        const criada = await tx.transportadora.create({ data: { ...sem(t, "id", "enderecoId", "empresaId"), enderecoId, empresaId: destinoId } });
        mapaTransportadora.set(t.id, criada.id);
      }
    }

    // ---- Motoristas --------------------------------------------------------
    {
      if (tipos.includes("motoristas")) resumo.motoristas = novoResumo();

      const origem = await tx.motorista.findMany({ where: { empresaId: origemId, ativo: true } });
      const existentes = await tx.motorista.findMany({ where: { empresaId: destinoId } });
      const porCpf = new Map(existentes.map((m) => [soDigitos(m.cpf), m.id]));
      let viraramTerceiro = 0;

      for (const m of origem) {
        const igual = porCpf.get(soDigitos(m.cpf));
        if (igual) {
          mapaMotorista.set(m.id, igual);
          if (resumo.motoristas) { resumo.motoristas.pular++; resumo.motoristas.pulados.push(`${m.nome} (já existe)`); }
          continue;
        }
        if (!tipos.includes("motoristas")) continue;
        resumo.motoristas.copiar++;
        // Funcionário da outra empresa não é funcionário desta: sem o vínculo
        // com colaborador, entra como terceiro. Assim o ponto não passa a
        // cobrar jornada de quem não é da empresa.
        const eraFuncionario = m.vinculo === "funcionario" || m.colaboradorId != null;
        if (eraFuncionario) viraramTerceiro++;
        if (!aplicar) { mapaMotorista.set(m.id, -1); continue; }
        const enderecoId = await copiarEndereco(tx, m.enderecoId);
        const criado = await tx.motorista.create({
          data: {
            ...sem(m, "id", "criadoEm", "enderecoId", "empresaId", "colaboradorId", "transportadoraId"),
            vinculo: eraFuncionario ? "terceiro" : m.vinculo,
            transportadoraId: m.transportadoraId ? (mapaTransportadora.get(m.transportadoraId) ?? null) : null,
            enderecoId,
            empresaId: destinoId,
          },
        });
        mapaMotorista.set(m.id, criado.id);
      }
      if (viraramTerceiro) {
        avisos.push(`${viraramTerceiro} motorista(s) eram funcionários e entram como terceiro, sem vínculo com colaborador. Ajuste caso a caso depois, se algum for da Bionorte Transportes.`);
      }
    }

    // ---- Veículos ------------------------------------------------------------
    if (tipos.includes("veiculos")) {
      resumo.veiculos = novoResumo();

      const origem = await tx.veiculo.findMany({ where: { empresaId: origemId, ativo: true } });
      const existentes = await tx.veiculo.findMany({ where: { empresaId: destinoId }, select: { id: true, placa: true } });
      const porPlaca = new Map(existentes.map((v) => [placaLimpa(v.placa), v.id]));
      let semMotorista = 0;
      let semTransportadora = 0;

      for (const v of origem) {
        const igual = porPlaca.get(placaLimpa(v.placa));
        if (igual) {
          mapaVeiculo.set(v.id, igual);
          resumo.veiculos.pular++;
          resumo.veiculos.pulados.push(`${v.placa} (já existe)`);
          continue;
        }
        resumo.veiculos.copiar++;

        const motoristaId = v.motoristaId ? (mapaMotorista.get(v.motoristaId) ?? null) : null;
        const transportadoraId = v.transportadoraId ? (mapaTransportadora.get(v.transportadoraId) ?? null) : null;
        if (v.motoristaId && !motoristaId) semMotorista++;
        if (v.transportadoraId && !transportadoraId) semTransportadora++;
        if (!aplicar) continue;

        // Reboques são refeitos depois, quando todos os veículos já existem.
        const criado = await tx.veiculo.create({
          data: {
            ...sem(v, "id", "empresaId", "motoristaId", "transportadoraId", "reboque1Id", "reboque2Id", "reboque3Id"),
            motoristaId, transportadoraId, empresaId: destinoId,
          },
        });
        mapaVeiculo.set(v.id, criado.id);
      }

      if (aplicar) {
        for (const v of origem) {
          if (!v.reboque1Id && !v.reboque2Id && !v.reboque3Id) continue;
          // Só refaz o atrelamento dos cavalos copiados agora; o cavalo que o
          // destino já tinha fica como está.
          if (porPlaca.has(placaLimpa(v.placa))) continue;
          const novoId = mapaVeiculo.get(v.id);
          const ids = [v.reboque1Id, v.reboque2Id, v.reboque3Id].map((r) => (r ? (mapaVeiculo.get(r) ?? null) : null));
          await tx.veiculo.update({ where: { id: novoId }, data: { reboque1Id: ids[0], reboque2Id: ids[1], reboque3Id: ids[2] } });
        }
      } else {
        const cavalosComReboque = origem.filter((v) => v.reboque1Id || v.reboque2Id || v.reboque3Id).length;
        if (cavalosComReboque) avisos.push(`${cavalosComReboque} cavalo(s) mecânico(s) têm reboques; o atrelamento é refeito entre os veículos copiados.`);
      }

      if (semMotorista) avisos.push(`${semMotorista} veículo(s) tinham motorista habitual que não está no destino; entram sem motorista. Copie também os motoristas para manter o vínculo.`);
      if (semTransportadora) avisos.push(`${semTransportadora} veículo(s) pertenciam a uma transportadora que não está no destino; entram sem transportadora.`);
    }
  };

  // Prévia e gravação passam pela mesma lógica: o que se vê na prévia é o que
  // será feito. Sem aplicar, nenhuma escrita acontece. O tempo maior é porque
  // o padrão do Prisma (5 s) estouraria com cadastro grande.
  await prisma.$transaction(trabalho, { timeout: 120000, maxWait: 10000 });

  return { resumo, avisos };
}

module.exports = { executar, TIPOS };

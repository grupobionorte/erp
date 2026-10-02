-- Equipamentos: maquinário e frota, para controle de manutenção.
CREATE TABLE "equipamentos" (
  "id"                 SERIAL PRIMARY KEY,
  "nome"               TEXT NOT NULL,
  "tipo"               TEXT NOT NULL DEFAULT 'outro',
  "marca"              TEXT,
  "modelo"             TEXT,
  "ano"                INTEGER,
  "identificacao"      TEXT,
  "controle"           TEXT NOT NULL DEFAULT 'horimetro',
  "leitura_atual"      DOUBLE PRECISION,
  "leitura_atualizada" TIMESTAMP(3),
  "veiculo_id"         INTEGER REFERENCES "veiculos"("id"),
  "ativo"              BOOLEAN NOT NULL DEFAULT true,
  "observacao"         TEXT,
  "empresa_id"         INTEGER REFERENCES "empresas"("id"),
  "criado_em"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "equipamentos_empresa_nome_idx" ON "equipamentos"("empresa_id", "nome");

-- Planos: o que se repete a cada tantas horas, km ou meses.
CREATE TABLE "planos_manutencao" (
  "id"             SERIAL PRIMARY KEY,
  "descricao"      TEXT NOT NULL,
  "intervalo"      DOUBLE PRECISION NOT NULL,
  "ultima_leitura" DOUBLE PRECISION,
  "ultima_data"    TIMESTAMP(3),
  "antecedencia"   DOUBLE PRECISION,
  "ativo"          BOOLEAN NOT NULL DEFAULT true,
  "equipamento_id" INTEGER NOT NULL REFERENCES "equipamentos"("id") ON DELETE CASCADE
);
CREATE INDEX "planos_manutencao_equipamento_idx" ON "planos_manutencao"("equipamento_id");

-- Ordens: o serviço que aconteceu.
CREATE TABLE "ordens_manutencao" (
  "id"             SERIAL PRIMARY KEY,
  "data"           TIMESTAMP(3) NOT NULL,
  "tipo"           TEXT NOT NULL DEFAULT 'preventiva',
  "descricao"      TEXT NOT NULL,
  "leitura"        DOUBLE PRECISION,
  "oficina"        TEXT,
  "custo_pecas"    DOUBLE PRECISION,
  "custo_servico"  DOUBLE PRECISION,
  "pecas"          TEXT,
  "observacao"     TEXT,
  "equipamento_id" INTEGER NOT NULL REFERENCES "equipamentos"("id"),
  "plano_id"       INTEGER REFERENCES "planos_manutencao"("id"),
  "responsavel_id" INTEGER REFERENCES "colaboradores"("id"),
  "empresa_id"     INTEGER REFERENCES "empresas"("id"),
  "criado_em"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ordens_manutencao_empresa_data_idx" ON "ordens_manutencao"("empresa_id", "data");

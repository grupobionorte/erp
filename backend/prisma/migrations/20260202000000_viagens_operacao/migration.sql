-- Viagens de uma operação: um lançamento por caminhão carregado.
CREATE TABLE "viagens_operacao" (
  "id"                       SERIAL PRIMARY KEY,
  "data_lancamento"          TIMESTAMP(3) NOT NULL,
  "numero_nf"                TEXT,
  "quantidade_nf"            DOUBLE PRECISION,
  "valor_unitario_nf"        DOUBLE PRECISION,
  "valor_total_nf"           DOUBLE PRECISION,
  "data_cte"                 TIMESTAMP(3),
  "numero_cte"               TEXT,
  "tomador"                  TEXT,
  "placa"                    TEXT,
  "valor_unitario_transporte" DOUBLE PRECISION,
  "valor_total_transporte"   DOUBLE PRECISION,
  "data_descarga"            TIMESTAMP(3),
  "quantidade_descarga"      DOUBLE PRECISION,
  "ticket"                   TEXT,
  "valor_total_servico"      DOUBLE PRECISION,
  "custo_materia_prima"      DOUBLE PRECISION,
  "lucro_bruto"              DOUBLE PRECISION,
  "observacao"               TEXT,
  "operacao_id"              INTEGER NOT NULL REFERENCES "operacoes"("id") ON DELETE CASCADE,
  "criado_em"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "viagens_operacao_idx" ON "viagens_operacao"("operacao_id", "data_lancamento");

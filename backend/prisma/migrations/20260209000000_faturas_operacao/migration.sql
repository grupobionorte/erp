-- Faturas de viagens: cobram do cliente de destino o valor do serviço das
-- viagens descarregadas num período.
CREATE TABLE "faturas_operacao" (
  "id"               SERIAL PRIMARY KEY,
  "numero"           INTEGER NOT NULL,
  "empresa_id"       INTEGER,
  "operacao_id"      INTEGER NOT NULL REFERENCES "operacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "cliente"          TEXT NOT NULL,
  "descarga_de"      TIMESTAMP(3) NOT NULL,
  "descarga_ate"     TIMESTAMP(3) NOT NULL,
  "quantidade_total" DOUBLE PRECISION NOT NULL,
  "valor_total"      DOUBLE PRECISION NOT NULL,
  -- Fatura não se apaga: cancelada, guarda o número e libera as viagens.
  "cancelada_em"     TIMESTAMP(3),
  "criado_em"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "faturas_operacao_empresa_id_numero_key" ON "faturas_operacao"("empresa_id", "numero");

-- Viagem faturada aponta para a fatura; excluir a fatura libera a viagem.
ALTER TABLE "viagens_operacao" ADD COLUMN "fatura_id" INTEGER
  REFERENCES "faturas_operacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "viagens_operacao_fatura_id_idx" ON "viagens_operacao"("fatura_id");

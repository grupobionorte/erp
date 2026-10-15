-- Equipamentos alocados em cada operação, com entrada e saída.
CREATE TABLE "operacao_equipamentos" (
  "id" SERIAL PRIMARY KEY,
  "operacao_id" INTEGER NOT NULL REFERENCES "operacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "equipamento_id" INTEGER NOT NULL REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "data_entrada" TIMESTAMP(3),
  "data_saida" TIMESTAMP(3),
  "observacao" TEXT,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "operacao_equipamentos_operacao_id_idx" ON "operacao_equipamentos"("operacao_id");
CREATE INDEX "operacao_equipamentos_equipamento_id_idx" ON "operacao_equipamentos"("equipamento_id");

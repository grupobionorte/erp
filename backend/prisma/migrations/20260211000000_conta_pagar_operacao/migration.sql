-- Conta a pagar pode pertencer a uma operação (despesa da operação) ou a
-- nenhuma (despesa geral da empresa).
ALTER TABLE "contas_pagar" ADD COLUMN "operacao_id" INTEGER
  REFERENCES "operacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "contas_pagar_operacao_id_idx" ON "contas_pagar"("operacao_id");

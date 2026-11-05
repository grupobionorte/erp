-- Compra de diesel pode gerar as contas a pagar dela (uma por parcela).
ALTER TABLE "contas_pagar" ADD COLUMN "movimento_diesel_id" INTEGER;
CREATE INDEX "contas_pagar_movimento_diesel_id_idx" ON "contas_pagar"("movimento_diesel_id");
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_movimento_diesel_id_fkey" FOREIGN KEY ("movimento_diesel_id") REFERENCES "movimentos_diesel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

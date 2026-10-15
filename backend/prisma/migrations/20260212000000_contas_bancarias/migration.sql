-- Contas de onde sai o dinheiro dos pagamentos, e o vínculo da baixa da
-- conta a pagar com elas.
CREATE TABLE "contas_bancarias" (
  "id" SERIAL PRIMARY KEY,
  "nome" TEXT NOT NULL,
  "banco" TEXT,
  "agencia" TEXT,
  "numero" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "empresa_id" INTEGER REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "contas_bancarias_empresa_id_nome_idx" ON "contas_bancarias"("empresa_id", "nome");

ALTER TABLE "contas_pagar" ADD COLUMN "conta_bancaria_id" INTEGER
  REFERENCES "contas_bancarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "contas_pagar_conta_bancaria_id_idx" ON "contas_pagar"("conta_bancaria_id");

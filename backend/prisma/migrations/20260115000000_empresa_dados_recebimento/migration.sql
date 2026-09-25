-- Dados de recebimento do frete, usados no grupo de pagamento do MDF-e.
ALTER TABLE "empresas"
  ADD COLUMN "pix_recebimento" TEXT,
  ADD COLUMN "banco_numero" TEXT,
  ADD COLUMN "banco_agencia" TEXT;

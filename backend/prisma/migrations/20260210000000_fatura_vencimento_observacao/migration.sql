-- Vencimento e observação da fatura, que saem na impressão.
ALTER TABLE "faturas_operacao" ADD COLUMN "vencimento" TIMESTAMP(3);
ALTER TABLE "faturas_operacao" ADD COLUMN "observacao" TEXT;

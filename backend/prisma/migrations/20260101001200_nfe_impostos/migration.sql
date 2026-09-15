-- Campos de impostos da NFe (ICMS, ICMS ST, IPI e outras despesas).
ALTER TABLE "documentos_fiscais" ADD COLUMN "base_calculo_icms" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_icms" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "base_calculo_icms_st" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_icms_st" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "outras_despesas" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_ipi" DOUBLE PRECISION;

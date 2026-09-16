-- Tributação de PIS e COFINS por produto (situação tributária + alíquota).
ALTER TABLE "produtos" ADD COLUMN "pis_cst" TEXT;
ALTER TABLE "produtos" ADD COLUMN "pis_aliquota" DOUBLE PRECISION;
ALTER TABLE "produtos" ADD COLUMN "cofins_cst" TEXT;
ALTER TABLE "produtos" ADD COLUMN "cofins_aliquota" DOUBLE PRECISION;

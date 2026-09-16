-- Classificação tributária do IBS/CBS por produto (Reforma Tributária).
ALTER TABLE "produtos" ADD COLUMN "cst_ibs_cbs" TEXT;
ALTER TABLE "produtos" ADD COLUMN "classificacao_tributaria_ibs_cbs" TEXT;

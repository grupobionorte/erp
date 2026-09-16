-- Classificação tributária do IBS/CBS no nível do documento, pro CTe
-- (Reforma Tributária).
ALTER TABLE "documentos_fiscais" ADD COLUMN "cst_ibs_cbs_prestacao" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "classificacao_tributaria_ibs_cbs_prestacao" TEXT;

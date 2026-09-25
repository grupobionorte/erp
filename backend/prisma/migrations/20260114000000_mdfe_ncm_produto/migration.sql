-- NCM do produto predominante, exigido no MDF-e de carga lotação.
ALTER TABLE "documentos_fiscais" ADD COLUMN "ncm_produto_predominante" TEXT;

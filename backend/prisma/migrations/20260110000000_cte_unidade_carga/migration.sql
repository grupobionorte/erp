-- Unidade de medida da carga do CT-e e volume total em m³.
ALTER TABLE "documentos_fiscais"
  ADD COLUMN "unidade_medida_carga" TEXT,
  ADD COLUMN "volume_m3_total" DOUBLE PRECISION;

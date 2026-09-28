-- Guia Florestal (SISFLORA/SEMA-MT) vinculada à NF-e.
ALTER TABLE "documentos_fiscais"
  ADD COLUMN "gf_numero" TEXT,
  ADD COLUMN "gf_data_emissao" TIMESTAMP(3),
  ADD COLUMN "gf_validade" TIMESTAMP(3),
  ADD COLUMN "gf_data_recebimento" TIMESTAMP(3),
  ADD COLUMN "gf_observacao" TEXT;

CREATE INDEX "documentos_fiscais_gf_pendente_idx"
  ON "documentos_fiscais"("gf_validade")
  WHERE "gf_data_recebimento" IS NULL;

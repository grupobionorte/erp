-- Averbação automática do seguro de carga do CT-e na AT&M.
ALTER TABLE "documentos_fiscais"
  ADD COLUMN "xml_cancelamento_url" TEXT,
  ADD COLUMN "averbacao_situacao" TEXT,
  ADD COLUMN "averbacao_protocolo" TEXT,
  ADD COLUMN "averbacao_numero" TEXT,
  ADD COLUMN "averbacao_data" TIMESTAMP(3),
  ADD COLUMN "averbacao_mensagem" TEXT;

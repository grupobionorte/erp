-- Local de retirada da NF-e (grupo "retirada"), quando diferente do emitente.
ALTER TABLE "documentos_fiscais" ADD COLUMN "local_retirada_id" INTEGER
  REFERENCES "pessoas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

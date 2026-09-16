-- Campos de identificação do CTe: tipo de serviço, data/hora do
-- transporte, CT-e globalizado e tipo do CT-e.
ALTER TABLE "documentos_fiscais" ADD COLUMN "tipo_servico" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "data_transporte" TIMESTAMP(3);
ALTER TABLE "documentos_fiscais" ADD COLUMN "hora_transporte" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "cte_globalizado" BOOLEAN DEFAULT false;
ALTER TABLE "documentos_fiscais" ADD COLUMN "tipo_cte" TEXT;

-- Campos completos do CTe: remetente, expedidor, recebedor, definição do
-- tomador, distância, veículo reboque e tributação da prestação (ICMS).
ALTER TABLE "documentos_fiscais" ADD COLUMN "remetente_id" INTEGER;
ALTER TABLE "documentos_fiscais" ADD COLUMN "expedidor_id" INTEGER;
ALTER TABLE "documentos_fiscais" ADD COLUMN "recebedor_id" INTEGER;
ALTER TABLE "documentos_fiscais" ADD COLUMN "definicao_tomador" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "distancia_km" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "veiculo_reboque_id" INTEGER;
ALTER TABLE "documentos_fiscais" ADD COLUMN "cfop_prestacao" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "cst_icms_prestacao" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "base_calculo_icms_prestacao" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "aliquota_icms_prestacao" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "percentual_reducao_base_icms" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_icms_nao_tributado" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_icms_outras" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_credito_presumido_icms" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_fcp" DOUBLE PRECISION;

ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_remetente_id_fkey"
  FOREIGN KEY ("remetente_id") REFERENCES "pessoas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_expedidor_id_fkey"
  FOREIGN KEY ("expedidor_id") REFERENCES "pessoas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_recebedor_id_fkey"
  FOREIGN KEY ("recebedor_id") REFERENCES "pessoas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_veiculo_reboque_id_fkey"
  FOREIGN KEY ("veiculo_reboque_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

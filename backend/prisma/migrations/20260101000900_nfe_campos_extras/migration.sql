-- Mais campos de cabeçalho da NFe: finalidade, consumidor final,
-- presença do comprador, forma de pagamento, frete/seguro/desconto e
-- volumes.
ALTER TABLE "documentos_fiscais" ADD COLUMN "finalidade_operacao" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "consumidor_final" BOOLEAN DEFAULT false;
ALTER TABLE "documentos_fiscais" ADD COLUMN "indicador_presenca" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "forma_pagamento" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_frete" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_seguro" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "valor_desconto" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "quantidade_volumes" INTEGER;
ALTER TABLE "documentos_fiscais" ADD COLUMN "especie_volumes" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "peso_bruto_total" DOUBLE PRECISION;
ALTER TABLE "documentos_fiscais" ADD COLUMN "peso_liquido_total" DOUBLE PRECISION;

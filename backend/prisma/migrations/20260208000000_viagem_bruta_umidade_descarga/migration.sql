-- Quantidade bruta e umidade medidas na descarga da viagem.
ALTER TABLE "viagens_operacao" ADD COLUMN "quantidade_bruta_descarga" DOUBLE PRECISION;
ALTER TABLE "viagens_operacao" ADD COLUMN "umidade_descarga" DOUBLE PRECISION;

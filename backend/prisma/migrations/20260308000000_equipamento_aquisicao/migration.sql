-- Aquisição do equipamento: data, valor e % de depreciação ao ano.
ALTER TABLE "equipamentos"
  ADD COLUMN "data_aquisicao" TIMESTAMP(3),
  ADD COLUMN "valor_aquisicao" DOUBLE PRECISION,
  ADD COLUMN "percentual_depreciacao" DOUBLE PRECISION;

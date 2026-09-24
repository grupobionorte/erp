-- Descrição e anos do veículo.
ALTER TABLE "veiculos"
  ADD COLUMN "descricao" TEXT,
  ADD COLUMN "ano_fabricacao" INTEGER,
  ADD COLUMN "ano_modelo" INTEGER;

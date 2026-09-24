-- Capacidade em metros cúbicos: em biomassa o volume costuma limitar a
-- carga antes do peso.
ALTER TABLE "veiculos" ADD COLUMN "capacidade_m3" DOUBLE PRECISION;

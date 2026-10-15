-- Reboques atrelados ao cavalo mecânico (até 3).
ALTER TABLE "veiculos" ADD COLUMN "reboque1_id" INTEGER REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veiculos" ADD COLUMN "reboque2_id" INTEGER REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veiculos" ADD COLUMN "reboque3_id" INTEGER REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

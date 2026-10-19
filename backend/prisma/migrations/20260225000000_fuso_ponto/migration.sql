-- Fuso de cada batida e do tablet que a registrou: há tablet em local com
-- outro horário que o de Cuiabá. Coluna nova, nula nas batidas antigas; a
-- trigger de somente-inserção não é afetada (barra UPDATE e DELETE, não
-- ALTER TABLE).
ALTER TABLE "marcacoes_ponto" ADD COLUMN "fuso" TEXT;
ALTER TABLE "reps" ADD COLUMN "fuso" TEXT;

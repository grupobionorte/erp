-- Escala com folga fixa num dia da semana dentro do período de trabalho
-- (ex.: 25 dias no serviço com folga aos domingos e 5 dias em casa).
ALTER TABLE "jornadas_trabalho" ADD COLUMN "folga_semanal" INTEGER;

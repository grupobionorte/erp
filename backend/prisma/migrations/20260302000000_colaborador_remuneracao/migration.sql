-- Salário mensal e premiação por hora trabalhada do colaborador (R$).
ALTER TABLE "colaboradores" ADD COLUMN "salario" DOUBLE PRECISION;
ALTER TABLE "colaboradores" ADD COLUMN "premiacao_por_hora" DOUBLE PRECISION;

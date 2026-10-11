-- Serviços da operação (corte, enleiramento, traçamento, arraste, picagem,
-- transporte), cada um próprio ou terceirizado.
ALTER TABLE "operacoes" ADD COLUMN "servicos" JSONB NOT NULL DEFAULT '[]';

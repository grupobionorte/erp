-- Valor unitário da matéria-prima na operação: base do custo por viagem.
ALTER TABLE "operacoes" ADD COLUMN "valor_unitario_materia_prima" DOUBLE PRECISION;

-- Frete sobre a quantidade descarregada, usado no cálculo do lucro.
ALTER TABLE "viagens_operacao" ADD COLUMN "custo_transporte" DOUBLE PRECISION;

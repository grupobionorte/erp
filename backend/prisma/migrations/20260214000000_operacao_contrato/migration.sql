-- Período do contrato, pausa do serviço e tamanho do contrato (hectares e
-- previsão de toneladas e metros cúbicos).
ALTER TABLE "operacoes" ADD COLUMN "data_inicio_contrato" TIMESTAMP(3);
ALTER TABLE "operacoes" ADD COLUMN "data_fim_contrato" TIMESTAMP(3);
ALTER TABLE "operacoes" ADD COLUMN "servico_pausado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "operacoes" ADD COLUMN "hectares_contrato" DOUBLE PRECISION;
ALTER TABLE "operacoes" ADD COLUMN "previsao_toneladas" DOUBLE PRECISION;
ALTER TABLE "operacoes" ADD COLUMN "previsao_m3" DOUBLE PRECISION;

-- Escolha, por empresa, de mostrar o painel de folgas na Visão geral.
ALTER TABLE "empresas" ADD COLUMN "painel_folgas" BOOLEAN NOT NULL DEFAULT true;

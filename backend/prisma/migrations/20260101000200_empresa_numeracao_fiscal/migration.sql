-- Adiciona série e próximo número de NFe/CTe/MDFe em cada empresa,
-- suporte ao cadastro de Configurações (multi-empresa + numeração fiscal).
ALTER TABLE "empresas" ADD COLUMN "nfe_serie" TEXT;
ALTER TABLE "empresas" ADD COLUMN "nfe_proximo_numero" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "empresas" ADD COLUMN "cte_serie" TEXT;
ALTER TABLE "empresas" ADD COLUMN "cte_proximo_numero" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "empresas" ADD COLUMN "mdfe_serie" TEXT;
ALTER TABLE "empresas" ADD COLUMN "mdfe_proximo_numero" INTEGER NOT NULL DEFAULT 1;

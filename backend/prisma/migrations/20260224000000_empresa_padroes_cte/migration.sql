-- Padrões do CT-e no cadastro da empresa: situação tributária (CST) e
-- informações complementares que todo CT-e novo já traz preenchidos.
ALTER TABLE "empresas" ADD COLUMN "cst_padrao_cte" TEXT;
ALTER TABLE "empresas" ADD COLUMN "observacao_padrao_cte" TEXT;

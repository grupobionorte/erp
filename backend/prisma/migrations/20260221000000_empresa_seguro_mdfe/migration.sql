-- Seguro da carga no cadastro da empresa: o MDF-e já nasce com seguradora,
-- CNPJ e apólice em vez de pedir tudo a cada manifesto.
ALTER TABLE "empresas" ADD COLUMN "seguro_nome_seguradora" TEXT;
ALTER TABLE "empresas" ADD COLUMN "seguro_cnpj_seguradora" TEXT;
ALTER TABLE "empresas" ADD COLUMN "seguro_numero_apolice" TEXT;

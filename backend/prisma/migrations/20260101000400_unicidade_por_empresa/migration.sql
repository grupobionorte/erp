-- CPF/CNPJ e código de produto deixam de ser únicos pro sistema inteiro e
-- passam a ser únicos por empresa. Isso permite que duas empresas do grupo
-- tenham cada uma seu próprio cadastro do "mesmo" cliente/fornecedor/produto
-- sem dar conflito (era o que causava o erro ao cadastrar um cliente cujo
-- CNPJ já existia em outra empresa).

ALTER TABLE "pessoas" DROP CONSTRAINT IF EXISTS "pessoas_documento_key";
CREATE UNIQUE INDEX "pessoas_documento_empresa_id_key" ON "pessoas"("documento", "empresa_id");

ALTER TABLE "colaboradores" DROP CONSTRAINT IF EXISTS "colaboradores_cpf_key";
CREATE UNIQUE INDEX "colaboradores_cpf_empresa_id_key" ON "colaboradores"("cpf", "empresa_id");

ALTER TABLE "transportadoras" DROP CONSTRAINT IF EXISTS "transportadoras_cnpj_key";
CREATE UNIQUE INDEX "transportadoras_cnpj_empresa_id_key" ON "transportadoras"("cnpj", "empresa_id");

ALTER TABLE "produtos" DROP CONSTRAINT IF EXISTS "produtos_codigo_interno_key";
CREATE UNIQUE INDEX "produtos_codigo_interno_empresa_id_key" ON "produtos"("codigo_interno", "empresa_id");

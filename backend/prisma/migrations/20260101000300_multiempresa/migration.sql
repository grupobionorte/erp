-- Multi-empresa: cada cadastro (pessoas, colaboradores, transportadoras,
-- veiculos, produtos) passa a poder pertencer a uma empresa específica.
-- A coluna é opcional de propósito: registros criados antes dessa migration
-- ficam com empresa_id nulo e continuam aparecendo pra todo mundo até
-- serem migrados manualmente — nada some da noite pro dia.

ALTER TABLE "pessoas" ADD COLUMN "empresa_id" INTEGER;
ALTER TABLE "pessoas" ADD CONSTRAINT "pessoas_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "colaboradores" ADD COLUMN "empresa_id" INTEGER;
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transportadoras" ADD COLUMN "empresa_id" INTEGER;
ALTER TABLE "transportadoras" ADD CONSTRAINT "transportadoras_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "veiculos" ADD COLUMN "empresa_id" INTEGER;
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "produtos" ADD COLUMN "empresa_id" INTEGER;
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

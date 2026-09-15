-- Colaborador responsável pelo documento fiscal, e NCM/CST específicos
-- de cada item (podem diferir do padrão cadastrado no produto).
ALTER TABLE "documentos_fiscais" ADD COLUMN "colaborador_responsavel_id" INTEGER;
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_colaborador_responsavel_id_fkey"
  FOREIGN KEY ("colaborador_responsavel_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documento_itens" ADD COLUMN "ncm_utilizado" TEXT;
ALTER TABLE "documento_itens" ADD COLUMN "cst_utilizado" TEXT;

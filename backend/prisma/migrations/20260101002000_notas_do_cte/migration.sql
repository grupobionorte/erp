-- Vincula NFe(s) a um CTe (mesmo padrão já usado pro MDFe, numa coluna
-- separada — uma NFe pode estar num CTe e, depois, esse CTe num MDFe).
ALTER TABLE "documentos_fiscais" ADD COLUMN "cte_id" INTEGER;
ALTER TABLE "documentos_fiscais" ADD CONSTRAINT "documentos_fiscais_cte_id_fkey"
  FOREIGN KEY ("cte_id") REFERENCES "documentos_fiscais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

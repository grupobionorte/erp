-- Descrição do documento transportado do tipo "Outros": a SEFAZ exige
-- descOutros quando o tipo é 99 (grupo infOutros do CT-e).
ALTER TABLE "cte_documentos" ADD COLUMN "descricao_outros" TEXT;

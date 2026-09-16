-- Justificativa usada ao cancelar um documento já autorizado (exigida
-- pela SEFAZ, entre 15 e 255 caracteres).
ALTER TABLE "documentos_fiscais" ADD COLUMN "justificativa_cancelamento" TEXT;

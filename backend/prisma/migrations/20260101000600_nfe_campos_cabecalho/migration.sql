-- Campos de cabeçalho da NFe que faltavam pro cadastro ficar completo.
ALTER TABLE "documentos_fiscais" ADD COLUMN "natureza_operacao" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "modalidade_frete" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "data_saida" TIMESTAMP(3);
ALTER TABLE "documentos_fiscais" ADD COLUMN "informacoes_complementares" TEXT;

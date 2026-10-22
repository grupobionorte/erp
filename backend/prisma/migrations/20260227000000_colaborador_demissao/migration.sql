-- Situação do colaborador (ativo ou demitido) e data de demissão.
ALTER TABLE "colaboradores" ADD COLUMN "situacao" TEXT NOT NULL DEFAULT 'ativo';
ALTER TABLE "colaboradores" ADD COLUMN "data_demissao" TIMESTAMP(3);

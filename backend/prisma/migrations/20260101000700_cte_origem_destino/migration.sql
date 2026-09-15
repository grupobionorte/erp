-- Origem e destino do trajeto, usados no cadastro completo de CTe.
ALTER TABLE "documentos_fiscais" ADD COLUMN "origem_percurso" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "destino_percurso" TEXT;

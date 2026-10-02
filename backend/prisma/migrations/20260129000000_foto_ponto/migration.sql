-- Foto do momento da batida por PIN, com o resultado da conferência facial.
CREATE TABLE "fotos_ponto" (
  "id"          SERIAL PRIMARY KEY,
  "imagem"      TEXT NOT NULL,
  "conferencia" TEXT NOT NULL DEFAULT 'sem-cadastro',
  "distancia"   DOUBLE PRECISION,
  "marcacao_id" INTEGER NOT NULL UNIQUE REFERENCES "marcacoes_ponto"("id") ON DELETE CASCADE,
  "criado_em"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "fotos_ponto_criado_em_idx" ON "fotos_ponto"("criado_em");

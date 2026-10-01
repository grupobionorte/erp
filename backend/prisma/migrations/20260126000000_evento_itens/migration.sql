-- Lista de verificação dos compromissos.
CREATE TABLE "evento_itens" (
  "id"        SERIAL PRIMARY KEY,
  "texto"     TEXT NOT NULL,
  "concluido" BOOLEAN NOT NULL DEFAULT false,
  "ordem"     INTEGER NOT NULL DEFAULT 0,
  "evento_id" INTEGER NOT NULL REFERENCES "eventos"("id") ON DELETE CASCADE
);
CREATE INDEX "evento_itens_evento_ordem_idx" ON "evento_itens"("evento_id", "ordem");

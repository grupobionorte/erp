-- Agenda: eventos e tarefas com responsáveis.
CREATE TABLE "eventos" (
  "id"            SERIAL PRIMARY KEY,
  "titulo"        TEXT NOT NULL,
  "descricao"     TEXT,
  "data"          TIMESTAMP(3) NOT NULL,
  "hora_inicio"   TEXT,
  "hora_fim"      TEXT,
  "dia_todo"      BOOLEAN NOT NULL DEFAULT true,
  "status"        TEXT NOT NULL DEFAULT 'pendente',
  "prioridade"    TEXT NOT NULL DEFAULT 'normal',
  "local"         TEXT,
  "tipo"          TEXT,
  "concluido_em"  TIMESTAMP(3),
  "concluido_por" INTEGER,
  "criado_por_id" INTEGER REFERENCES "colaboradores"("id"),
  "empresa_id"    INTEGER REFERENCES "empresas"("id"),
  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "eventos_empresa_data_idx" ON "eventos"("empresa_id", "data");

CREATE TABLE "evento_responsaveis" (
  "id"             SERIAL PRIMARY KEY,
  "evento_id"      INTEGER NOT NULL REFERENCES "eventos"("id") ON DELETE CASCADE,
  "colaborador_id" INTEGER NOT NULL REFERENCES "colaboradores"("id"),
  CONSTRAINT "evento_responsaveis_unico" UNIQUE ("evento_id", "colaborador_id")
);

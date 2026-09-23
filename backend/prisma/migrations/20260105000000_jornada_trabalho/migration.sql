-- Jornada de trabalho por colaborador, com vigência.
CREATE TABLE "jornadas_trabalho" (
  "id"                     SERIAL PRIMARY KEY,
  "tipo"                   TEXT NOT NULL DEFAULT 'escala',
  "colaborador_id"         INTEGER NOT NULL REFERENCES "colaboradores"("id"),
  "vigencia_inicio"        TIMESTAMP(3) NOT NULL,
  "vigencia_fim"           TIMESTAMP(3),
  "tolerancia_minutos"     INTEGER NOT NULL DEFAULT 10,
  "dias_trabalho"          INTEGER,
  "dias_folga"             INTEGER,
  "deslocamento_por_ciclo" INTEGER NOT NULL DEFAULT 0,
  "data_referencia"        TIMESTAMP(3),
  "entrada"                TEXT,
  "intervalo_inicio"       TEXT,
  "intervalo_fim"          TEXT,
  "saida"                  TEXT,
  "criado_em"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "jornadas_trabalho_colaborador_idx" ON "jornadas_trabalho"("colaborador_id", "vigencia_inicio");

CREATE TABLE "jornadas_dias" (
  "id"               SERIAL PRIMARY KEY,
  "jornada_id"       INTEGER NOT NULL REFERENCES "jornadas_trabalho"("id") ON DELETE CASCADE,
  "dia_semana"       INTEGER NOT NULL,
  "folga"            BOOLEAN NOT NULL DEFAULT false,
  "entrada"          TEXT,
  "intervalo_inicio" TEXT,
  "intervalo_fim"    TEXT,
  "saida"            TEXT,
  CONSTRAINT "jornadas_dias_jornada_dia_key" UNIQUE ("jornada_id", "dia_semana")
);

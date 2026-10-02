-- Operações: frentes de trabalho, com período de vigência.
CREATE TABLE "operacoes" (
  "id"          SERIAL PRIMARY KEY,
  "codigo"      TEXT NOT NULL,
  "descricao"   TEXT NOT NULL,
  "data_inicio" TIMESTAMP(3),
  "data_fim"    TIMESTAMP(3),
  "ativo"       BOOLEAN NOT NULL DEFAULT true,
  "empresa_id"  INTEGER REFERENCES "empresas"("id"),
  "criado_em"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "operacoes_empresa_codigo_idx" ON "operacoes"("empresa_id", "codigo");

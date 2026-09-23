-- Controle de ponto (Portaria MTP 671/2021).
-- As marcações são somente-inserção: não há UPDATE nem DELETE previstos na
-- aplicação, e a trigger abaixo impede que isso aconteça direto no banco.

CREATE TABLE "reps" (
  "id"            SERIAL PRIMARY KEY,
  "identificador" TEXT NOT NULL UNIQUE,
  "token"         TEXT NOT NULL UNIQUE,
  "descricao"     TEXT,
  "localizacao"   TEXT,
  "ultimo_nsr"    INTEGER NOT NULL DEFAULT 0,
  "ativo"         BOOLEAN NOT NULL DEFAULT true,
  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "empresa_id"    INTEGER REFERENCES "empresas"("id")
);

CREATE TABLE "marcacoes_ponto" (
  "id"                   SERIAL PRIMARY KEY,
  "nsr"                  INTEGER NOT NULL,
  "rep_id"               INTEGER NOT NULL REFERENCES "reps"("id"),
  "cpf"                  TEXT NOT NULL,
  "data_hora"            TIMESTAMP(3) NOT NULL,
  "colaborador_id"       INTEGER NOT NULL REFERENCES "colaboradores"("id"),
  "metodo_identificacao" TEXT NOT NULL,
  "origem_offline"       BOOLEAN NOT NULL DEFAULT false,
  "sincronizado_em"      TIMESTAMP(3),
  "id_local"             TEXT NOT NULL UNIQUE,
  "hash_anterior"        TEXT,
  "hash"                 TEXT NOT NULL,
  "criado_em"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marcacoes_ponto_rep_nsr_key" UNIQUE ("rep_id", "nsr")
);
CREATE INDEX "marcacoes_ponto_colaborador_data_idx" ON "marcacoes_ponto"("colaborador_id", "data_hora");

-- Nem a aplicação nem um acesso direto ao banco alteram uma batida.
CREATE OR REPLACE FUNCTION impedir_alteracao_marcacao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Marcação de ponto não pode ser alterada nem removida (Portaria 671/2021). Registre um tratamento.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marcacoes_ponto_somente_insercao
  BEFORE UPDATE OR DELETE ON "marcacoes_ponto"
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_marcacao();

CREATE TABLE "tratamentos_ponto" (
  "id"             SERIAL PRIMARY KEY,
  "tipo"           TEXT NOT NULL,
  "data_hora"      TIMESTAMP(3) NOT NULL,
  "motivo"         TEXT NOT NULL,
  "criado_em"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "colaborador_id" INTEGER NOT NULL REFERENCES "colaboradores"("id"),
  "marcacao_id"    INTEGER REFERENCES "marcacoes_ponto"("id"),
  "autor_id"       INTEGER REFERENCES "usuarios"("id")
);
CREATE INDEX "tratamentos_ponto_colaborador_data_idx" ON "tratamentos_ponto"("colaborador_id", "data_hora");

CREATE TABLE "biometrias_faciais" (
  "id"                  SERIAL PRIMARY KEY,
  "colaborador_id"      INTEGER NOT NULL UNIQUE REFERENCES "colaboradores"("id"),
  "vetor"               JSONB NOT NULL,
  "versao_modelo"       TEXT NOT NULL,
  "consentimento_em"    TIMESTAMP(3) NOT NULL,
  "consentimento_texto" TEXT NOT NULL,
  "atualizado_em"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "colaboradores" ADD COLUMN "pin_ponto_hash" TEXT;

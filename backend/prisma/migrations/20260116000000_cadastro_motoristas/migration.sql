-- Cadastro próprio de motoristas. Separado de colaboradores porque boa parte
-- dos motoristas é de caminhão agregado ou de terceiro, sem vínculo com a
-- empresa e fora do controle de ponto.
CREATE TABLE "motoristas" (
  "id"               SERIAL PRIMARY KEY,
  "nome"             TEXT NOT NULL,
  "cpf"              TEXT NOT NULL,
  "vinculo"          TEXT NOT NULL DEFAULT 'terceiro',
  "cnh"              TEXT,
  "categoria_cnh"    TEXT,
  "validade_cnh"     TIMESTAMP(3),
  "telefone"         TEXT,
  "colaborador_id"   INTEGER UNIQUE REFERENCES "colaboradores"("id"),
  "transportadora_id" INTEGER REFERENCES "transportadoras"("id"),
  "empresa_id"       INTEGER REFERENCES "empresas"("id"),
  "ativo"            BOOLEAN NOT NULL DEFAULT true,
  "observacao"       TEXT,
  "criado_em"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "motoristas_empresa_nome_idx" ON "motoristas"("empresa_id", "nome");

-- O motorista do veículo passa a apontar para o cadastro novo.
ALTER TABLE "veiculos" DROP CONSTRAINT IF EXISTS "veiculos_motorista_id_fkey";
ALTER TABLE "veiculos"
  ADD CONSTRAINT "veiculos_motorista_id_fkey"
  FOREIGN KEY ("motorista_id") REFERENCES "motoristas"("id");

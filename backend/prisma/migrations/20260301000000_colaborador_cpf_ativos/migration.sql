-- CPF único por empresa só entre colaboradores ativos. O cadastro excluído
-- (ativo = false) continua no banco — tem batidas de ponto e documentos —,
-- mas não pode impedir que a mesma pessoa seja cadastrada de novo.
DROP INDEX IF EXISTS "colaboradores_cpf_empresa_id_key";
CREATE UNIQUE INDEX "colaboradores_cpf_empresa_id_ativos_key"
  ON "colaboradores"("cpf", "empresa_id") WHERE "ativo";
CREATE INDEX IF NOT EXISTS "colaboradores_cpf_empresa_id_idx" ON "colaboradores"("cpf", "empresa_id");

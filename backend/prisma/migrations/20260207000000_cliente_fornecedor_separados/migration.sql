-- Cliente e fornecedor passam a ser cadastros separados, mesmo com o mesmo
-- CPF/CNPJ. Antes era um registro só com as duas marcações, e editar o
-- fornecedor alterava o cliente (e excluir um desativava o outro).

-- 1. Cada registro ganha um papel só.
ALTER TABLE "pessoas" ADD COLUMN "papel" TEXT;
UPDATE "pessoas" SET "papel" = CASE WHEN "e_cliente" THEN 'cliente' ELSE 'fornecedor' END;

-- 2. O CPF/CNPJ continua único, mas por empresa E por papel. A regra antiga
--    sai antes da divisão abaixo: com ela, a cópia de fornecedor com o
--    mesmo CNPJ do cliente seria recusada.
DROP INDEX IF EXISTS "pessoas_documento_empresa_id_key";
CREATE UNIQUE INDEX "pessoas_documento_empresa_id_papel_key" ON "pessoas"("documento", "empresa_id", "papel");

-- 3. Quem era as duas coisas é dividido em dois. O registro original fica
--    como cliente, com os documentos fiscais já emitidos. A cópia vira o
--    fornecedor, com endereço próprio, e leva junto o que é de fornecedor:
--    contas a pagar e operações.
DO $$
DECLARE
  original RECORD;
  novo_endereco INTEGER;
  novo_fornecedor INTEGER;
BEGIN
  FOR original IN SELECT * FROM "pessoas" WHERE "e_cliente" AND "e_fornecedor" LOOP
    novo_endereco := NULL;
    IF original."endereco_id" IS NOT NULL THEN
      INSERT INTO "enderecos" ("cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "codigo_ibge_cidade")
      SELECT "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "codigo_ibge_cidade"
      FROM "enderecos" WHERE "id" = original."endereco_id"
      RETURNING "id" INTO novo_endereco;
    END IF;

    INSERT INTO "pessoas" (
      "tipo", "nome_razao_social", "nome_fantasia", "documento", "ie", "ie_isento", "indicador_ie",
      "telefone", "email", "e_cliente", "e_fornecedor", "ativo", "criado_em", "observacao_padrao",
      "endereco_id", "empresa_id", "papel"
    ) VALUES (
      original."tipo", original."nome_razao_social", original."nome_fantasia", original."documento",
      original."ie", original."ie_isento", original."indicador_ie", original."telefone", original."email",
      false, true, original."ativo", original."criado_em", original."observacao_padrao",
      novo_endereco, original."empresa_id", 'fornecedor'
    )
    RETURNING "id" INTO novo_fornecedor;

    UPDATE "contas_pagar" SET "fornecedor_id" = novo_fornecedor WHERE "fornecedor_id" = original."id";
    UPDATE "operacoes" SET "fornecedor_id" = novo_fornecedor WHERE "fornecedor_id" = original."id";
    UPDATE "pessoas" SET "e_fornecedor" = false WHERE "id" = original."id";
  END LOOP;
END $$;

ALTER TABLE "pessoas" ALTER COLUMN "papel" SET NOT NULL;

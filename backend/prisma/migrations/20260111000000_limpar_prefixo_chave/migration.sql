-- Chaves gravadas com o prefixo do provedor ("CTe123...", "NFe123...").
-- A SEFAZ e qualquer portal de consulta esperam só os 44 dígitos.
-- A classe [^0-9] evita barra invertida, que muda de significado conforme a
-- configuração de escape do banco.
UPDATE "documentos_fiscais"
   SET "chave_acesso" = regexp_replace("chave_acesso", '[^0-9]', '', 'g')
 WHERE "chave_acesso" IS NOT NULL
   AND "chave_acesso" ~ '[^0-9]';

UPDATE "cte_documentos"
   SET "chave_acesso" = regexp_replace("chave_acesso", '[^0-9]', '', 'g')
 WHERE "chave_acesso" IS NOT NULL
   AND "chave_acesso" ~ '[^0-9]';

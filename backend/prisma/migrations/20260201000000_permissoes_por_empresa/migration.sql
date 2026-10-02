-- Menus liberados por usuário E por empresa: a mesma pessoa pode ter
-- acessos diferentes em cada empresa do grupo.
CREATE TABLE "usuario_empresa_permissoes" (
  "id"         SERIAL PRIMARY KEY,
  "menus"      TEXT[] NOT NULL DEFAULT '{}',
  "usuario_id" INTEGER NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
  "empresa_id" INTEGER NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
  CONSTRAINT "usuario_empresa_permissoes_unico" UNIQUE ("usuario_id", "empresa_id")
);

-- Quem já tinha permissões globais começa com elas em todas as empresas a
-- que tem acesso: a troca de modelo não deveria tirar acesso de ninguém.
-- Na tabela de vínculo, A é a empresa e B é o usuário.
INSERT INTO "usuario_empresa_permissoes" ("usuario_id", "empresa_id", "menus")
SELECT ue."B", ue."A", u."permissoes"
  FROM "usuarios" u
  JOIN "_UsuarioEmpresas" ue ON ue."B" = u."id"
 WHERE array_length(u."permissoes", 1) > 0
ON CONFLICT DO NOTHING;

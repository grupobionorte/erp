-- Menus liberados por usuário. Vazio significa todos, para não trancar
-- quem já estava cadastrado.
ALTER TABLE "usuarios" ADD COLUMN "permissoes" TEXT[] NOT NULL DEFAULT '{}';

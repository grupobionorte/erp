-- Vincula o login (usuário) à ficha de colaborador.
-- Único: um colaborador tem no máximo um usuário.
ALTER TABLE "usuarios" ADD COLUMN "colaborador_id" INTEGER;

CREATE UNIQUE INDEX "usuarios_colaborador_id_key" ON "usuarios"("colaborador_id");

ALTER TABLE "usuarios"
  ADD CONSTRAINT "usuarios_colaborador_id_fkey"
  FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

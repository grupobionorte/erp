-- Tabela de ligação usuário <-> empresas que ele pode acessar. Gerada no
-- formato que o Prisma usa pra relação muitos-para-muitos implícita
-- ("_UsuarioEmpresas"): duas colunas, uma FK pra cada lado, PK composta.
CREATE TABLE "_UsuarioEmpresas" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_UsuarioEmpresas_A_fkey" FOREIGN KEY ("A") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_UsuarioEmpresas_B_fkey" FOREIGN KEY ("B") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "_UsuarioEmpresas_AB_unique" ON "_UsuarioEmpresas"("A", "B");
CREATE INDEX "_UsuarioEmpresas_B_index" ON "_UsuarioEmpresas"("B");

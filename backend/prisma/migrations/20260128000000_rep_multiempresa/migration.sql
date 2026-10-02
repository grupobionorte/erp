-- Um tablet de ponto pode atender várias empresas do grupo.
CREATE TABLE "_RepEmpresas" (
  "A" INTEGER NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
  "B" INTEGER NOT NULL REFERENCES "reps"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "_RepEmpresas_AB_unique" ON "_RepEmpresas"("A", "B");
CREATE INDEX "_RepEmpresas_B_index" ON "_RepEmpresas"("B");

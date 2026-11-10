-- Equipamento próprio ou alugado. Os que já existem entram como próprios.
ALTER TABLE "equipamentos" ADD COLUMN "propriedade" TEXT NOT NULL DEFAULT 'proprio';

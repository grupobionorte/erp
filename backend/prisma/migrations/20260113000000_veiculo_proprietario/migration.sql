-- Propriedade do veículo e dados do proprietário, exigidos no MDF-e quando
-- o veículo não é da empresa emitente.
ALTER TABLE "veiculos"
  ADD COLUMN "propriedade" TEXT DEFAULT 'propria',
  ADD COLUMN "proprietario_documento" TEXT,
  ADD COLUMN "proprietario_nome" TEXT,
  ADD COLUMN "proprietario_ie" TEXT,
  ADD COLUMN "proprietario_uf" TEXT,
  ADD COLUMN "proprietario_rntrc" TEXT,
  ADD COLUMN "proprietario_tipo" TEXT,
  ADD COLUMN "tipo_transportador" TEXT;

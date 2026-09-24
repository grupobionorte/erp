-- Motorista habitual no cadastro do veículo.
ALTER TABLE "veiculos"
  ADD COLUMN "motorista_nome" TEXT,
  ADD COLUMN "motorista_cpf" TEXT;

-- Segundo e terceiro reboques (bitrem, rodotrem).
ALTER TABLE "documentos_fiscais"
  ADD COLUMN "veiculo_reboque2_id" INTEGER REFERENCES "veiculos"("id"),
  ADD COLUMN "veiculo_reboque3_id" INTEGER REFERENCES "veiculos"("id");

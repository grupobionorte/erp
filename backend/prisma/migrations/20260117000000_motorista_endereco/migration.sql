-- Endereço completo do motorista.
ALTER TABLE "motoristas"
  ADD COLUMN "endereco_id" INTEGER REFERENCES "enderecos"("id");

-- Motorista do veículo passa a vir do cadastro de colaboradores.
ALTER TABLE "veiculos"
  ADD COLUMN "motorista_id" INTEGER REFERENCES "colaboradores"("id");

-- Transportadora deixa de ser obrigatória: a frota é própria, e o campo
-- fica reservado para subcontratação futura.
ALTER TABLE "veiculos" ALTER COLUMN "transportadora_id" DROP NOT NULL;

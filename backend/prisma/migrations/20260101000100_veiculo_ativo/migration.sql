-- Adiciona o campo "ativo" em veiculos, pra permitir exclusão lógica
-- (igual já é feito em pessoas, colaboradores, transportadoras e produtos)
-- sem perder o vínculo com documentos fiscais que já usaram esse veículo.
ALTER TABLE "veiculos" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;

-- Fornecedor da matéria-prima da operação.
ALTER TABLE "operacoes" ADD COLUMN "fornecedor_id" INTEGER REFERENCES "pessoas"("id");

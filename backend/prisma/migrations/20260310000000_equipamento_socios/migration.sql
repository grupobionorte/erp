-- Equipamento em sociedade: os sócios (fornecedores) e o percentual de cada um.
CREATE TABLE "equipamento_socios" (
    "id" SERIAL NOT NULL,
    "percentual" DOUBLE PRECISION NOT NULL,
    "equipamento_id" INTEGER NOT NULL,
    "fornecedor_id" INTEGER NOT NULL,
    CONSTRAINT "equipamento_socios_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "equipamento_socios_equipamento_id_idx" ON "equipamento_socios"("equipamento_id");
ALTER TABLE "equipamento_socios" ADD CONSTRAINT "equipamento_socios_equipamento_id_fkey" FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equipamento_socios" ADD CONSTRAINT "equipamento_socios_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

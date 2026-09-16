-- Tabela de municípios (código IBGE + nome + UF) — busca por autocomplete
-- no CTe, igual já fazemos com NCM/CFOP. E os campos de UF separados no
-- documento, pra não depender mais de extrair a UF de um texto livre tipo
-- "Cidade/UF" (fonte de bug: nem todo mundo digita no mesmo formato).
CREATE TABLE "municipios" (
    "id" SERIAL NOT NULL,
    "codigo_ibge" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "uf" TEXT NOT NULL,

    CONSTRAINT "municipios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "municipios_codigo_ibge_key" ON "municipios"("codigo_ibge");
CREATE INDEX "municipios_uf_nome_idx" ON "municipios"("uf", "nome");

ALTER TABLE "documentos_fiscais" ADD COLUMN "uf_inicio" TEXT;
ALTER TABLE "documentos_fiscais" ADD COLUMN "uf_fim" TEXT;

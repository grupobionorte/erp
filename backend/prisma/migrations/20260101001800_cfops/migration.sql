-- Tabela de CFOP (Código Fiscal de Operações e Prestações) — busca por
-- autocomplete no cadastro de produtos, igual já fazemos com NCM.
CREATE TABLE "cfops" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,

    CONSTRAINT "cfops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cfops_codigo_key" ON "cfops"("codigo");

-- Substitui o vínculo simples (só chave) por uma tabela de verdade com
-- todos os campos da tela "Dados das mercadorias" do CTe.

-- Remove o vínculo antigo, mais simples.
ALTER TABLE "documentos_fiscais" DROP CONSTRAINT IF EXISTS "documentos_fiscais_cte_id_fkey";
ALTER TABLE "documentos_fiscais" DROP COLUMN IF EXISTS "cte_id";

CREATE TABLE "cte_documentos" (
    "id" SERIAL NOT NULL,
    "cte_id" INTEGER NOT NULL,
    "nota_fiscal_id" INTEGER,
    "tipo" TEXT NOT NULL DEFAULT 'Fiscal',
    "chave_acesso" TEXT,
    "numero_documento" TEXT,
    "modelo" TEXT,
    "serie" TEXT,
    "cfop_predominante" TEXT,
    "data_emissao" TIMESTAMP(3),
    "natureza_mercadoria" TEXT,
    "outras_caracteristicas_carga" TEXT,
    "base_calculo_icms" DOUBLE PRECISION,
    "valor_icms" DOUBLE PRECISION,
    "base_calculo_icms_st" DOUBLE PRECISION,
    "valor_icms_st" DOUBLE PRECISION,
    "valor_total_produtos" DOUBLE PRECISION,
    "valor_total_nota" DOUBLE PRECISION,
    "peso_bruto" DOUBLE PRECISION,
    "m3" DOUBLE PRECISION,
    "quantidade_volumes" DOUBLE PRECISION,
    "peso_liquido" DOUBLE PRECISION,
    "pin_suframa" TEXT,
    "numero_pedido" TEXT,
    "numero_romaneio" TEXT,
    "valor_carga_averbacao" DOUBLE PRECISION,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cte_documentos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "cte_documentos" ADD CONSTRAINT "cte_documentos_cte_id_fkey"
  FOREIGN KEY ("cte_id") REFERENCES "documentos_fiscais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cte_documentos" ADD CONSTRAINT "cte_documentos_nota_fiscal_id_fkey"
  FOREIGN KEY ("nota_fiscal_id") REFERENCES "documentos_fiscais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

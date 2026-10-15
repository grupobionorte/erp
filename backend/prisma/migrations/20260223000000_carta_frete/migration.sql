-- Carta frete: contrato/recibo do frete pago ao proprietário do veículo,
-- emitido a partir do CT-e. Numeração própria por empresa.
ALTER TABLE "veiculos" ADD COLUMN "proprietario_endereco" TEXT;
ALTER TABLE "veiculos" ADD COLUMN "proprietario_municipio" TEXT;
ALTER TABLE "empresas" ADD COLUMN "carta_frete_proximo_numero" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "cartas_frete" (
    "id" SERIAL NOT NULL,
    "numero" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'emitida',
    "data_emissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "empresa_id" INTEGER NOT NULL,
    "cte_id" INTEGER NOT NULL,
    "dados" JSONB NOT NULL,
    "peso_toneladas" DOUBLE PRECISION NOT NULL,
    "valor_por_tonelada" DOUBLE PRECISION NOT NULL,
    "valor_documento" DOUBLE PRECISION NOT NULL,
    "valor_liquido" DOUBLE PRECISION NOT NULL,
    "adiantamento" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adiantamento_pedagio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outros_creditos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "seguro" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pedagio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estadia" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outros_debitos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "irrf" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outras_entidades" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comissao_fixa" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comissao_variavel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "criado_por_id" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cartas_frete_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cartas_frete_empresa_id_numero_key" ON "cartas_frete"("empresa_id", "numero");
CREATE INDEX "cartas_frete_cte_id_idx" ON "cartas_frete"("cte_id");

ALTER TABLE "cartas_frete" ADD CONSTRAINT "cartas_frete_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cartas_frete" ADD CONSTRAINT "cartas_frete_cte_id_fkey" FOREIGN KEY ("cte_id") REFERENCES "documentos_fiscais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

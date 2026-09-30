-- Categorias de despesa.
CREATE TABLE "categorias_despesa" (
  "id"         SERIAL PRIMARY KEY,
  "nome"       TEXT NOT NULL,
  "ativo"      BOOLEAN NOT NULL DEFAULT true,
  "empresa_id" INTEGER REFERENCES "empresas"("id")
);
CREATE INDEX "categorias_despesa_empresa_nome_idx" ON "categorias_despesa"("empresa_id", "nome");

-- Centros de custo, podendo apontar para um veículo.
CREATE TABLE "centros_custo" (
  "id"         SERIAL PRIMARY KEY,
  "nome"       TEXT NOT NULL,
  "ativo"      BOOLEAN NOT NULL DEFAULT true,
  "veiculo_id" INTEGER REFERENCES "veiculos"("id"),
  "empresa_id" INTEGER REFERENCES "empresas"("id")
);
CREATE INDEX "centros_custo_empresa_nome_idx" ON "centros_custo"("empresa_id", "nome");

-- Contas a pagar. Cada parcela ou mês recorrente é um registro próprio.
CREATE TABLE "contas_pagar" (
  "id"              SERIAL PRIMARY KEY,
  "descricao"       TEXT NOT NULL,
  "valor"           DOUBLE PRECISION NOT NULL,
  "vencimento"      TIMESTAMP(3) NOT NULL,
  "competencia"     TIMESTAMP(3),
  "status"          TEXT NOT NULL DEFAULT 'aberta',
  "data_pagamento"  TIMESTAMP(3),
  "valor_pago"      DOUBLE PRECISION,
  "juros_multa"     DOUBLE PRECISION,
  "desconto"        DOUBLE PRECISION,
  "forma_pagamento" TEXT,
  "documento"       TEXT,
  "observacao"      TEXT,
  "fornecedor_id"   INTEGER REFERENCES "pessoas"("id"),
  "categoria_id"    INTEGER REFERENCES "categorias_despesa"("id"),
  "centro_custo_id" INTEGER REFERENCES "centros_custo"("id"),
  "grupo"           TEXT,
  "parcela_numero"  INTEGER,
  "parcela_total"   INTEGER,
  "empresa_id"      INTEGER REFERENCES "empresas"("id"),
  "criado_em"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "contas_pagar_empresa_status_venc_idx"
  ON "contas_pagar"("empresa_id", "status", "vencimento");

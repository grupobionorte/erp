-- Boletim de produção da operação e controle de diesel (tanques e
-- movimentos: entrada, saída e ajuste). A saída gerada pelo boletim aponta
-- para a linha dele e some junto com ela.
CREATE TABLE "tanques_diesel" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "capacidade_litros" DOUBLE PRECISION,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "empresa_id" INTEGER NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tanques_diesel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "producoes_operacao" (
    "id" SERIAL NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "turno" INTEGER NOT NULL DEFAULT 1,
    "servico" TEXT NOT NULL,
    "operacao_id" INTEGER NOT NULL,
    "equipamento_id" INTEGER NOT NULL,
    "colaborador_id" INTEGER,
    "leitura_inicial" DOUBLE PRECISION,
    "leitura_final" DOUBLE PRECISION,
    "trabalhado" DOUBLE PRECISION,
    "quantidade" DOUBLE PRECISION,
    "unidade" TEXT,
    "horas_paradas" DOUBLE PRECISION,
    "motivo_parada" TEXT,
    "observacao" TEXT,
    "criado_por_id" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "producoes_operacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "movimentos_diesel" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "litros" DOUBLE PRECISION NOT NULL,
    "valor_litro" DOUBLE PRECISION,
    "valor_total" DOUBLE PRECISION,
    "fornecedor_id" INTEGER,
    "documento" TEXT,
    "equipamento_id" INTEGER,
    "operacao_id" INTEGER,
    "destino" TEXT,
    "producao_id" INTEGER,
    "observacao" TEXT,
    "tanque_id" INTEGER NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "criado_por_id" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movimentos_diesel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tanques_diesel_empresa_id_idx" ON "tanques_diesel"("empresa_id");
CREATE INDEX "producoes_operacao_operacao_id_data_idx" ON "producoes_operacao"("operacao_id", "data");
-- Uma linha por máquina, por dia e turno.
CREATE UNIQUE INDEX "producoes_operacao_equipamento_id_data_turno_key" ON "producoes_operacao"("equipamento_id", "data", "turno");
CREATE UNIQUE INDEX "movimentos_diesel_producao_id_key" ON "movimentos_diesel"("producao_id");
CREATE INDEX "movimentos_diesel_empresa_id_data_idx" ON "movimentos_diesel"("empresa_id", "data");
CREATE INDEX "movimentos_diesel_tanque_id_idx" ON "movimentos_diesel"("tanque_id");

ALTER TABLE "tanques_diesel" ADD CONSTRAINT "tanques_diesel_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "producoes_operacao" ADD CONSTRAINT "producoes_operacao_operacao_id_fkey" FOREIGN KEY ("operacao_id") REFERENCES "operacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "producoes_operacao" ADD CONSTRAINT "producoes_operacao_equipamento_id_fkey" FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "producoes_operacao" ADD CONSTRAINT "producoes_operacao_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimentos_diesel" ADD CONSTRAINT "movimentos_diesel_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "pessoas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimentos_diesel" ADD CONSTRAINT "movimentos_diesel_equipamento_id_fkey" FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimentos_diesel" ADD CONSTRAINT "movimentos_diesel_operacao_id_fkey" FOREIGN KEY ("operacao_id") REFERENCES "operacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "movimentos_diesel" ADD CONSTRAINT "movimentos_diesel_producao_id_fkey" FOREIGN KEY ("producao_id") REFERENCES "producoes_operacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movimentos_diesel" ADD CONSTRAINT "movimentos_diesel_tanque_id_fkey" FOREIGN KEY ("tanque_id") REFERENCES "tanques_diesel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimentos_diesel" ADD CONSTRAINT "movimentos_diesel_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Campos do MDFe: carregamento/descarregamento com código IBGE, dados da
-- carga, seguro (obrigatório no modal rodoviário) e encerramento.
ALTER TABLE "documentos_fiscais"
  ADD COLUMN "municipio_carregamento" TEXT,
  ADD COLUMN "codigo_municipio_carregamento" TEXT,
  ADD COLUMN "municipio_descarregamento" TEXT,
  ADD COLUMN "codigo_municipio_descarregamento" TEXT,
  ADD COLUMN "tipo_carga" TEXT,
  ADD COLUMN "produto_predominante" TEXT,
  ADD COLUMN "unidade_medida_peso" TEXT,
  ADD COLUMN "peso_bruto_carga" DOUBLE PRECISION,
  ADD COLUMN "valor_total_carga" DOUBLE PRECISION,
  ADD COLUMN "seguro_responsavel" TEXT,
  ADD COLUMN "seguro_nome_seguradora" TEXT,
  ADD COLUMN "seguro_cnpj_seguradora" TEXT,
  ADD COLUMN "seguro_numero_apolice" TEXT,
  ADD COLUMN "seguro_numero_averbacao" TEXT,
  ADD COLUMN "tipo_emitente_mdfe" TEXT,
  ADD COLUMN "ciot" TEXT,
  ADD COLUMN "data_encerramento" TIMESTAMP(3),
  ADD COLUMN "municipio_encerramento" TEXT,
  ADD COLUMN "codigo_municipio_encerramento" TEXT;

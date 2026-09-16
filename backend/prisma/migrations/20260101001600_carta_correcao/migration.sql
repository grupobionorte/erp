-- Carta de Correção Eletrônica (CC-e) — histórico de correções por
-- documento fiscal.
CREATE TABLE "cartas_correcao" (
    "id" SERIAL NOT NULL,
    "documento_id" INTEGER NOT NULL,
    "numero_sequencial" INTEGER,
    "texto" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "motivo_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cartas_correcao_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "cartas_correcao" ADD CONSTRAINT "cartas_correcao_documento_id_fkey"
  FOREIGN KEY ("documento_id") REFERENCES "documentos_fiscais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

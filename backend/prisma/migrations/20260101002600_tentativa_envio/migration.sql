-- Contador de tentativas de envio ao provedor.
-- Os documentos já existentes ficam com 1, que mantém a referência atual
-- (ex.: "cte-2"), então nada que já foi autorizado muda de ref.
ALTER TABLE "documentos_fiscais"
  ADD COLUMN "tentativa_envio" INTEGER NOT NULL DEFAULT 1;

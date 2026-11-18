-- XML do evento da carta de correção, devolvido pela Focus no registro. No
-- CT-e a Focus não gera PDF da carta: a impressão é do sistema, com o
-- protocolo e a data do registro lidos desse XML.
ALTER TABLE "cartas_correcao" ADD COLUMN "xml_url" TEXT;

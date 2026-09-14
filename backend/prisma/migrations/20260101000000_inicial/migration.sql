-- Migration inicial: cria todas as tabelas do ERP. Escrita manualmente porque
-- o schema.prisma foi editado diretamente ao longo do projeto sem nunca
-- rodar `prisma migrate dev` contra um banco de verdade — então essa pasta
-- estava vazia e o "prisma migrate deploy" no Render não tinha nada a
-- aplicar. Esta migration corrige isso, criando o banco do zero.

-- Enums
CREATE TYPE "TipoPessoa" AS ENUM ('pessoa_fisica', 'pessoa_juridica');
CREATE TYPE "RegimeTributario" AS ENUM ('simples_nacional', 'lucro_presumido', 'lucro_real');
CREATE TYPE "TipoDocumentoFiscal" AS ENUM ('NFe', 'CTe', 'MDFe');
CREATE TYPE "StatusDocumentoFiscal" AS ENUM ('rascunho', 'enviado', 'autorizado', 'rejeitado', 'cancelado');
CREATE TYPE "TipoCertificado" AS ENUM ('A1', 'A3');
CREATE TYPE "PapelUsuario" AS ENUM ('admin', 'operador');

-- usuarios
CREATE TABLE "usuarios" (
    "id" SERIAL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "senha_hash" TEXT NOT NULL,
    "papel" "PapelUsuario" NOT NULL DEFAULT 'operador',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ncms
CREATE TABLE "ncms" (
    "id" SERIAL PRIMARY KEY,
    "codigo" TEXT NOT NULL UNIQUE,
    "descricao" TEXT NOT NULL
);

-- enderecos
CREATE TABLE "enderecos" (
    "id" SERIAL PRIMARY KEY,
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "codigo_ibge_cidade" TEXT
);

-- certificados_digitais
CREATE TABLE "certificados_digitais" (
    "id" SERIAL PRIMARY KEY,
    "tipo" "TipoCertificado" NOT NULL,
    "validade_inicio" TIMESTAMP(3),
    "validade_fim" TIMESTAMP(3),
    "armazenado_em" TEXT
);

-- empresas
CREATE TABLE "empresas" (
    "id" SERIAL PRIMARY KEY,
    "razao_social" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "cnpj" TEXT NOT NULL UNIQUE,
    "ie" TEXT,
    "im" TEXT,
    "regime_tributario" "RegimeTributario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "endereco_id" INTEGER,
    "certificado_id" INTEGER,
    CONSTRAINT "empresas_endereco_id_fkey" FOREIGN KEY ("endereco_id") REFERENCES "enderecos"("id"),
    CONSTRAINT "empresas_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificados_digitais"("id")
);

-- pessoas
CREATE TABLE "pessoas" (
    "id" SERIAL PRIMARY KEY,
    "tipo" "TipoPessoa" NOT NULL,
    "nome_razao_social" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "documento" TEXT NOT NULL UNIQUE,
    "ie" TEXT,
    "ie_isento" BOOLEAN NOT NULL DEFAULT false,
    "telefone" TEXT,
    "email" TEXT,
    "e_cliente" BOOLEAN NOT NULL DEFAULT false,
    "e_fornecedor" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endereco_id" INTEGER,
    CONSTRAINT "pessoas_endereco_id_fkey" FOREIGN KEY ("endereco_id") REFERENCES "enderecos"("id")
);

-- colaboradores
CREATE TABLE "colaboradores" (
    "id" SERIAL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL UNIQUE,
    "cargo" TEXT,
    "setor" TEXT,
    "data_admissao" TIMESTAMP(3),
    "telefone" TEXT,
    "email" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true
);

-- transportadoras
CREATE TABLE "transportadoras" (
    "id" SERIAL PRIMARY KEY,
    "razao_social" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL UNIQUE,
    "ie" TEXT,
    "rntrc" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "endereco_id" INTEGER,
    CONSTRAINT "transportadoras_endereco_id_fkey" FOREIGN KEY ("endereco_id") REFERENCES "enderecos"("id")
);

-- veiculos
CREATE TABLE "veiculos" (
    "id" SERIAL PRIMARY KEY,
    "placa" TEXT NOT NULL,
    "renavam" TEXT,
    "tara_kg" DOUBLE PRECISION,
    "capacidade_kg" DOUBLE PRECISION,
    "tipo_rodado" TEXT,
    "tipo_carroceria" TEXT,
    "transportadora_id" INTEGER NOT NULL,
    CONSTRAINT "veiculos_transportadora_id_fkey" FOREIGN KEY ("transportadora_id") REFERENCES "transportadoras"("id")
);

-- produtos
CREATE TABLE "produtos" (
    "id" SERIAL PRIMARY KEY,
    "codigo_interno" TEXT NOT NULL UNIQUE,
    "descricao" TEXT NOT NULL,
    "ncm" TEXT NOT NULL,
    "cest" TEXT,
    "cfop_padrao" TEXT,
    "unidade" TEXT NOT NULL,
    "origem_mercadoria" TEXT,
    "cst_icms" TEXT,
    "csosn" TEXT,
    "aliquota_icms" DOUBLE PRECISION,
    "valor_unitario" DOUBLE PRECISION,
    "peso_liquido_kg" DOUBLE PRECISION,
    "ativo" BOOLEAN NOT NULL DEFAULT true
);

-- documentos_fiscais (autorreferenciada por causa do MDFe)
CREATE TABLE "documentos_fiscais" (
    "id" SERIAL PRIMARY KEY,
    "tipo" "TipoDocumentoFiscal" NOT NULL,
    "numero" INTEGER,
    "serie" INTEGER,
    "chave_acesso" TEXT,
    "status" "StatusDocumentoFiscal" NOT NULL DEFAULT 'rascunho',
    "protocolo_autorizacao" TEXT,
    "data_emissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_autorizacao" TIMESTAMP(3),
    "xml_url" TEXT,
    "pdf_url" TEXT,
    "motivo_rejeicao" TEXT,
    "valor_total" DOUBLE PRECISION,
    "nome_motorista" TEXT,
    "cpf_motorista" TEXT,
    "uf_percurso" TEXT,
    "empresa_id" INTEGER NOT NULL,
    "destinatario_id" INTEGER,
    "transportadora_id" INTEGER,
    "veiculo_id" INTEGER,
    "mdfe_id" INTEGER,
    CONSTRAINT "documentos_fiscais_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id"),
    CONSTRAINT "documentos_fiscais_destinatario_id_fkey" FOREIGN KEY ("destinatario_id") REFERENCES "pessoas"("id"),
    CONSTRAINT "documentos_fiscais_transportadora_id_fkey" FOREIGN KEY ("transportadora_id") REFERENCES "transportadoras"("id"),
    CONSTRAINT "documentos_fiscais_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id"),
    CONSTRAINT "documentos_fiscais_mdfe_id_fkey" FOREIGN KEY ("mdfe_id") REFERENCES "documentos_fiscais"("id")
);

-- documento_itens
CREATE TABLE "documento_itens" (
    "id" SERIAL PRIMARY KEY,
    "quantidade" DOUBLE PRECISION NOT NULL,
    "valor_unitario" DOUBLE PRECISION NOT NULL,
    "valor_total" DOUBLE PRECISION NOT NULL,
    "cfop_utilizado" TEXT,
    "documento_id" INTEGER NOT NULL,
    "produto_id" INTEGER NOT NULL,
    CONSTRAINT "documento_itens_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos_fiscais"("id"),
    CONSTRAINT "documento_itens_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id")
);

-- documento_eventos
CREATE TABLE "documento_eventos" (
    "id" SERIAL PRIMARY KEY,
    "tipo_evento" TEXT NOT NULL,
    "justificativa" TEXT,
    "data_evento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "protocolo" TEXT,
    "documento_id" INTEGER NOT NULL,
    CONSTRAINT "documento_eventos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos_fiscais"("id")
);

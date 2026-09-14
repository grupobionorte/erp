# ERP Biomassa — Backend

API que sustenta os cadastros (clientes, fornecedores, colaboradores,
transportadoras, produtos) e o fluxo de emissão de NFe via provedor externo.

## Deploy no Render (backend + Postgres online)

Este repositório já vem com um `render.yaml` na raiz — o Render lê esse arquivo e sobe o
backend e o banco de dados juntos, sem você configurar nada manualmente na interface.

1. Suba esta pasta inteira (incluindo o `render.yaml` na raiz e a pasta `backend/`) para um
   repositório no GitHub.
2. Em [render.com](https://render.com), crie uma conta e clique em **New > Blueprint**.
3. Conecte o repositório que você acabou de criar. O Render detecta o `render.yaml`
   automaticamente e mostra os dois recursos que vai criar: o banco `erp-biomassa-db` e o
   serviço web `erp-biomassa-backend`.
4. Clique em **Apply**. O Render cria o Postgres, gera a `DATABASE_URL` sozinho e já conecta
   ao backend — essa parte você não precisa copiar/colar.
5. Quando pedir o valor de `FOCUS_NFE_TOKEN`, cole o token da sua conta no provedor (pode
   deixar em branco por enquanto se ainda não tiver).
6. Aguarde o build. Ao final, o Render mostra uma URL pública tipo
   `https://erp-biomassa-backend.onrender.com` — é nela que sua API está rodando.
7. Teste: `curl https://erp-biomassa-backend.onrender.com/health` deve responder `{"status":"ok"}`.

No plano gratuito o serviço "dorme" depois de um tempo sem uso e demora alguns segundos para
acordar na primeira requisição — normal, não é erro.

## Instalação local (alternativa)

```bash
npm install
cp .env.example .env
# edite .env com sua string de conexão do Postgres e o token do provedor

npx prisma migrate dev --name inicial
npm run dev
```

O servidor sobe em `http://localhost:3333`.

## Rotas principais

| Método | Rota | O que faz |
|---|---|---|
| GET/POST | `/pessoas?papel=cliente\|fornecedor` | Clientes e fornecedores (mesma tabela) |
| GET/POST | `/colaboradores` | Colaboradores |
| GET/POST | `/transportadoras` | Transportadoras (e `/transportadoras/:id/veiculos`) |
| GET/POST | `/produtos` | Produtos |
| POST | `/documentos-fiscais/nfe/rascunho` | Monta um rascunho de NFe a partir dos cadastros |
| POST | `/documentos-fiscais/cte/rascunho` | Monta um rascunho de CTe (tomador do frete + transportadora) |
| POST | `/documentos-fiscais/mdfe/rascunho` | Monta um rascunho de MDFe (veículo, motorista e NFe/CTe transportadas) |
| POST | `/documentos-fiscais/:id/emitir` | Envia o rascunho para o provedor (Focus NFe) — funciona para os três tipos |
| GET | `/documentos-fiscais/:id/status` | Consulta e atualiza o status de autorização — funciona para os três tipos |

### Sobre o CTe

O tomador do serviço (`tomadorId`) é quem recebe e paga o frete — na prática, geralmente
o mesmo destinatário da NFe da mercadoria. `transportadoraId` é opcional, para quando o frete
é subcontratado de terceiros; se a própria empresa faz o transporte, deixe em branco.

### Sobre o MDFe

Só aceita documentos vinculados (`documentosVinculadosIds`) que já estejam com
`status: "autorizado"` — não faz sentido despachar uma viagem com uma NFe ainda não emitida.
O motorista (`nomeMotorista`/`cpfMotorista`) ainda não tem cadastro próprio no sistema; por ora
é só um texto livre no próprio documento — dá pra evoluir para um cadastro de condutores
ligado a `colaboradores` mais adiante.

## Exemplo — do cadastro à emissão

```bash
# 1. Criar um rascunho de NFe
curl -X POST http://localhost:3333/documentos-fiscais/nfe/rascunho \
  -H "Content-Type: application/json" \
  -d '{
    "empresaId": 1,
    "destinatarioId": 5,
    "itens": [{ "produtoId": 3, "quantidade": 20 }]
  }'

# 2. Emitir (envia para o provedor)
curl -X POST http://localhost:3333/documentos-fiscais/12/emitir

# 3. Consultar status até sair "autorizado"
curl http://localhost:3333/documentos-fiscais/12/status
```

## O que falta para produção

- Autenticação/autorização nas rotas (hoje está tudo aberto).
- Validações mais completas de cada cadastro (formato de CPF/CNPJ, NCM válido etc.).
- Webhook do provedor para atualizar o status automaticamente em vez de
  fazer polling em `/status`.
- Cadastro de condutores (hoje o motorista do MDFe é só texto livre).
- Testes automatizados.

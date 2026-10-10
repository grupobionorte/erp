# ERP Biomassa — Bionorte

Sistema de gestão para empresa de biomassa e transporte em Nova Mutum, MT.
Emite NF-e, CT-e e MDF-e de verdade, em produção, com documentos autorizados
pela SEFAZ. **Erro aqui tem custo fiscal real.**

Interlocutor: Leandro, dono da operação. Não é programador — descreve o que
precisa pela ótica de quem usa, e confia na implementação. Fale português,
sem jargão técnico desnecessário, e explique as decisões de engenharia que
afetam o uso.

---

## Como rodar

```
backend/   Node + Express + Prisma + PostgreSQL   → Render (plano pago)
frontend/  HTML único com React via Babel (CDN)   → Render (estático)
```

Não há build no frontend: `index.html` tem ~10 mil linhas e é servido como
está. Isso é deliberado — mantém o deploy trivial — mas exige cuidado: toda
alteração é edição de texto num arquivo grande, e vale conferir o equilíbrio
de chaves e tags depois de mexer.

```bash
cd backend && npm install && npx prisma generate
npx prisma migrate deploy      # as migrations são escritas à mão
node src/server.js
```

Variáveis essenciais no Render (serviço `erp-biomassa-backend`):

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Postgres |
| `JWT_SECRET` | sessões |
| `FOCUS_NFE_BASE_URL` / `FOCUS_NFE_TOKEN` | provedor fiscal (padrão) |
| `FOCUS_NFE_TOKEN_PRODUCAO` / `FOCUS_NFE_TOKEN_HOMOLOGACAO` | token por ambiente |
| `FOCUS_AMBIENTE_NFE` / `_CTE` / `_MDFE` | `producao` ou `homologacao`, **por documento** |
| `TZ_FISCAL` | `America/Cuiaba` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CONTATO` | notificações push |
| `CRON_TOKEN` | protege `POST /lembretes`, chamada a cada 5 min pelo cron-job.org (job "Lembretes da Agenda", fuso America/Cuiaba) com o cabeçalho `x-cron-token` |

Endereços: `erp-biomassa-backend.onrender.com` e
`erp-biomassa-frontend.onrender.com`.

---

## Módulos

Cadastros (clientes, fornecedores, produtos, transportadoras, veículos,
motoristas, colaboradores, operações, empresas, usuários) usam um formulário
genérico dirigido por configuração: o objeto `MODULES` no `index.html`
descreve campos, colunas e a conversão de ida e volta com a API. Acrescentar
um cadastro é acrescentar uma entrada ali mais uma rota no servidor.

Telas próprias: Vendas/NF-e, CT-e, MDF-e, Ponto, Agenda, Manutenção, Contas
a pagar, Relatórios.

Fora do ERP: `tablet-ponto.html` (PWA do relógio de ponto, com
reconhecimento facial) e `agenda.html` (PWA da agenda no celular, com
notificações push).

---

## Decisões que não devem ser revertidas sem conversa

**Fuso horário.** O sistema inteiro trabalha no horário de Cuiabá
(UTC-4). Data vinda da tela é só o dia; gravar como meia-noite UTC coloca o
documento no dia anterior em Mato Grosso. Já houve um dia inteiro de notas
com a data errada na listagem por causa disso.

- Nunca use `new Date().toISOString().slice(0, 10)` como "hoje": depois das
  20h em Cuiabá ele já é amanhã. Nem `slice(0, 10)` em instante com hora
  (emissão, saída, batida): dá o dia em UTC.
- Servidor: `backend/src/lib/fuso.js` — `hojeNoFuso`, `intervaloNoFuso`
  (todo filtro de/até), `dataHoraNoFuso`, `instanteDaTela` (data+hora sem
  fuso vinda da tela) e `diaDoCampo` (campo só-data que o Prisma devolve
  como `Date`). Na emissão, `dataNoFusoComHoraAtual`.
- Tela: no início do `index.html` — `FUSO_OPERACAO`, `hojeNoFuso`,
  `diaDoInstante`/`horaDoInstante` (ler emissão e saída), `dataSemHoraBr`
  (exibir campo só-data) e `dataBrDoInstante`.
- O TZ do processo no Render continua UTC de propósito: filtros de campos
  só-data contam com isso. Mudar exige revisar esses filtros antes.
- 20:00 em Cuiabá é meia-noite UTC exata, o formato antigo "só o dia" que
  `focusNfe.normalizarDataEmissao` completa com a hora atual. Por isso
  `dataHoraNoFuso` da rota fiscal soma 1 ms nesse instante — não remova.

**Documento fiscal autorizado é permanente.** Rascunho e rejeitado podem ser
apagados; autorizado e cancelado, nunca. `scripts/zerar-banco.js` recusa
rodar se algum ambiente estiver em produção.

**A SEFAZ é a fonte da verdade da numeração.** Quem numera é a Focus; o
sistema grava o número que voltou na autorização, extraído da chave de
acesso, e reposiciona o contador da empresa. Numeração é **por empresa**.

**O grupo do veículo na NF-e** só pode ir quando emitente e destinatário
estão no mesmo município (rejeição 868). Nos demais casos a placa, o
motorista e os reboques vão nas informações complementares, em linhas
separadas — é o que o sistema anterior da empresa fazia.

**Permissões são por usuário E empresa.** Resolvidas no login conforme a
empresa escolhida, bloqueadas no servidor (`src/lib/permissoes.js`), não só
escondidas na tela. Vale para admin também, exceto o menu de usuários, que é
a saída de emergência quando a configuração trava alguém.

**Imagem não vai para o banco sem redução.** A logo da empresa chegou a
pesar megabytes e deixou o login lento; hoje é reduzida a 320px no
navegador. A foto da batida por PIN segue a mesma regra e é descartada após
90 dias.

**Marcação de ponto é somente-inserção**, com trigger no banco e encadeamento
por hash. Correções são tratamentos, nunca edição do registro original.

**Valores calculados são somente leitura.** Nas viagens da operação, todos os
totais saem de quatro números digitados. Campo calculado editável permite um
valor que não corresponde à conta, e aí ninguém sabe qual está certo.

---

## Armadilhas já pagas

**Prisma:** com escrita aninhada (`endereco: { upsert }`), não se pode passar
o campo de chave direto — use `connect`/`disconnect`. O erro aparece como
"Unknown argument transportadoraId".

**Rotas que esquecem de gravar.** Já aconteceu três vezes: a rota de edição
recebe o campo e não o grava (endereço da empresa, endereço da
transportadora, chave da NF-e referenciada). Ao criar um campo, confira
**criação e edição**.

**Chave VAPID:** 87 caracteres e 65 bytes não bastam — os bytes precisam
formar um ponto válido na curva P-256. Uma chave com um caractere trocado
passa em toda conferência de tamanho e é recusada só pelo celular, com uma
mensagem que não diz isso. `scripts/conferir-vapid.js` confere de verdade.

**Nunca transcreva segredo a partir de imagem.** Dois dias perdidos com uma
chave lida de uma captura de tela.

**Service worker em cache.** Ao alterar `agenda.html` ou `tablet-ponto.html`,
suba a versão no `agenda-sw.js` / `ponto-sw.js`, senão o celular continua
rodando o arquivo antigo e nenhuma correção parece funcionar.

**Listagens pesadas.** A lista de documentos trazia itens, produtos e
vínculos de cada nota para desenhar seis colunas. Hoje ela traz só o resumo;
a edição busca o documento completo em `/documentos-fiscais/:id`.

---

## Rejeições da SEFAZ já resolvidas

Cada uma custou pelo menos um ciclo de tentativa. Antes de mexer no payload
em `src/services/focusNfe.js`, veja se o comentário no código já explica o
porquê.

- **254** — complementar precisa referenciar a NF-e de origem
- **302 / schema infPag** — MDF-e de carga lotação exige o grupo de
  pagamento, com banco e agência; "a pagar" no CT-e não é "a prazo" no MDF-e
- **506** — saída não pode ser anterior à emissão
- **578 / 711 / 726 / 745** — contratantes, manifesto em aberto, CEPs da
  carga lotação, tipo de transportador
- **868** — grupo do veículo proibido fora do mesmo município
- **301** — NCM do produto predominante no MDF-e
- Encerramento do MDF-e é `POST /v2/mdfe/{ref}/encerrar`, com `data`,
  `sigla_uf` e `nome_municipio` — nome, não código IBGE

---

## Pendentes conhecidos

- AFD e AEJ do ponto (layout da Portaria 671/2021) — não implementados
- Regularização REP-P: INPI, certificado ICP-Brasil, responsável técnico
- E-mail do comprovante de ponto (SMTP configurado, falta testar no plano pago)
- MDF-e com carga fracionada: caminho testado, mas pouco rodado

---

## Convenções

**Comentários explicam o porquê, não o quê.** O código já diz o que faz; o
comentário registra a decisão, a armadilha, a rejeição que motivou aquela
linha. Boa parte do conhecimento fiscal deste projeto está nos comentários —
mantenha esse padrão.

**Versão** em `VERSAO_SISTEMA` no `index.html`, exibida na barra lateral.
Terceiro dígito para correção, segundo para recurso novo. Atualize a cada
entrega, e acrescente uma linha curta em `NOVIDADES` (logo abaixo), do ponto
de vista de quem usa: ela aparece na tela de entrada.

**Toda listagem mostra 50 por tela**, com o componente `Paginacao` (mesmo
visual e contador em todas). Dado que cresce sem parar — NF-e, CT-e, MDF-e —
pagina no servidor: `/documentos-fiscais?pagina=&porPagina=&busca=&de=&ate=`
devolve `{ documentos, total, paginas }`; sem `pagina`, continua a lista
simples que o CT-e e o MDF-e usam para escolher documentos. As demais usam
`usePaginacaoLocal(lista, reiniciar)`, porque a mesma lista alimenta selects
e contadores e precisa vir inteira. Não pagine listas de seleção ("marcar
todas", totais) nem o que vai para impressão.

**Exclusão é lógica** em cadastros (`ativo: false`): registro citado em
documento fiscal precisa continuar existindo.

**Migrations são escritas à mão**, nomeadas `AAAAMMDD000000_descricao`. Não
use `prisma migrate dev`, que recria o banco.

**Nada de inventar dado para a SEFAZ.** Se falta informação, o certo é
recusar com mensagem clara, não preencher com um valor plausível.

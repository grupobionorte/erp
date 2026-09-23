/* ===========================================================================
   Service worker do app de ponto.

   Ele resolve o problema que sobrava no navegador: os modelos de
   reconhecimento ficavam no cache comum do Chrome, que pode ser limpo ou
   descartado por falta de espaço — e aí, sem internet, o reconhecimento
   parava. Aqui eles ficam num cache próprio do app, que só sai se alguém
   desinstalar.

   Duas regras guiam as estratégias abaixo:
   - Nada do ponto passa por cache. Marcação é dado, não arquivo: quem
     cuida de funcionar offline é a fila no próprio app.
   - O HTML é buscado na rede primeiro, com o cache como rede de segurança.
     Assim um deploy novo chega no tablet sem ninguém precisar reinstalar.
   =========================================================================== */

const VERSAO = "ponto-v1";
const CACHE_APP = `${VERSAO}-app`;
const CACHE_MODELOS = `${VERSAO}-modelos`;

// O essencial para abrir offline.
const ARQUIVOS_BASE = [
  "/tablet-ponto.html",
  "/ponto-manifest.webmanifest",
  "/ponto-icone-192.png",
  "/ponto-icone-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE_APP)
      .then((cache) => cache.addAll(ARQUIVOS_BASE))
      .then(() => self.skipWaiting())
      .catch((e) => console.warn("[ponto-sw] instalação parcial:", e))
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((c) => !c.startsWith(VERSAO)).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

// Arquivos de modelo: nome típico "*_model-weights_manifest.json" e os
// respectivos shards. Também vale qualquer coisa vinda da pasta /model/.
function ehModelo(url) {
  return /face-api|_model|weights_manifest|\/model\//i.test(url);
}

function ehBiblioteca(url) {
  return /cdn\.jsdelivr\.net|unpkg/i.test(url);
}

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const url = req.url;

  // Chamadas da API de ponto nunca entram em cache: uma marcação servida do
  // cache seria um registro falso, e a carga de colaboradores precisa ser a
  // atual. O app já tem a própria fila para o caso de estar sem rede.
  if (/\/ponto\/|\/auth\/|onrender\.com\/(ponto|auth)/i.test(url)) return;

  // Modelos e bibliotecas: cache primeiro. São grandes, não mudam e são
  // exatamente o que precisa estar disponível sem internet.
  if (ehModelo(url) || ehBiblioteca(url)) {
    evento.respondWith(
      caches.open(CACHE_MODELOS).then(async (cache) => {
        const guardado = await cache.match(req);
        if (guardado) return guardado;
        try {
          const resposta = await fetch(req);
          // Resposta opaca (CDN sem CORS) também serve para tocar o app.
          if (resposta.ok || resposta.type === "opaque") cache.put(req, resposta.clone());
          return resposta;
        } catch (e) {
          return guardado || Response.error();
        }
      })
    );
    return;
  }

  // Resto do app: rede primeiro, cache como rede de segurança.
  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE_APP).then((cache) => cache.put(req, copia)).catch(() => {});
        return resposta;
      })
      .catch(async () => {
        const guardado = await caches.match(req);
        if (guardado) return guardado;
        if (req.mode === "navigate") return caches.match("/tablet-ponto.html");
        return Response.error();
      })
  );
});

// Permite que o app peça para guardar os modelos assim que eles carregarem
// pela primeira vez, sem esperar a próxima visita.
self.addEventListener("message", (evento) => {
  if (evento.data?.tipo === "atualizar") self.skipWaiting();
});

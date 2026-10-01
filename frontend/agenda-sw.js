/* ===========================================================================
   Service worker do app de agenda.

   Faz duas coisas: recebe as notificações push e serve o app quando o
   celular está sem sinal. O conteúdo da agenda em si não é guardado em
   cache — tarefa é dado, e mostrar uma lista velha como se fosse atual
   seria pior do que dizer que está sem conexão.
   =========================================================================== */

const VERSAO = "agenda-v7";
const CACHE_APP = `${VERSAO}-app`;
const ARQUIVOS = ["/agenda.html", "/agenda-manifest.webmanifest", "/agenda-icone-192.png"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => !k.startsWith(VERSAO)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const url = new URL(evento.request.url);
  // Chamadas à API nunca passam por cache.
  if (evento.request.method !== "GET" || url.pathname.startsWith("/api")) return;
  if (url.origin !== self.location.origin) return;

  // Rede primeiro, cache como rede de segurança: assim um deploy novo chega
  // ao celular sem ninguém reinstalar nada.
  evento.respondWith(
    fetch(evento.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE_APP).then((c) => c.put(evento.request, copia)).catch(() => {});
        return resposta;
      })
      .catch(() => caches.match(evento.request).then((r) => r || caches.match("/agenda.html")))
  );
});

self.addEventListener("push", (evento) => {
  let dados = { titulo: "Biomassa", corpo: "", url: "/agenda.html" };
  try {
    dados = { ...dados, ...evento.data.json() };
  } catch {
    dados.corpo = evento.data?.text() || "";
  }

  evento.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: "/agenda-icone-192.png",
      badge: "/agenda-icone-192.png",
      tag: dados.tag || undefined,
      // Substitui a notificação anterior da mesma tag em vez de empilhar.
      renotify: Boolean(dados.tag),
      data: { url: dados.url || "/agenda.html" },
    })
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const destino = evento.notification.data?.url || "/agenda.html";

  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      // Se o app já está aberto, traz ele para frente em vez de abrir outro.
      for (const janela of janelas) {
        if (janela.url.includes("/agenda.html") && "focus" in janela) return janela.focus();
      }
      return self.clients.openWindow(destino);
    })
  );
});

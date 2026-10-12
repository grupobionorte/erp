/* ---------------------------------------------------------------------------
   Painel do ERP na tela "Emitir GF" do SISFLORA. A pessoa cola (Ctrl+V) os
   dados copiados da NF-e no ERP e usa os botões para preencher cada parte.
   O preenchimento em si acontece em pagina.js, que enxerga o AngularJS da
   tela; aqui fica só a interface.
--------------------------------------------------------------------------- */
(function () {
  let dados = null;
  let painel = null;

  const el = (tag, attrs = {}, ...filhos) => {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (k === "style" ? Object.assign(e.style, v) : (e[k] = v)));
    filhos.flat().forEach((f) => e.append(f));
    return e;
  };

  const ESTILO_BOTAO = {
    display: "block", width: "100%", margin: "4px 0", padding: "6px 8px", border: "1px solid #00923F",
    background: "#00923F", color: "#fff", borderRadius: "6px", cursor: "pointer", fontSize: "13px", textAlign: "left",
  };

  function telaDeEmissao() {
    const h1 = document.querySelector("h1.title");
    return !!document.querySelector('form[name="formGerenciar"]') && h1 && /Emitir/i.test(h1.textContent);
  }

  function mostrarAvisos(lista, ok) {
    const caixa = painel.querySelector("#erp-gf-avisos");
    caixa.innerHTML = "";
    caixa.style.color = ok ? "#27500a" : "#a32d2d";
    (lista.length ? lista : [ok ? "Preenchido. Confira na tela." : "Nada preenchido."]).forEach((t) => caixa.append(el("div", {}, "• " + t)));
  }

  function enviar(acao, extra = {}) {
    if (!dados) { mostrarAvisos(["Cole primeiro os dados copiados do ERP."], false); return; }
    window.postMessage({ fonte: "erp-gf-painel", acao, dados, ...extra }, "*");
  }

  window.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (ev.source !== window || !msg || msg.fonte !== "erp-gf-pagina" || !painel) return;
    mostrarAvisos(msg.avisos || [], msg.ok);
  });

  function copiar(texto) {
    navigator.clipboard.writeText(texto).then(() => mostrarAvisos([`Copiado: ${texto}`], true));
  }

  function desenharResumo() {
    const r = painel.querySelector("#erp-gf-resumo");
    r.innerHTML = "";
    if (!dados) return;
    const n = dados.nota, c = dados.destinatario;
    r.append(
      el("div", { style: { fontWeight: "600" } }, `NF-e ${n.numero}${n.serie ? "/" + n.serie : ""}`),
      el("div", {}, `${c.nome}`),
      el("div", {}, `${c.municipio}/${c.uf}`),
      el("div", {}, "CNPJ/CPF: ", el("a", { href: "#", onclick: (e) => { e.preventDefault(); copiar(c.cpfCnpj.replace(/\D/g, "")); } }, c.cpfCnpj + " (copiar)")),
      el("div", {}, `Placas: ${(dados.placas || []).join(", ") || "—"}`),
    );
    const botoes = painel.querySelector("#erp-gf-botoes");
    botoes.innerHTML = "";
    botoes.append(
      el("button", { style: ESTILO_BOTAO, onclick: () => enviar("nfe") }, "1. Preencher NF-e (chave e protocolo)"),
      el("button", { style: ESTILO_BOTAO, onclick: () => enviar("destino") },
        `2. Destino (CC-SEMA ${c.ccsema || "—"}), memorial e ICMS`),
      el("button", { style: ESTILO_BOTAO, onclick: () => enviar("transporte") }, "3. Preencher transporte (destino e placas)"),
    );
    (dados.itens || []).forEach((it, i) => {
      botoes.append(el("button", { style: ESTILO_BOTAO, onclick: () => enviar("produto", { indice: i }) },
        `4. Produto: ${it.descricao} — ${it.quantidade} ${it.unidade} · R$ ${it.valorTotal.toFixed(2).replace(".", ",")}`));
    });
    botoes.append(el("div", { style: { fontSize: "11.5px", color: "#6b6b68", marginTop: "4px" } },
      "No produto, escolha antes o lote, o produto e a essência. Depois de cada parte, confira e clique em Adicionar na própria tela. Emitir é sempre com vocês."));
  }

  function lerColado(texto) {
    try {
      const d = JSON.parse(texto);
      if (d.origem !== "erp-biomassa" || d.tipo !== "gf") throw new Error();
      dados = d;
      desenharResumo();
      mostrarAvisos(["Dados da NF-e carregados."], true);
    } catch {
      mostrarAvisos(["Isso não são dados copiados do ERP. No ERP, use \"Copiar para a GF (SISFLORA)\" no menu da NF-e."], false);
    }
  }

  function criarPainel() {
    painel = el("div", {
      id: "erp-gf-painel",
      style: {
        position: "fixed", right: "16px", bottom: "16px", width: "300px", zIndex: 99999, background: "#F1F7EC",
        border: "1.5px solid #00923F", borderRadius: "10px", padding: "10px 12px", font: "13px/1.4 Segoe UI, Arial, sans-serif",
        color: "#1F3B57", boxShadow: "0 4px 16px rgba(0,0,0,.15)",
      },
    },
      el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" } },
        el("strong", {}, "ERP Biomassa → GF"),
        el("button", { style: { border: "none", background: "none", cursor: "pointer", fontSize: "16px" }, title: "Recolher",
          onclick: () => { const c = painel.querySelector("#erp-gf-corpo"); c.style.display = c.style.display === "none" ? "" : "none"; } }, "–"),
      ),
      el("div", { id: "erp-gf-corpo" },
        el("textarea", {
          rows: 2, placeholder: "Cole aqui (Ctrl+V) os dados copiados da NF-e no ERP",
          style: { width: "100%", boxSizing: "border-box", fontSize: "12px", borderRadius: "6px", border: "1px solid #c9c6ba", padding: "4px 6px" },
          onpaste: (e) => { e.preventDefault(); lerColado(e.clipboardData.getData("text")); },
        }),
        el("div", { id: "erp-gf-resumo", style: { margin: "6px 0" } }),
        el("div", { id: "erp-gf-botoes" }),
        el("div", { id: "erp-gf-avisos", style: { marginTop: "6px", fontSize: "12px" } }),
      ),
    );
    document.body.append(painel);
  }

  // A tela é de página única: o painel aparece e some conforme a pessoa
  // entra e sai da emissão de GF.
  setInterval(() => {
    const naTela = telaDeEmissao();
    if (naTela && !painel) criarPainel();
    if (!naTela && painel) { painel.remove(); painel = null; }
  }, 800);
})();

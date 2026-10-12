/* ---------------------------------------------------------------------------
   Roda dentro da página do SISFLORA (mundo "MAIN"), onde está o AngularJS da
   tela "Emitir GF" (views/gf/gerenciar3e5). Recebe do painel os dados da
   NF-e e escreve direto no modelo da tela — os mesmos campos que a pessoa
   preencheria à mão —, chamando as funções da própria tela quando uma
   escolha depende de outra (tipo de transporte, número de veículos, UF ->
   municípios).

   Nunca chama adicionarTrecho, adicionarProduto nem emitir: quem confere e
   confirma é a pessoa.
--------------------------------------------------------------------------- */
(function () {
  const UF_NOME = {
    AC: "ACRE", AL: "ALAGOAS", AP: "AMAPA", AM: "AMAZONAS", BA: "BAHIA", CE: "CEARA", DF: "DISTRITO FEDERAL",
    ES: "ESPIRITO SANTO", GO: "GOIAS", MA: "MARANHAO", MT: "MATO GROSSO", MS: "MATO GROSSO DO SUL",
    MG: "MINAS GERAIS", PA: "PARA", PB: "PARAIBA", PR: "PARANA", PE: "PERNAMBUCO", PI: "PIAUI",
    RJ: "RIO DE JANEIRO", RN: "RIO GRANDE DO NORTE", RS: "RIO GRANDE DO SUL", RO: "RONDONIA",
    RR: "RORAIMA", SC: "SANTA CATARINA", SP: "SAO PAULO", SE: "SERGIPE", TO: "TOCANTINS",
  };
  const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

  // Placa no formato que a tela aceita: ABC-1234 (antiga) ou ABC1D23 (Mercosul).
  const placaGf = (p) => {
    const s = String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^[A-Z]{3}\d{4}$/.test(s) ? `${s.slice(0, 3)}-${s.slice(3)}` : s;
  };

  function escopo() {
    const form = document.querySelector('form[name="formGerenciar"]');
    if (!form || !window.angular) return null;
    const s = window.angular.element(form).scope();
    return s && s.entidade && s.tela ? s : null;
  }

  function aplicar(s, fn) {
    if (s.$root.$$phase) fn(); else s.$apply(fn);
  }

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  async function aguardar(cond, limite = 10000) {
    const ini = Date.now();
    while (Date.now() - ini < limite) {
      if (cond()) return true;
      await espera(150);
    }
    return false;
  }

  // ---- NF-e: chave e protocolo.
  async function preencherNfe(s, d, avisos) {
    if (s.tela.bloquearCampos || s.tela.podeTrocarNf === false) {
      avisos.push("A tela não deixa trocar o tipo de nota agora; preenchi só chave e protocolo.");
    } else {
      aplicar(s, () => { s.tela.isNfe = true; s.alterarNf && s.alterarNf(); });
      await espera(200);
    }
    aplicar(s, () => {
      s.entidade.NfeNumero = d.nota.chave;
      s.entidade.NfeProtocolo = d.nota.protocolo;
    });
    if (String(d.nota.chave).length !== 44) avisos.push("A chave da nota não tem 44 dígitos — confira.");
    if (String(d.nota.protocolo).length !== 15) avisos.push("O protocolo não tem 15 dígitos — confira.");
  }

  // ---- Trecho rodoviário: destino e placas.
  async function preencherTransporte(s, d, avisos) {
    const tipos = s.tela.tiposTransporte || [];
    const rodoviario = tipos.find((t) => t.Chave === "[RODOVIARIO]") || tipos.find((t) => normal(t.Texto).includes("RODOVI"));
    if (!rodoviario) { avisos.push("Não achei o tipo de transporte Rodoviário na tela."); return; }
    aplicar(s, () => { s.tela.trecho.TipoTransporte = rodoviario.Chave; s.alterarTipoTransporte && s.alterarTipoTransporte(); });
    await espera(150);

    // UF e município de destino (a origem a tela trava pelo empreendimento).
    const uf = normal(d.destinatario.uf);
    const estado = (s.tela.estados || []).find((e) => {
      const t = normal(e.Texto);
      return t === uf || t === UF_NOME[uf] || t.startsWith(uf + " ") || t.endsWith("(" + uf + ")") || t.includes(" - " + uf);
    });
    if (s.tela.bloquearCampos) {
      avisos.push("Destino travado pela tela; não mexi em UF e município.");
    } else if (!estado) {
      avisos.push(`Não achei a UF ${d.destinatario.uf || "(vazia)"} na lista de destino.`);
    } else {
      aplicar(s, () => { s.tela.trecho.EstadoDestino = estado.Chave; s.tela.trecho.MunicipioDestino = null; s.buscarMunicipiosDestino(false); });
      const carregou = await aguardar(() => (s.tela.municipiosDestino || []).length > 0);
      const nome = normal(d.destinatario.municipio);
      const mun = carregou && (s.tela.municipiosDestino || []).find((m) => normal(m.Texto) === nome);
      if (mun) aplicar(s, () => { s.tela.trecho.MunicipioDestino = mun; });
      else avisos.push(`Não achei o município ${d.destinatario.municipio || "(vazio)"} — escolha à mão.`);
    }

    // Placas: a primeira é o cavalo; as demais, veículos auxiliares (até 3).
    const placas = (d.placas || []).map(placaGf).filter(Boolean).slice(0, 4);
    if (!placas.length) { avisos.push("A nota não tem placa de veículo."); return; }
    const auxiliares = String(Math.max(0, placas.length - 1));
    aplicar(s, () => {
      s.tela.trecho.TransporteRodoviarioPlaca1 = placas[0];
      s.tela.trecho.TransporteRodoviarioVeiculosAuxiliares = auxiliares;
      s.alterarNumeroVeiculosAuxiliares && s.alterarNumeroVeiculosAuxiliares();
    });
    await espera(100);
    aplicar(s, () => {
      s.tela.trecho.TransporteRodoviarioPlaca2 = placas[1] || "";
      s.tela.trecho.TransporteRodoviarioPlaca3 = placas[2] || "";
      s.tela.trecho.TransporteRodoviarioPlaca4 = placas[3] || "";
    });
  }

  // ---- Produto: preço (total do item) e, se a unidade bater, o volume.
  // Lote, produto e essência saem do saldo do SISFLORA: a pessoa escolhe
  // antes, porque trocar qualquer um deles limpa volume e preço.
  async function preencherProduto(s, d, indice, avisos) {
    const item = (d.itens || [])[indice || 0];
    if (!item) { avisos.push("A nota não tem esse item."); return; }
    if (!s.tela.produtoItem || !s.tela.produtoItem.Essencia) {
      avisos.push("Escolha primeiro o lote, o produto e a essência na tela; depois clique de novo.");
      return;
    }
    const un = normal(item.unidade);
    const volumeServe = ["M3", "M³", "MST", "ST", "ESTEREO", "METRO CUBICO"].some((u) => un === normal(u));
    aplicar(s, () => {
      s.tela.produtoItem.PrecoTipoUnitario = false;
      s.tela.produtoItem.Preco = Number(item.valorTotal.toFixed(2));
      if (volumeServe) s.tela.produtoItem.Volume = item.quantidade;
    });
    if (!volumeServe) {
      avisos.push(`Volume não preenchido: a nota está em ${item.unidade || "unidade não informada"} e a GF pede o volume do produto. Informe à mão.`);
    }
  }

  window.addEventListener("message", async (ev) => {
    const msg = ev.data;
    if (ev.source !== window || !msg || msg.fonte !== "erp-gf-painel") return;
    const avisos = [];
    const s = escopo();
    if (!s) {
      window.postMessage({ fonte: "erp-gf-pagina", ok: false, avisos: ["Abra a tela \"Emitir GF\" do SISFLORA antes de preencher."] }, "*");
      return;
    }
    try {
      if (msg.acao === "nfe") await preencherNfe(s, msg.dados, avisos);
      if (msg.acao === "transporte") await preencherTransporte(s, msg.dados, avisos);
      if (msg.acao === "produto") await preencherProduto(s, msg.dados, msg.indice, avisos);
      window.postMessage({ fonte: "erp-gf-pagina", ok: true, acao: msg.acao, avisos }, "*");
    } catch (e) {
      window.postMessage({ fonte: "erp-gf-pagina", ok: false, acao: msg.acao, avisos: [`Erro: ${e.message}`] }, "*");
    }
  });
})();

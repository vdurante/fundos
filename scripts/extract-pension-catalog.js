/**
 * Extracts the full pension fund catalogue from a bank's logged-in product page.
 *
 * Paste into the DevTools console while the pension tab is open. A panel appears
 * bottom-right: it walks every page of the paginated catalogue, opens each fund's
 * detail view and scrapes name, CNPJ, PGBL/VGBL availability, fees, grace periods,
 * redemption terms, risk and audience. Output is shown on screen as TSV (paste
 * straight into a spreadsheet) with a CSV download as a fallback.
 *
 * Progress is saved after every fund, so a run interrupted by a session timeout can
 * be resumed — either automatically, or from a chosen page/item, or by pasting a
 * previous export back in.
 *
 * Queries pierce shadow DOM, since the catalogue renders inside shadow roots.
 */
(function () {
  "use strict";

  const PANEL_ID = "vcd-prev-panel-v18";
  const STATUS_ID = "vcd-prev-status-v18";
  const RUN_ID = "vcd-prev-run-v18";
  const OUTPUT_ID = "vcd-prev-output-v18";
  const STORE_KEY = "vcd_prev_parcial";
  const CSV_NAME = "pension-catalog.csv";

  const TIMEOUT_DETALHE = 40000;
  const PAUSA_ENTRE_FUNDOS = 900;
  const PAUSA_ENTRE_PAGINAS = 1800;
  const ESPERAS = [20000, 60000, 120000, 240000];

  window.__vcdLegacyIds = (window.__vcdLegacyIds || []).concat([
    "vcd-prev-panel-v15",
    "vcd-prev-panel-v17",
    "vcd-prev-output-v17",
    "vcd-prev-output-v15",
    "vcd-prev-extractor",
    "vcd-prev-output",
    "vcd-prev-panel-v14",
    "vcd-prev-output-v14",
  ]);

  const neutralizarAntigo = () => {
    const anterior = document.getElementById.bind(document);
    const fantasma = document.createElement("div");
    fantasma.style.display = "none";
    fantasma.remove = () => {};
    const patched = function (id) {
      return window.__vcdLegacyIds.indexOf(id) >= 0 ? fantasma : anterior(id);
    };
    patched.__vcdPatched = true;
    document.getElementById = patched;
    let removidos = 0;
    for (const id of window.__vcdLegacyIds) {
      const velho = document.querySelector("#" + id);
      if (velho && velho.parentNode) {
        velho.parentNode.removeChild(velho);
        removidos++;
      }
    }
    return `inertes: ${window.__vcdLegacyIds.length} ids, ${removidos} removidos`;
  };

  const state = { running: false, status: "", warn: false, rows: [], falhas: [], escondido: false };

  const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
  const TXT = (el) => ((el && el.textContent) || "").replace(/\s+/g, " ").trim();

  const deepRoots = (start) => {
    const base = start || document;
    const roots = [base];
    const stack = [base];
    while (stack.length) {
      const r = stack.pop();
      let kids;
      try {
        kids = r.querySelectorAll("*");
      } catch (e) {
        continue;
      }
      for (const el of kids) {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          stack.push(el.shadowRoot);
        }
      }
    }
    return roots;
  };

  const deepQueryAll = (sel, start) => {
    const out = [];
    for (const r of deepRoots(start)) {
      try {
        out.push(...r.querySelectorAll(sel));
      } catch (e) {}
    }
    return out;
  };

  const deepElements = (start) => {
    const out = [];
    for (const r of deepRoots(start)) {
      try {
        out.push(...r.querySelectorAll("*"));
      } catch (e) {}
    }
    return out;
  };

  const parentOf = (el) => {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode && el.getRootNode();
    return root && root.host ? root.host : null;
  };

  const field = (prefix, start, cache) => {
    const els = cache || deepElements(start);
    let best = null;
    for (const el of els) {
      const t = TXT(el);
      if (t.startsWith(prefix + ":") && t.length < 500 && (!best || t.length < best.length)) best = t;
    }
    return best ? best.slice(prefix.length + 1).trim() : "";
  };

  const waitFor = async (fn, timeout = 20000, step = 150) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await SLEEP(step);
    }
  };

  const nomeAcessivel = (el) => {
    const direto = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || "";
    if (direto) return direto;
    const ref = el.getAttribute("aria-labelledby");
    if (!ref) return "";
    const root = el.getRootNode();
    return ref
      .split(/\s+/)
      .map((id) => {
        try {
          return (root && root.querySelector && root.querySelector("#" + id)) || document.querySelector("#" + id);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean)
      .map(TXT)
      .join(" ");
  };

  const desabilitado = (b) => !b || b.disabled || b.getAttribute("aria-disabled") === "true";

  const indicador = () => {
    for (const el of deepQueryAll("[aria-labelledby]")) {
      if (/Item \d+ de \d+/.test(nomeAcessivel(el))) return el;
    }
    return deepElements().find((e) => /^Item \d+ de \d+$/.test(TXT(e))) || null;
  };

  const contexto = () => {
    const ind = indicador();
    if (!ind) return null;

    const nome = nomeAcessivel(ind) || TXT(ind);
    const m = /Item (\d+) de (\d+)/.exec(nome);

    let pag = null;
    let node = ind;
    for (let i = 0; i < 10 && node; i++) {
      let next = null;
      let prev = null;
      try {
        next = node.querySelector && node.querySelector('button[aria-label="Próxima página"]');
        prev = node.querySelector && node.querySelector('button[aria-label="Página anterior"]');
      } catch (e) {}
      if (next || prev) {
        pag = { node, next, prev };
        break;
      }
      node = parentOf(node);
    }
    if (!pag) return null;

    let raiz = pag.node;
    for (let i = 0; i < 10 && raiz; i++) {
      let cards = [];
      try {
        cards = raiz.querySelectorAll ? raiz.querySelectorAll('button[aria-label^="Detalhes sobre o produto"]') : [];
      } catch (e) {}
      if (cards.length) break;
      raiz = parentOf(raiz);
    }

    return {
      indicador: ind,
      next: pag.next,
      prev: pag.prev,
      raiz: raiz || document,
      current: m ? +m[1] : null,
      total: m ? +m[2] : null,
    };
  };

  const detailButtons = () => {
    const ctx = contexto();
    const escopo = ctx && ctx.raiz !== document ? ctx.raiz : null;
    const achados = escopo ? deepQueryAll('button[aria-label^="Detalhes sobre o produto"]', escopo) : [];
    return achados.length ? achados : deepQueryAll('button[aria-label^="Detalhes sobre o produto"]');
  };

  const pageState = () => {
    const ctx = contexto();
    return ctx && ctx.total ? { current: ctx.current, total: ctx.total } : null;
  };

  const totalProdutos = () => {
    for (const el of deepElements()) {
      const m = /^(\d+) produtos? dispon/i.exec(TXT(el));
      if (m) return +m[1];
    }
    return null;
  };

  const setStatus = (t, warn) => {
    state.status = t;
    state.warn = !!warn;
    const el = document.getElementById(STATUS_ID);
    if (el) {
      el.textContent = t;
      el.style.color = warn ? "#ffb4a2" : "#fff";
    }
    console.log("[prev-extractor]", t);
  };

  const setBusy = (b) => {
    state.running = b;
    const btn = document.getElementById(RUN_ID);
    if (btn) {
      btn.disabled = b;
      btn.style.opacity = b ? "0.6" : "1";
      btn.style.cursor = b ? "default" : "pointer";
    }
  };

  const firstCardKey = () => {
    const b = detailButtons()[0];
    return b ? b.getAttribute("aria-label") || "" : "";
  };

  const avancar = async () => {
    const ctx = contexto();
    if (!ctx || desabilitado(ctx.next)) return false;
    const before = firstCardKey();
    ctx.next.click();
    const mudou = await waitFor(() => firstCardKey() && firstCardKey() !== before, 12000);
    await SLEEP(200);
    return !!mudou;
  };

  const voltarPagina = async () => {
    const ctx = contexto();
    if (!ctx || desabilitado(ctx.prev)) return false;
    const before = firstCardKey();
    ctx.prev.click();
    const mudou = await waitFor(() => firstCardKey() && firstCardKey() !== before, 12000);
    await SLEEP(200);
    return !!mudou;
  };

  const acharPagina = async (key) => {
    if (firstCardKey() === key) return true;
    for (let k = 0; k < 40; k++) {
      if (!(await voltarPagina())) break;
      if (firstCardKey() === key) return true;
    }
    for (let k = 0; k < 40; k++) {
      if (!(await avancar())) break;
      if (firstCardKey() === key) return true;
    }
    return firstCardKey() === key;
  };

  const cardContainer = (btn) => {
    let el = btn;
    for (let i = 0; i < 14 && el; i++) {
      let h4 = null;
      try {
        h4 = el.querySelector && el.querySelector("h4");
      } catch (e) {}
      if (h4) return el;
      el = parentOf(el);
    }
    return parentOf(btn) || btn;
  };

  const scrapeCard = (btn) => {
    const box = cardContainer(btn);
    const els = deepElements(box);
    const tags = els.map(TXT).filter((t) => t && t.length < 40);
    const h = (tag) => {
      const found = els.find((e) => e.tagName && e.tagName.toLowerCase() === tag);
      return TXT(found);
    };
    return {
      nome_lista: h("h4"),
      categoria: h("h3"),
      risco_lista: tags.find((t) => /^Risco /.test(t)) || "",
      publico_lista: tags.find((t) => /^(Qualificado|Público geral|Profissional)$/.test(t)) || "",
      menor_18: tags.some((t) => /Para menor de 18/.test(t)),
      rentabilidade_12m: field("Rentabilidade (12m)", null, els),
      aplicacao_minima_lista: field("Aplicação mínima", null, els),
      prazo_resgate_lista: field("Prazo de resgate", null, els),
      taxa_produto_lista: field("Taxa do produto", null, els),
    };
  };

  const scrapeDetail = () => {
    const els = deepElements();
    const materiais = deepQueryAll('button[aria-label^="Faça o download do documento"]')
      .map((b) =>
        (b.getAttribute("aria-label") || "")
          .replace(/^Faça o download do documento\s*/i, "")
          .replace(/^Acessar material técnico\s*/i, "")
          .trim()
      )
      .filter(Boolean);
    const idMatch = /[?&]id=(\d+)/.exec(location.hash + location.search);
    const titulo = els.find(
      (e) =>
        e.tagName &&
        e.tagName.toLowerCase() === "h2" &&
        TXT(e).length > 3 &&
        !/^fundos de investimentos$/i.test(TXT(e))
    );
    return {
      id_produto: idMatch ? idMatch[1] : "",
      nome_detalhe: TXT(titulo),
      cnpj_fundo: field("CNPJ do fundo", null, els),
      aplicacao_minima: field("Aplicação mínima", null, els),
      carencia_1o_resgate: field("Carência para 1º resgate", null, els),
      taxas_produto: field("Taxas do Produto", null, els),
      taxa_performance: field("Taxa de performance", null, els),
      prazo_resgate: field("Prazo de resgate", null, els),
      para_quem: field("Para quem é a Previdência Privada", null, els),
      atualizacao_anual: field("Atualização anual da contribuição mensal", null, els),
      materiais: materiais.join(" | "),
      tem_pgbl: materiais.some((m) => /^PGBL$/i.test(m)),
      tem_vgbl: materiais.some((m) => /^VGBL$/i.test(m)),
      tem_pgbl_menor: materiais.some((m) => /menor PGBL/i.test(m)),
      tem_vgbl_menor: materiais.some((m) => /menor VGBL/i.test(m)),
    };
  };

  const onDetail = () => /details/.test(location.hash) && !!field("CNPJ do fundo");
  const onList = () => detailButtons().length > 0;

  const botaoVoltar = () =>
    deepQueryAll("button").find((b) => {
      const al = b.getAttribute("aria-label") || "";
      return al.startsWith("Voltar à página inicial") || TXT(b) === "Voltar";
    }) || null;

  const paginaBloqueada = () => {
    for (const el of deepElements()) {
      const t = TXT(el);
      if (t.length > 160) continue;
      if (/\bForbidden\b|\b403\b|sess[ãa]o\s+(expirada|encerrada)|tente novamente mais tarde/i.test(t)) return t.slice(0, 120);
    }
    return null;
  };

  const COLS = [
    "pagina", "indice", "id_produto", "nome_lista", "nome_detalhe", "categoria", "cnpj_fundo",
    "tem_pgbl", "tem_vgbl", "tem_pgbl_menor", "tem_vgbl_menor", "materiais",
    "risco_lista", "publico_lista", "para_quem", "menor_18",
    "rentabilidade_12m", "aplicacao_minima", "aplicacao_minima_lista",
    "carencia_1o_resgate", "prazo_resgate", "prazo_resgate_lista",
    "taxa_produto_lista", "taxas_produto", "taxa_performance", "atualizacao_anual",
  ];

  const toCsv = (rows) => {
    const esc = (v) => {
      const s = v === undefined || v === null ? "" : String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return "\ufeff" + [COLS.join(";")].concat(rows.map((r) => COLS.map((c) => esc(r[c])).join(";"))).join("\n");
  };

  const toTsv = (rows) => {
    const esc = (v) => (v === undefined || v === null ? "" : String(v).replace(/[\t\r\n]+/g, " "));
    return [COLS.join("\t")].concat(rows.map((r) => COLS.map((c) => esc(r[c])).join("\t"))).join("\n");
  };

  const download = (rows, name) => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
  };

  const showOutput = (rows, falhas) => {
    const old = document.querySelector("#" + OUTPUT_ID);
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = OUTPUT_ID;
    wrap.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647", "background:rgba(0,0,0,.6)",
      "display:flex", "align-items:center", "justify-content:center", "padding:24px",
    ].join(";");

    const box = document.createElement("div");
    box.style.cssText = [
      "background:#fff", "color:#14213d", "border-radius:12px", "padding:16px",
      "width:min(1100px,95vw)", "height:min(80vh,800px)", "display:flex", "flex-direction:column",
      "font:13px/1.4 system-ui,sans-serif", "box-shadow:0 8px 40px rgba(0,0,0,.4)",
    ].join(";");

    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px";

    const title = document.createElement("strong");
    title.textContent = `${rows.length} fundos${falhas && falhas.length ? ` · ${falhas.length} falhas` : ""}`;
    title.style.cssText = "margin-right:auto;font-size:14px";

    const mkBtn = (label, primary) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = [
        "border-radius:6px", "padding:6px 11px", "font:600 12px system-ui,sans-serif", "cursor:pointer",
        primary ? "background:#ff6900;color:#fff;border:0" : "background:#fff;color:#14213d;border:1px solid #c9ced6",
      ].join(";");
      return b;
    };

    const area = document.createElement("textarea");
    area.readOnly = true;
    area.spellcheck = false;
    area.style.cssText = [
      "flex:1", "width:100%", "resize:none", "border:1px solid #c9ced6", "border-radius:8px",
      "padding:8px", "font:11px/1.35 ui-monospace,Menlo,monospace", "white-space:pre",
      "overflow:auto", "color:#14213d", "background:#fbfcfd",
    ].join(";");

    let formato = "tsv";
    const render = () => {
      area.value = formato === "tsv" ? toTsv(rows) : toCsv(rows).replace(/^\ufeff/, "");
    };

    const copiar = mkBtn("copiar tudo", true);
    const alternar = mkBtn("formato: TSV (Excel)");
    const baixar = mkBtn("baixar .csv");
    const fechar = mkBtn("fechar");

    copiar.addEventListener("click", async () => {
      area.focus();
      area.select();
      let ok = false;
      try {
        await navigator.clipboard.writeText(area.value);
        ok = true;
      } catch (e) {
        try {
          ok = document.execCommand("copy");
        } catch (e2) {
          ok = false;
        }
      }
      copiar.textContent = ok ? "copiado ✓" : "use ⌘+C (já selecionado)";
      setTimeout(() => (copiar.textContent = "copiar tudo"), 2500);
    });

    alternar.addEventListener("click", () => {
      formato = formato === "tsv" ? "csv" : "tsv";
      alternar.textContent = formato === "tsv" ? "formato: TSV (Excel)" : "formato: CSV (;)";
      render();
    });

    baixar.addEventListener("click", () => download(rows, CSV_NAME));
    fechar.addEventListener("click", () => wrap.remove());
    wrap.addEventListener("click", (ev) => {
      if (ev.target === wrap) wrap.remove();
    });

    head.appendChild(title);
    head.appendChild(copiar);
    head.appendChild(alternar);
    head.appendChild(baixar);
    head.appendChild(fechar);
    box.appendChild(head);
    box.appendChild(area);
    wrap.appendChild(box);
    document.body.appendChild(wrap);

    render();
    area.focus();
    area.select();
  };

  const loadParcial = () => {
    for (const store of [() => localStorage, () => sessionStorage]) {
      try {
        const raw = store().getItem(STORE_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length) return arr;
        }
      } catch (e) {}
    }
    return Array.isArray(window.__prevMemoria) ? window.__prevMemoria.slice() : [];
  };

  const saveParcial = (rows) => {
    window.__prevMemoria = rows.slice();
    const json = JSON.stringify(rows);
    for (const store of [() => localStorage, () => sessionStorage]) {
      try {
        store().setItem(STORE_KEY, json);
      } catch (e) {}
    }
  };

  const parseTabular = (texto) => {
    const linhas = String(texto || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (linhas.length < 2) return [];
    const sep = linhas[0].indexOf("\t") >= 0 ? "\t" : linhas[0].indexOf(";") >= 0 ? ";" : ",";
    const head = linhas[0].replace(/^\ufeff/, "").split(sep).map((h) => h.trim());
    const out = [];
    for (let i = 1; i < linhas.length; i++) {
      const celulas = linhas[i].split(sep);
      const reg = {};
      head.forEach((h, j) => {
        reg[h] = (celulas[j] || "").trim();
      });
      if (reg.nome_lista || reg.nome_detalhe || reg.cnpj_fundo) out.push(reg);
    }
    return out;
  };

  const run = async () => {
    if (state.running) return;
    state.parar = false;
    setBusy(true);

    const rows = loadParcial();
    const falhas = [];
    const feitos = new Set();
    for (const r of rows) {
      if (r.nome_lista) feitos.add(r.nome_lista);
      if (r.nome_detalhe) feitos.add(r.nome_detalhe);
    }
    let pulados = 0;
    let abortar = null;
    state.rows = rows;
    state.falhas = falhas;
    window.__fundosPrev = rows;
    window.__fundosPrevFalhas = falhas;

    const ctx0 = await waitFor(contexto, 12000);
    if (!ctx0) {
      setStatus("não achei o paginador da previdência", true);
      setBusy(false);
      return;
    }

    const total = ctx0.total;
    const alvo = totalProdutos();
    const pInicial = Math.max(1, parseInt(state.inicioPagina || 1, 10) || 1);
    const iInicial = Math.max(1, parseInt(state.inicioIndice || 1, 10) || 1);
    setStatus(`${total || "?"} páginas · ${alvo || "?"} produtos · início pág ${pInicial}/item ${iInicial}`);

    for (let k = 1; k < pInicial; k++) {
      setStatus(`posicionando: pág ${k + 1}/${pInicial}`);
      if (!(await avancar())) {
        falhas.push({ pagina: k + 1, motivo: "não consegui posicionar na página inicial" });
        break;
      }
    }

    let primeira = true;

    for (let volta = 0; volta < 60; volta++) {
      if (!(await waitFor(onList, 15000))) {
        falhas.push({ pagina: volta + 1, motivo: "lista não carregou" });
        break;
      }

      const keyPagina = firstCardKey();
      const qtd = detailButtons().length;
      const pagAtual = (pageState() || {}).current || volta + 1;
      const iStart = primeira ? iInicial - 1 : 0;
      primeira = false;

      for (let i = iStart; i < qtd; i++) {
        if (state.parar) {
          abortar = "parado por você";
          break;
        }
        if (firstCardKey() !== keyPagina && !(await acharPagina(keyPagina))) {
          falhas.push({ pagina: pagAtual, indice: i + 1, motivo: "perdi a página ao voltar" });
          break;
        }

        const btn = detailButtons()[i];
        if (!btn) {
          falhas.push({ pagina: pagAtual, indice: i + 1, motivo: "cartão ausente" });
          continue;
        }

        const base = scrapeCard(btn);

        if (base.nome_lista && feitos.has(base.nome_lista)) {
          pulados++;
          setStatus(`pág ${pagAtual}/${total || "?"} · ${i + 1}/${qtd} · ${rows.length} coletados · ${pulados} pulados`);
          continue;
        }

        setStatus(`pág ${pagAtual}/${total || "?"} · ${i + 1}/${qtd} · ${rows.length} coletados`);
        btn.click();

        let ok = await waitFor(onDetail, TIMEOUT_DETALHE);

        for (let tent = 0; !ok && tent < ESPERAS.length; tent++) {
          const bloqueio = paginaBloqueada();
          setStatus(
            `${bloqueio ? "bloqueio: " + bloqueio : "detalhe travou"} — aguardando ${ESPERAS[tent] / 1000}s (tentativa ${tent + 1}/${ESPERAS.length})`,
            true
          );
          await SLEEP(ESPERAS[tent]);

          const vb = botaoVoltar();
          if (vb) vb.click();
          if (!(await waitFor(onList, 30000))) continue;
          if (firstCardKey() !== keyPagina && !(await acharPagina(keyPagina))) break;

          const denovo = detailButtons()[i];
          if (!denovo) break;
          denovo.click();
          ok = await waitFor(onDetail, TIMEOUT_DETALHE);
        }

        if (ok) {
          const reg = Object.assign({ pagina: pagAtual, indice: i + 1 }, base, scrapeDetail());
          rows.push(reg);
          if (reg.nome_lista) feitos.add(reg.nome_lista);
          saveParcial(rows);
        } else {
          const bloqueio = paginaBloqueada();
          falhas.push({
            pagina: pagAtual,
            indice: i + 1,
            nome: base.nome_lista,
            motivo: bloqueio ? "bloqueado: " + bloqueio : "detalhe não carregou",
          });
          if (bloqueio) {
            abortar = bloqueio;
            break;
          }
        }

        const voltar = botaoVoltar();
        if (voltar) voltar.click();
        else history.back();
        await waitFor(onList, 30000);
        await SLEEP(PAUSA_ENTRE_FUNDOS);
      }

      if (abortar) break;
      if (alvo && rows.length >= alvo) break;
      await SLEEP(PAUSA_ENTRE_PAGINAS);
      if (!(await avancar())) break;
    }

    setBusy(false);
    if (abortar) {
      setStatus(`interrompido (${abortar}) · ${rows.length} salvos — relogue e clique de novo para retomar`, true);
    } else {
      setStatus(`fim: ${rows.length} fundos, ${pulados} pulados, ${falhas.length} falhas`, falhas.length > 0);
    }
    showOutput(rows, falhas);
    if (falhas.length) console.table(falhas);
    console.log("[prev-extractor] dados em window.__fundosPrev | falhas em window.__fundosPrevFalhas");
  };

  const mount = () => {
    if (document.querySelector("#" + PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "position:fixed", "right:16px", "bottom:16px", "z-index:2147483647",
      "background:#14213d", "color:#fff", "font:13px/1.4 system-ui,sans-serif",
      "padding:10px 12px", "border-radius:10px", "box-shadow:0 4px 16px rgba(0,0,0,.35)",
      "max-width:290px",
    ].join(";");

    const btn = document.createElement("button");
    btn.id = RUN_ID;
    btn.textContent = "extrair previdência → CSV";
    btn.style.cssText = [
      "background:#ff6900", "color:#fff", "border:0", "border-radius:6px",
      "padding:7px 10px", "font:600 13px system-ui,sans-serif", "cursor:pointer", "width:100%",
    ].join(";");

    const parcialBtn = document.createElement("button");
    parcialBtn.textContent = "mostrar parcial salvo";
    parcialBtn.style.cssText = [
      "margin-top:6px", "background:transparent", "color:#9ecbff", "border:1px solid #9ecbff",
      "border-radius:6px", "padding:4px 8px", "font:12px system-ui,sans-serif", "cursor:pointer", "width:100%",
    ].join(";");

    const pararBtn = document.createElement("button");
    pararBtn.textContent = "parar";
    pararBtn.style.cssText = [
      "margin-top:6px", "background:transparent", "color:#ffb4a2", "border:1px solid #ffb4a2",
      "border-radius:6px", "padding:4px 8px", "font:12px system-ui,sans-serif", "cursor:pointer", "width:100%",
    ].join(";");

    const seedBtn = document.createElement("button");
    seedBtn.textContent = "colar coleta anterior";
    seedBtn.style.cssText = [
      "margin-top:6px", "background:transparent", "color:#9ecbff", "border:1px solid #9ecbff",
      "border-radius:6px", "padding:4px 8px", "font:12px system-ui,sans-serif", "cursor:pointer", "width:100%",
    ].join(";");

    const linhaInicio = document.createElement("div");
    linhaInicio.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:7px;font-size:11px";
    const mkNum = (valor, largura) => {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = "1";
      inp.value = String(valor);
      inp.style.cssText = `width:${largura};background:#0d1730;color:#fff;border:1px solid #3b4a6b;border-radius:4px;padding:3px 5px;font:12px system-ui`;
      return inp;
    };
    const inPag = mkNum(state.inicioPagina || 1, "46px");
    const inIdx = mkNum(state.inicioIndice || 1, "46px");
    const rot1 = document.createElement("span");
    rot1.textContent = "começar pág";
    const rot2 = document.createElement("span");
    rot2.textContent = "item";
    inPag.addEventListener("change", () => {
      state.inicioPagina = inPag.value;
    });
    inIdx.addEventListener("change", () => {
      state.inicioIndice = inIdx.value;
    });
    linhaInicio.appendChild(rot1);
    linhaInicio.appendChild(inPag);
    linhaInicio.appendChild(rot2);
    linhaInicio.appendChild(inIdx);

    const esconder = document.createElement("button");
    esconder.textContent = "esconder painel";
    esconder.style.cssText = [
      "margin-top:6px", "background:transparent", "color:#b9c2cf", "border:0",
      "font:11px system-ui,sans-serif", "cursor:pointer", "width:100%", "text-decoration:underline",
    ].join(";");

    const limpar = document.createElement("button");
    limpar.textContent = "limpar parcial e começar do zero";
    limpar.style.cssText = [
      "margin-top:4px", "background:transparent", "color:#ffb4a2", "border:0",
      "font:11px system-ui,sans-serif", "cursor:pointer", "width:100%", "text-decoration:underline",
    ].join(";");

    const msg = document.createElement("div");
    msg.id = STATUS_ID;
    msg.style.cssText = "margin-top:7px;font-size:12px;opacity:.9;word-break:break-word";

    btn.addEventListener("click", () => run());
    parcialBtn.addEventListener("click", () => {
      const rows = loadParcial();
      if (!rows.length) return setStatus("nada salvo ainda", true);
      showOutput(rows, []);
      setStatus(`parcial na tela: ${rows.length} linhas`);
    });
    pararBtn.addEventListener("click", () => {
      state.parar = true;
      setStatus("parando ao terminar o fundo atual...", true);
    });

    seedBtn.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.style.cssText = [
        "position:fixed", "inset:0", "z-index:2147483647", "background:rgba(0,0,0,.6)",
        "display:flex", "align-items:center", "justify-content:center", "padding:24px",
      ].join(";");
      const caixa = document.createElement("div");
      caixa.style.cssText = [
        "background:#fff", "color:#14213d", "border-radius:12px", "padding:16px",
        "width:min(900px,95vw)", "height:min(70vh,600px)", "display:flex", "flex-direction:column",
        "font:13px system-ui,sans-serif",
      ].join(";");
      const rotulo = document.createElement("div");
      rotulo.textContent = "Cole aqui o TSV/CSV da coleta anterior (com a linha de cabeçalho):";
      rotulo.style.cssText = "margin-bottom:8px;font-weight:600";
      const ta = document.createElement("textarea");
      ta.style.cssText = [
        "flex:1", "width:100%", "resize:none", "border:1px solid #c9ced6", "border-radius:8px",
        "padding:8px", "font:11px ui-monospace,Menlo,monospace", "color:#14213d",
      ].join(";");
      const acoes = document.createElement("div");
      acoes.style.cssText = "display:flex;gap:8px;margin-top:10px;justify-content:flex-end";
      const carregar = document.createElement("button");
      carregar.textContent = "carregar";
      carregar.style.cssText = "background:#ff6900;color:#fff;border:0;border-radius:6px;padding:7px 14px;font:600 12px system-ui;cursor:pointer";
      const cancelar = document.createElement("button");
      cancelar.textContent = "cancelar";
      cancelar.style.cssText = "background:#fff;color:#14213d;border:1px solid #c9ced6;border-radius:6px;padding:7px 14px;font:600 12px system-ui;cursor:pointer";
      carregar.addEventListener("click", () => {
        const regs = parseTabular(ta.value);
        if (!regs.length) {
          rotulo.textContent = "não reconheci nenhuma linha — confira se o cabeçalho veio junto";
          rotulo.style.color = "#b00";
          return;
        }
        saveParcial(regs);
        wrap.remove();
        setStatus(`${regs.length} carregados · clique em retomar`);
        btn.textContent = `retomar (${regs.length} feitos) → CSV`;
      });
      cancelar.addEventListener("click", () => wrap.remove());
      acoes.appendChild(cancelar);
      acoes.appendChild(carregar);
      caixa.appendChild(rotulo);
      caixa.appendChild(ta);
      caixa.appendChild(acoes);
      wrap.appendChild(caixa);
      document.body.appendChild(wrap);
      ta.focus();
    });

    esconder.addEventListener("click", () => {
      state.escondido = true;
      panel.remove();
      console.log("[prev-extractor] escondido; rode __prevMostrar()");
    });
    limpar.addEventListener("click", () => {
      try {
        localStorage.removeItem(STORE_KEY);
      } catch (e) {}
      setStatus("parcial apagado · próxima execução começa do zero");
      btn.textContent = "extrair previdência → CSV";
    });

    panel.appendChild(btn);
    panel.appendChild(pararBtn);
    panel.appendChild(linhaInicio);
    panel.appendChild(parcialBtn);
    panel.appendChild(seedBtn);
    panel.appendChild(esconder);
    panel.appendChild(limpar);
    panel.appendChild(msg);
    document.body.appendChild(panel);

    setBusy(state.running);
    const parcial = loadParcial();
    if (parcial.length) btn.textContent = `retomar (${parcial.length} feitos) → CSV`;
    if (state.status) {
      setStatus(state.status, state.warn);
    } else {
      const st = pageState();
      const alvo = totalProdutos();
      setStatus(
        parcial.length
          ? `${parcial.length} de ${alvo || "?"} já coletados · vai pular esses`
          : st
          ? `pronto · ${st.total} páginas · ${alvo || "?"} produtos`
          : "pronto (paginador ainda não visível)"
      );
    }
  };

  const sync = () => {
    if (state.escondido) return;
    if (document.querySelector("#" + PANEL_ID)) return;
    if (state.running || detailButtons().length > 0 || /products|details/.test(location.hash)) mount();
  };

  const hookRoute = () => {
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m];
      if (typeof orig === "function" && !orig.__vcdWrapped) {
        const wrapped = function () {
          const r = orig.apply(this, arguments);
          setTimeout(sync, 300);
          return r;
        };
        wrapped.__vcdWrapped = true;
        history[m] = wrapped;
      }
    }
    addEventListener("hashchange", () => setTimeout(sync, 300), true);
    addEventListener("popstate", () => setTimeout(sync, 300), true);
  };

  window.__prevMostrar = () => {
    state.escondido = false;
    mount();
  };
  window.__prevRodar = () => run();
  window.__prevEstado = () => state;
  window.__prevDiag = () => {
    const ctx = contexto();
    const d = {
      shadowRoots: deepRoots().length - 1,
      cartoes: detailButtons().length,
      paginadorAchado: !!ctx,
      pagina: ctx ? `${ctx.current}/${ctx.total}` : null,
      nextOk: ctx ? !desabilitado(ctx.next) : null,
      prevOk: ctx ? !desabilitado(ctx.prev) : null,
      raizEhDocument: ctx ? ctx.raiz === document : null,
      totalProdutos: totalProdutos(),
      primeiroCartao: firstCardKey(),
    };
    console.log(d);
    return d;
  };

  const legado = neutralizarAntigo();
  console.log("[prev-extractor] v1.8.0 |", legado);
  console.log("[prev-extractor] diagnóstico:", window.__prevDiag());

  hookRoute();
  sync();
  setInterval(sync, 1000);
})();

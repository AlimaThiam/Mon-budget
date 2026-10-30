(() => {
  const Calc = window.BudgetCalc;
  const DEFAULT_CATS = [
    { id: "logement", name: "Logement", kind: "out", color: "#3f6fb5", budget: 0 },
    { id: "courses", name: "Courses", kind: "out", color: "#2f9e72", budget: 0 },
    { id: "transport", name: "Transport", kind: "out", color: "#d08a2c", budget: 0 },
    { id: "factures", name: "Factures", kind: "out", color: "#7a5bc2", budget: 0 },
    { id: "sante", name: "Santé", kind: "out", color: "#cf4f6b", budget: 0 },
    { id: "loisirs", name: "Loisirs", kind: "out", color: "#2aa0b8", budget: 0 },
    { id: "autres-dep", name: "Autres dépenses", kind: "out", color: "#8a948f", budget: 0 },
    { id: "salaire", name: "Salaire", kind: "in", color: "#23854f", budget: 0 },
    { id: "autres-rev", name: "Autres revenus", kind: "in", color: "#6aa84f", budget: 0 },
  ];
  const PALETTE = ["#3f6fb5", "#2f9e72", "#d08a2c", "#7a5bc2", "#cf4f6b", "#2aa0b8", "#b5643f", "#5d8a2f", "#a04a9c"];
  const LOCAL_KEY = "mon-budget-v1";

  const state = {
    txs: [],
    settings: { currency: "XOF", categories: DEFAULT_CATS },
    month: new Date().toISOString().slice(0, 7),
    editing: null,
    navigated: false,
    type: "out",
    mode: "loading",
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => {
    try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: state.settings.currency || "XOF", maximumFractionDigits: ["XOF", "XAF"].includes(state.settings.currency) ? 0 : 2 }).format(n); }
    catch { return n.toFixed(2); }
  };
  const catById = (id) => state.settings.categories.find((c) => c.id === id) || { id, name: "Sans catégorie", color: "#8a948f", kind: "out", budget: 0 };
  const monthName = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  };
  const { shiftMonth, parseAmount, totals } = Calc;
  const startDay = () => Calc.clampStartDay(state.settings.startDay);
  const periodStart = (ym) => Calc.periodStart(ym, startDay());
  const inPeriod = (date, ym) => Calc.inPeriod(date, ym, startDay());
  const periodOf = (date) => Calc.periodOf(date, startDay());
  const periodName = (ym) => {
    if (startDay() === 1) return monthName(ym);
    const [y, m] = ym.split("-").map(Number);
    const a = new Date(y, m - 1, startDay()), b = new Date(y, m, startDay() - 1);
    return a.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " – " + b.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  };
  const defaultDate = (ym) => { const d = today(); return inPeriod(d, ym) ? d : periodStart(ym); };
  const today = () => Calc.isoDate(new Date());
  const setStatus = (text, kind) => { const el = $("status"); el.textContent = text; el.dataset.kind = kind || ""; };

  // ---------- storage: browser storage on this device ----------
  let store = null;
  const SAVE_FAILED = "la mémoire du navigateur est pleine ou bloquée (navigation privée ?). Fais une sauvegarde JSON.";

  function localStore() {
    const read = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; } };
    const write = (d) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); return true; } catch { return false; } };
    let data = read();
    // Data saved before XOF became the default keeps the euro it was entered in.
    if (!data.settings && data.txs && Object.keys(data.txs).length) data.settings = { currency: "EUR", categories: DEFAULT_CATS };
    const emit = () => {
      state.txs = Object.entries(data.txs || {}).map(([id, t]) => ({ id, ...t }));
      if (data.settings) { state.settings = data.settings; if (!state.navigated) state.month = periodOf(today()); }
      render();
    };
    // Keep the change only once it is really written, so nothing vanishes on reload.
    const commit = (next) => {
      if (!write(next)) { setStatus("Tes dernières modifications n'ont pas pu être enregistrées : " + SAVE_FAILED, "warn"); throw new Error(SAVE_FAILED); }
      data = next;
      emit();
    };
    return {
      start() {
        emit();
        if (!write(data)) setStatus("Attention : ce navigateur ne peut pas enregistrer tes données (navigation privée ?). Elles seront perdues à la fermeture.", "warn");
      },
      async addTx(t) { commit({ ...data, txs: { ...(data.txs || {}), [newTxId()]: t } }); },
      async delTx(id) { const txs = { ...(data.txs || {}) }; delete txs[id]; commit({ ...data, txs }); },
      async updateTx(id, t) { commit({ ...data, txs: { ...(data.txs || {}), [id]: strip(t) } }); },
      async saveSettings(s) { commit({ ...data, settings: s }); },
      async replaceAll(txs, settings) { commit({ txs: Object.fromEntries(txs.map((t) => [t.id, strip(t)])), settings }); },
    };
  }

  const strip = (t) => {
    const o = { type: t.type, amount: t.amount, date: t.date, cat: t.cat, note: t.note || "", createdAt: t.createdAt || Date.now() };
    if (t.recur) o.recur = t.recur;
    return o;
  };

  const newTxId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Online account (sync.js gives `api`, a thin layer over Firestore). Writes are not awaited:
  // Firestore applies them to its offline cache at once and sends them when the connection is back.
  function cloudStore(api) {
    let stops = [];
    const failed = () => setStatus("Une modification n'a pas pu être synchronisée. Vérifie ta connexion puis recharge la page.", "warn");
    const send = (p) => { p.catch(failed); };
    let pendingTx = false, pendingSettings = false, offline = false;
    const sync = () => setStatus(offline || pendingTx || pendingSettings
      ? "Modifications gardées sur cet appareil : elles seront synchronisées dès que tu auras internet."
      : "Synchronisé avec ton compte : tes données sont sur tous tes appareils.");
    return {
      start() {
        stops = [
          api.onTxs((txs, meta) => {
            state.txs = txs;
            pendingTx = meta.pending; offline = meta.fromCache;
            sync(); render();
          }, () => setStatus("Lecture de tes opérations interrompue. Recharge la page.", "warn")),
          api.onSettings((s, meta) => {
            if (s && Array.isArray(s.categories)) {
              state.settings = s;
              if (!state.navigated && !state.editing) { state.month = periodOf(today()); $("fDate").value = defaultDate(state.month); }
            }
            pendingSettings = meta.pending;
            sync(); render();
          }, () => setStatus("Lecture de tes réglages interrompue. Recharge la page.", "warn")),
        ];
      },
      stop() { stops.forEach((f) => f()); stops = []; },
      async addTx(t) { send(api.setTx(newTxId(), strip(t))); },
      async delTx(id) { send(api.delTx(id)); },
      async updateTx(id, t) { send(api.setTx(id, strip(t))); },
      async saveSettings(s) { send(api.setSettings(s)); },
      async replaceAll(txs, settings) { await api.replaceAll(txs.map((t) => ({ id: t.id, ...strip(t) })), settings); },
    };
  }

  const LOCAL_STATUS = "Tes données restent sur cet appareil. Pense à faire une sauvegarde de temps en temps.";
  function useStore(next, mode) {
    store?.stop?.();
    state.txs = [];
    state.settings = { currency: "XOF", categories: DEFAULT_CATS };
    state.navigated = false;
    if (state.editing) stopEdit();
    state.mode = mode;
    store = next;
    store.start();
    render();
  }

  // Used by sync.js (loaded as a module, after this file).
  window.MonBudget = {
    useCloud(api) { useStore(cloudStore(api), "cloud"); },
    useLocal(status) { useStore(localStore(), "local"); setStatus(status || LOCAL_STATUS); },
    // What this device holds without an account, to send it to the account on first sign-in.
    readLocal() {
      let d = {};
      try { d = JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { d = {}; }
      return { txs: Object.entries(d.txs || {}).map(([id, t]) => ({ id, ...strip(t) })), settings: d.settings || null };
    },
    clearLocal() { try { localStorage.removeItem(LOCAL_KEY); } catch {} },
    setStatus,
  };

  function init() {
    state.mode = "local";
    store = localStore();
    setStatus(LOCAL_STATUS);
    store.start();
  }

  // ---------- render ----------
  function monthTxs(ym) { return state.txs.filter((t) => inPeriod(t.date, ym)); }
  const carryFor = (ym) => (state.settings.carry === false ? 0 : Calc.carryFor(state.txs, ym, startDay()));

  function render() {
    $("monthLabel").textContent = periodName(state.month);
    renderCatSelect();
    const list = monthTxs(state.month);
    const { inc, out, save } = totals(list);
    const prevList = monthTxs(shiftMonth(state.month, -1));
    const prev = totals(prevList);
    const carry = carryFor(state.month);
    const outCats = state.settings.categories.filter((c) => c.kind === "out");
    const budgetTotal = outCats.reduce((s, c) => s + (Number(c.budget) || 0), 0);

    $("kIn").textContent = fmt(inc);
    $("kOut").textContent = fmt(out);
    $("kInSub").textContent = list.filter((t) => t.type === "in").length + " entrée(s)";
    $("kOutSub").textContent = prev.out > 0 ? (out >= prev.out ? "+" : "−") + Math.abs(Math.round((out / prev.out - 1) * 100)) + " % vs mois précédent" : list.filter((t) => t.type === "out").length + " sortie(s)";
    const bal = carry + inc - out - save;
    $("kBal").textContent = fmt(bal);
    $("kBal").className = "num " + (bal >= 0 ? "pos" : "neg");
    $("kBalSub").textContent = save > 0 ? fmt(save) + " mis de côté ce mois" : carry ? "dont " + fmt(carry) + " reporté" : inc > 0 ? "Tu gardes " + Math.max(0, Math.round((bal / inc) * 100)) + " % de tes revenus" : "Ajoute tes revenus pour le calcul";
    if (budgetTotal > 0) {
      const budgeted = new Set(outCats.filter((c) => (Number(c.budget) || 0) > 0).map((c) => c.id));
      const left = budgetTotal - list.filter((t) => t.type === "out" && budgeted.has(t.cat)).reduce((s, t) => s + t.amount, 0);
      $("kLeft").textContent = fmt(left);
      $("kLeft").className = "num " + (left >= 0 ? "" : "neg");
      $("kLeftSub").textContent = "sur " + fmt(budgetTotal) + " prévus";
    } else {
      $("kLeft").textContent = "–";
      $("kLeft").className = "num";
      $("kLeftSub").textContent = "Fixe tes budgets dans les réglages";
    }

    renderStart(inc, out, save, carry);
    renderReport(list, prevList, { inc, out, save, carry });
    renderFixed();
    renderSavings();
    renderList(list);
    renderBudgets(list, outCats);
    renderDonut(list);
    renderTrend();
    renderCatEditor();
    $("currency").value = state.settings.currency || "XOF";
    renderBackupNudge();
    $("startDay").value = String(startDay());
    $("carryOn").checked = state.settings.carry !== false;
  }

  function renderBackupNudge() {
    const now = Date.now();
    const firstUse = state.txs.reduce((m, t) => (t.createdAt && t.createdAt < m ? t.createdAt : m), Infinity);
    // With an account the data is already kept online.
    const due = state.mode !== "cloud" && Calc.backupDue({ txCount: state.txs.length, lastBackup: state.settings.lastBackup, firstUse: Number.isFinite(firstUse) ? firstUse : 0, now })
      && !(Number(state.settings.backupSnooze) > now);
    const box = $("backupNudge");
    box.hidden = !due;
    if (!due) return;
    const last = Number(state.settings.lastBackup);
    $("backupText").textContent = (last
      ? "Ta dernière sauvegarde date du " + new Date(last).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + "."
      : "Tu n'as encore jamais fait de sauvegarde.")
      + " Tes données ne sont que sur cet appareil : si tu le perds ou vides le navigateur, tout disparaît.";
  }

  function renderReport(list, prevList, { inc, out, save, carry }) {
    const items = [];
    const avail = inc + carry;
    if (!list.length && !carry) {
      $("report").innerHTML = `<li>Ton bilan apparaîtra ici dès que tu auras noté ton argent du mois et quelques dépenses.</li>`;
      return;
    }
    const t = today();
    if (inPeriod(t, state.month) && avail > 0) {
      const days = Calc.daysLeft(t, state.month, startDay());
      const left = avail - out - save;
      if (left > 0) items.push(["", "Il te reste " + fmt(left) + " pour " + days + " jour" + (days > 1 ? "s" : "") + ", soit environ <b>" + fmt(left / days) + " par jour</b>."]);
      else items.push(["bad", "Tu as déjà utilisé tout ton argent de la période. Évite les dépenses non essentielles jusqu'à ta prochaine paie."]);
    }
    const p = totals(prevList);
    if (p.out > 0 && out > 0) {
      const diff = out / p.out - 1;
      if (Math.abs(diff) >= 0.05) items.push([diff > 0 ? "warn" : "good", "Tu as dépensé " + fmt(out) + ", soit " + Math.round(Math.abs(diff) * 100) + " % " + (diff > 0 ? "de plus" : "de moins") + " que la période précédente (" + fmt(p.out) + ")."]);
      else items.push(["good", "Tes dépenses sont stables par rapport à la période précédente."]);
    }
    const cur = {}, old = {};
    for (const x of list) if (x.type === "out") cur[x.cat] = (cur[x.cat] || 0) + x.amount;
    for (const x of prevList) if (x.type === "out") old[x.cat] = (old[x.cat] || 0) + x.amount;
    const over = state.settings.categories.filter((c) => c.kind === "out" && Number(c.budget) > 0 && (cur[c.id] || 0) > c.budget);
    for (const c of over.slice(0, 2)) items.push(["bad", "Budget <b>" + esc(c.name) + "</b> dépassé de " + fmt(cur[c.id] - c.budget) + "."]);
    let worst = null;
    for (const id of Object.keys(cur)) { const d = cur[id] - (old[id] || 0); if (old[id] && d > 0 && (!worst || d > worst.d)) worst = { id, d }; }
    if (worst && worst.d / old[worst.id] >= 0.15) {
      const c = catById(worst.id);
      items.push(["warn", "La plus forte hausse : <b>" + esc(c.name) + "</b> (+" + fmt(worst.d) + ")." + (Number(c.budget) > 0 ? "" : " Fixe-toi un budget, par exemple " + fmt(old[worst.id]) + " comme la période précédente.")]);
    }
    const top = Object.entries(cur).sort((a, b) => b[1] - a[1])[0];
    if (top && out > 0 && !worst) items.push(["", "Ton plus gros poste : <b>" + esc(catById(top[0]).name) + "</b>, " + Math.round((top[1] / out) * 100) + " % de tes dépenses."]);
    if (inc > 0) {
      const rate = save / inc;
      if (rate >= 0.1) items.push(["good", "Tu as mis de côté " + Math.round(rate * 100) + " % de ton argent du mois. Bravo !"]);
      else items.push(["", "Un repère souvent conseillé : épargner 10 % de ses revenus, soit " + fmt(inc * 0.1) + " pour toi" + (save > 0 ? " (tu en es à " + fmt(save) + ")." : ".")]);
    }
    $("report").innerHTML = items.map(([k, h]) => `<li class="${k}"><span>${h}</span></li>`).join("");
  }

  function renderStart(inc, out, save, carry) {
    const has = inc > 0;
    $("startEmpty").hidden = has;
    $("startFull").hidden = !has;
    const sel = $("sCat"), prev = sel.value;
    const cats = state.settings.categories.filter((c) => c.kind === "in");
    sel.innerHTML = cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    if (cats.some((c) => c.id === prev)) sel.value = prev;
    $("sCarryEmpty").textContent = carry ? "Report du mois précédent : " + fmt(carry) + ". Il sera ajouté à ton argent du mois." : "";
    if (!has) return;
    const avail = inc + carry;
    const left = avail - out - save;
    $("sIn").textContent = fmt(avail);
    $("sCarry").textContent = carry ? "dont " + fmt(carry) + " reporté" : "";
    $("sOut").textContent = fmt(out);
    $("sSave").textContent = fmt(save);
    $("sLeft").textContent = fmt(left);
    $("sLeft").className = "num big " + (left >= 0 ? "pos" : "neg");
    const pct = avail > 0 ? Math.min(1, (out + save) / avail) : 1;
    $("sBar").style.width = (pct * 100).toFixed(1) + "%";
    $("sBar").style.background = left < 0 ? "var(--expense)" : pct >= 0.85 ? "var(--warn)" : "var(--accent)";
    $("sHint").textContent = left < 0
      ? "Tu as utilisé " + fmt(-left) + " de plus que ton argent du mois."
      : "Tu as utilisé " + Math.round(pct * 100) + " % de ton argent du mois. Un autre revenu ? Choisis « Revenu » dans Nouvelle opération.";
  }

  const goalById = (id) => (state.settings.goals || []).find((g) => g.id === id) || { id, name: "Objectif supprimé", target: 0 };
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fixedDate = (r, ym) => Calc.fixedDate(r, ym, startDay());
  const fixedDone = (r, ym) => state.txs.some((t) => t.recur === r.id && inPeriod(t.date, ym));

  function renderFixed() {
    const items = state.settings.recurring || [];
    const xs = $("xCat"), prev = xs.value;
    const outCats = state.settings.categories.filter((c) => c.kind === "out");
    xs.innerHTML = outCats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    if (outCats.some((c) => c.id === prev)) xs.value = prev;
    if (!items.length) {
      $("fixedList").innerHTML = `<p class="hint" style="margin:0">Note ici ton loyer, tes factures, tes abonnements… Chaque mois, un clic suffit pour les ajouter à tes dépenses.</p>`;
      $("fixedAll").hidden = true;
      $("fixedDetails").open = true;
      return;
    }
    const sorted = [...items].sort((a, b) => (Number(a.day) || 1) - (Number(b.day) || 1));
    $("fixedList").innerHTML = sorted.map((r) => {
      const c = catById(r.cat);
      const done = fixedDone(r, state.month);
      return `<div class="fx-row">
        <div><div class="t">${esc(r.name)}</div><span class="chip"><i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)} · le ${Number(r.day) || 1}</span></div>
        <div class="amt neg">${fmt(r.amount)}</div>
        <div class="fx-actions">${done ? `<span class="done">✓ Ajoutée</span>` : `<button class="small-btn" data-addfixed="${esc(r.id)}">Ajouter</button>`}
        <button class="del" data-delfixed="${esc(r.id)}" aria-label="Supprimer ${esc(r.name)}">Suppr.</button></div>
      </div>`;
    }).join("");
    const todo = sorted.filter((r) => !fixedDone(r, state.month));
    $("fixedAll").hidden = todo.length < 2;
    $("fixedAll").textContent = "Ajouter les " + todo.length + " dépenses fixes de la période (" + fmt(todo.reduce((s, r) => s + r.amount, 0)) + ")";
  }

  function renderSavings() {
    const goals = state.settings.goals || [];
    const savedBy = {}, monthBy = {};
    let all = 0;
    for (const t of state.txs) if (t.type === "save") {
      savedBy[t.cat] = (savedBy[t.cat] || 0) + t.amount; all += t.amount;
      if (inPeriod(t.date, state.month)) monthBy[t.cat] = (monthBy[t.cat] || 0) + t.amount;
    }
    $("saveTotal").textContent = all > 0 ? fmt(all) + " épargnés au total" : "";
    const vs = $("vGoal"), prev = vs.value;
    vs.innerHTML = goals.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
    if (goals.some((g) => g.id === prev)) vs.value = prev;
    $("saveForm").hidden = !goals.length;
    if (!goals.length) {
      $("goalList").innerHTML = `<p class="hint" style="margin:0">Crée ton premier objectif, par exemple « Fonds d'urgence ». Ensuite, mets de côté un peu chaque mois : ce montant est retiré de ton argent du mois, mais compté comme épargne et non comme dépense.</p>`;
      $("goalDetails").open = true;
      return;
    }
    $("goalList").innerHTML = goals.map((g) => {
      const s = savedBy[g.id] || 0, tgt = Number(g.target) || 0, pct = tgt > 0 ? Math.min(1, s / tgt) : 0;
      return `<div class="bud">
        <div class="goal-top"><span class="name">${esc(g.name)}</span>
          <span class="fx-actions"><span class="num">${fmt(s)}${tgt ? " / " + fmt(tgt) : ""}</span><button class="del" data-delgoal="${esc(g.id)}" aria-label="Supprimer l'objectif ${esc(g.name)}">Suppr.</button></span></div>
        ${tgt ? `<div class="bar"><i style="width:${(pct * 100).toFixed(1)}%;background:var(--accent)"></i></div>` : ""}
        <span class="hint">${pct >= 1 ? "Objectif atteint, bravo !" : tgt ? Math.round(pct * 100) + " % atteint" : ""}${monthBy[g.id] ? (tgt ? " · " : "") + fmt(monthBy[g.id]) + " ce mois-ci" : ""}</span>
      </div>`;
    }).join("");
  }

  async function addFixed(r) {
    await store.addTx({ type: "out", amount: r.amount, date: fixedDate(r, state.month), cat: r.cat, note: r.name, recur: r.id, createdAt: Date.now() });
  }

  function arm(b, label) {
    if (b.hasAttribute("data-armed")) return true;
    b.setAttribute("data-armed", ""); b.textContent = label || "Confirmer";
    setTimeout(() => { if (b.isConnected) { b.removeAttribute("data-armed"); b.textContent = "Suppr."; } }, 3000);
    return false;
  }

  const isOther = (id) => { const c = catById(id); return /^autres?\b/i.test(c.name) || String(id).startsWith("autres"); };
  function updateNoteField() {
    const other = isOther($("fCat").value);
    $("noteField").classList.toggle("needed", other);
    $("fNoteLabel").textContent = other ? (state.type === "in" ? "Nom du revenu (obligatoire)" : "Nom de la dépense (obligatoire)") : "Note (facultatif)";
    $("fNote").placeholder = other ? (state.type === "in" ? "Ex. Vente d'un meuble" : "Ex. Cadeau d'anniversaire") : "Ex. Marché du samedi";
  }

  function renderCatSelect() {
    const sel = $("fCat");
    const prev = sel.value;
    const cats = state.settings.categories.filter((c) => c.kind === state.type);
    sel.innerHTML = cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    if (cats.some((c) => c.id === prev)) sel.value = prev;
    updateNoteField();
  }

  function renderList(list) {
    const sorted = [...list].sort((a, b) => (b.date + (b.createdAt || 0)).localeCompare(a.date + (a.createdAt || 0)));
    $("listCount").textContent = sorted.length ? sorted.length + " opération(s)" : "";
    if (!sorted.length) {
      $("list").innerHTML = `<p class="empty">${state.mode === "loading" ? "Chargement…" : "Aucune opération pour " + esc(periodName(state.month)) + ". Ajoute ta première dépense ou ton premier revenu ci-dessus."}</p>`;
      return;
    }
    $("list").innerHTML = sorted.map((t) => {
      const g = t.type === "save" ? goalById(t.cat) : null;
      const c = g ? { name: "Épargne", color: "var(--accent)" } : catById(t.cat);
      const d = new Date(t.date + "T00:00:00");
      const sign = t.type === "in" ? "+" : t.type === "save" ? "→" : "−";
      return `<div class="row${state.editing === t.id ? " editing" : ""}">
        <div class="day"><b>${d.getDate()}</b>${d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</div>
        <div class="what"><div class="t">${esc(t.note || (g ? g.name : c.name))}</div><span class="chip"><i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)}</span></div>
        <div class="amt ${t.type === "in" ? "pos" : t.type === "save" ? "save" : "neg"}">${sign} ${fmt(t.amount)}</div>
        <div class="row-actions">${t.type !== "save" ? `<button class="del" data-edit="${esc(t.id)}" aria-label="Modifier">Modif.</button>` : ""}<button class="del" data-id="${esc(t.id)}" aria-label="Supprimer">Suppr.</button></div>
      </div>`;
    }).join("");
  }

  function renderBudgets(list, outCats) {
    const spent = {};
    for (const t of list) if (t.type === "out") spent[t.cat] = (spent[t.cat] || 0) + t.amount;
    const rows = outCats.filter((c) => (Number(c.budget) || 0) > 0 || spent[c.id]);
    if (!rows.length) {
      $("budgets").innerHTML = `<p class="empty">Aucune dépense ni budget ce mois-ci. Ouvre « Catégories et réglages » pour fixer un montant par catégorie.</p>`;
      return;
    }
    $("budgets").innerHTML = rows.map((c) => {
      const s = spent[c.id] || 0, b = Number(c.budget) || 0;
      const pct = b > 0 ? s / b : 0;
      const flag = b > 0 && pct > 1 ? `<span class="flag over">Dépassé</span>` : b > 0 && pct >= 0.85 ? `<span class="flag near">Presque</span>` : "";
      const color = b > 0 && pct > 1 ? "var(--expense)" : c.color;
      return `<div class="bud">
        <div class="bud-top"><span class="name"><i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)} ${flag}</span>
        <span class="num">${fmt(s)}${b > 0 ? " / " + fmt(b) : ""}</span></div>
        ${b > 0 ? `<div class="bar"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%;background:${color}"></i></div>` : `<span class="hint">Pas de budget fixé</span>`}
      </div>`;
    }).join("");
  }

  function renderDonut(list) {
    const by = {};
    let total = 0;
    for (const t of list) if (t.type === "out") { by[t.cat] = (by[t.cat] || 0) + t.amount; total += t.amount; }
    const entries = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const svg = $("donut");
    if (!total) {
      svg.innerHTML = `<circle cx="60" cy="60" r="44" fill="none" stroke="var(--accent-soft)" stroke-width="18"/><text x="60" y="64" text-anchor="middle" font-size="9" fill="var(--muted)" font-family="var(--font-body)">Rien ce mois</text>`;
      $("legend").innerHTML = `<p class="hint" style="margin:0">Le graphique se remplit dès ta première dépense.</p>`;
      return;
    }
    const r = 44, C = 2 * Math.PI * r;
    let acc = 0;
    const arcs = entries.map(([id, v]) => {
      const len = (v / total) * C;
      const gap = entries.length > 1 ? Math.min(1.5, len / 3) : 0;
      const seg = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${esc(catById(id).color)}" stroke-width="18" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)"/>`;
      acc += len;
      return seg;
    }).join("");
    svg.innerHTML = arcs + `<text x="60" y="57" text-anchor="middle" font-size="7.5" fill="var(--muted)" font-family="var(--font-body)">Total</text><text x="60" y="70" text-anchor="middle" font-size="9.5" fill="var(--ink)" font-family="var(--font-num)">${esc(fmt(total))}</text>`;
    $("legend").innerHTML = entries.slice(0, 7).map(([id, v]) => {
      const c = catById(id);
      return `<div><i class="dot" style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span><span class="num">${Math.round((v / total) * 100)} %</span></div>`;
    }).join("");
  }

  function renderTrend() {
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(state.month, -i));
    const data = months.map((m) => ({ m, ...totals(monthTxs(m)) }));
    const max = Math.max(1, ...data.map((d) => Math.max(d.inc, d.out)));
    const W = 320, H = 150, padL = 4, padB = 22, padT = 16, plotH = H - padB - padT;
    const groupW = (W - padL) / 6, barW = Math.min(16, groupW / 3);
    let out = `<line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="var(--line)"/>`;
    out += `<line x1="0" x2="${W}" y1="${padT}" y2="${padT}" stroke="var(--line)" stroke-dasharray="2 3"/>`;
    out += `<text x="${W}" y="${padT - 4}" text-anchor="end">${esc(fmt(max))}</text>`;
    data.forEach((d, i) => {
      const cx = padL + groupW * i + groupW / 2;
      const hIn = (d.inc / max) * plotH, hOut = (d.out / max) * plotH;
      const cur = d.m === state.month;
      out += `<rect x="${cx - barW - 1}" y="${H - padB - hIn}" width="${barW}" height="${hIn}" rx="2" fill="var(--income)" opacity="${cur ? 1 : 0.55}"><title>Revenus : ${esc(fmt(d.inc))}</title></rect>`;
      out += `<rect x="${cx + 1}" y="${H - padB - hOut}" width="${barW}" height="${hOut}" rx="2" fill="var(--expense)" opacity="${cur ? 1 : 0.55}"><title>Dépenses : ${esc(fmt(d.out))}</title></rect>`;
      const [y, m] = d.m.split("-").map(Number);
      const lab = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
      out += `<text x="${cx}" y="${H - 6}" text-anchor="middle" ${cur ? 'style="fill:var(--ink);font-weight:500"' : ""}>${esc(lab)}</text>`;
    });
    $("trend").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenus et dépenses des six derniers mois">${out}</svg>`;
  }

  function renderCatEditor() {
    const host = $("catEditor");
    if (host.contains(document.activeElement)) return; // don't reset a field being edited
    const sortKey = (c) => (c.kind === "out" ? 0 : 1);
    host.innerHTML = [...state.settings.categories].sort((a, b) => sortKey(a) - sortKey(b)).map((c) => `
      <div class="cat-row" data-id="${esc(c.id)}">
        <input type="color" value="${esc(c.color)}" data-f="color" aria-label="Couleur de ${esc(c.name)}" id="col-${esc(c.id)}">
        <input value="${esc(c.name)}" data-f="name" maxlength="30" aria-label="Nom" id="name-${esc(c.id)}">
        ${c.kind === "out"
          ? `<input value="${c.budget ? c.budget : ""}" data-f="budget" inputmode="decimal" placeholder="Budget" aria-label="Budget mensuel de ${esc(c.name)}" id="bud-${esc(c.id)}">`
          : `<span class="kind">Revenu</span>`}
        <button class="del" data-delcat="${esc(c.id)}" aria-label="Supprimer la catégorie ${esc(c.name)}">Suppr.</button>
      </div>`).join("");
  }

  // ---------- actions ----------
  async function saveSettings(next) {
    const prev = state.settings;
    state.settings = next;
    render();
    try { await store.saveSettings(next); }
    catch (e) {
      state.settings = prev;
      render();
      $("toolsMsg").textContent = "Enregistrement impossible : " + (e?.message || "réessaie plus tard.");
    }
  }

  function setType(type) {
    state.type = type;
    document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.type === type)));
    $("fSubmit").textContent = state.editing ? "Enregistrer la modification" : type === "in" ? "Ajouter le revenu" : "Ajouter la dépense";
    renderCatSelect();
  }
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => setType(b.dataset.type)));

  function startEdit(id) {
    const t = state.txs.find((x) => x.id === id);
    if (!t) return;
    state.editing = id;
    $("addTitle").textContent = "Modifier l'opération";
    $("fCancel").hidden = false;
    setType(t.type === "in" ? "in" : "out");
    $("fCat").value = t.cat; updateNoteField();
    $("fAmount").value = String(t.amount).replace(".", ",");
    $("fDate").value = t.date;
    $("fNote").value = t.note || "";
    $("fError").textContent = "";
    render();
    $("txForm").scrollIntoView({ behavior: "smooth", block: "center" });
    $("fAmount").focus({ preventScroll: true });
  }
  function stopEdit() {
    state.editing = null;
    $("addTitle").textContent = "Nouvelle opération";
    $("fCancel").hidden = true;
    $("fAmount").value = ""; $("fNote").value = "";
    $("fDate").value = defaultDate(state.month);
    setType(state.type);
    render();
  }
  $("fCancel").addEventListener("click", stopEdit);

  $("txForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!store) return;
    const amount = parseAmount($("fAmount").value);
    const date = $("fDate").value;
    if (!(amount > 0)) { $("fError").textContent = "Indique un montant supérieur à 0, par exemple 12,50."; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $("fError").textContent = "Choisis une date."; return; }
    if (isOther($("fCat").value) && !$("fNote").value.trim()) { $("fError").textContent = "Donne un nom à cette opération, par exemple « Cadeau d'anniversaire »."; $("fNote").focus(); return; }
    if (!$("fCat").value) { $("fError").textContent = "Crée d'abord une catégorie dans les réglages."; return; }
    $("fError").textContent = "";
    const t = { type: state.type, amount, date, cat: $("fCat").value, note: $("fNote").value.trim(), createdAt: Date.now() };
    $("fSubmit").disabled = true;
    try {
      if (state.editing) {
        const old = state.txs.find((x) => x.id === state.editing);
        await store.updateTx(state.editing, { ...t, createdAt: old?.createdAt || t.createdAt, recur: old?.recur });
        stopEdit();
      } else {
        await store.addTx(t);
        $("fAmount").value = ""; $("fNote").value = "";
      }
      if (!inPeriod(date, state.month)) { state.month = periodOf(date); state.navigated = true; render(); }
      $("fAmount").focus();
    } catch (err) {
      $("fError").textContent = "L'opération n'a pas été enregistrée : " + (err?.message || "réessaie.");
    } finally { $("fSubmit").disabled = false; }
  });

  $("list").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) { startEdit(ed.dataset.edit); return; }
    const b = e.target.closest(".del[data-id]");
    if (!b) return;
    if (!b.hasAttribute("data-armed")) {
      b.setAttribute("data-armed", ""); b.textContent = "Confirmer";
      setTimeout(() => { if (b.isConnected) { b.removeAttribute("data-armed"); b.textContent = "Suppr."; } }, 3000);
      return;
    }
    try { if (state.editing === b.dataset.id) stopEdit(); await store.delTx(b.dataset.id); } catch { b.textContent = "Erreur"; }
  });

  $("startForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!store) return;
    const amount = parseAmount($("sAmount").value);
    if (!(amount > 0)) { $("sError").textContent = "Indique un montant supérieur à 0, par exemple 1500."; return; }
    if (!$("sCat").value) { $("sError").textContent = "Crée d'abord une catégorie de revenu dans les réglages."; return; }
    $("sError").textContent = "";
    const date = defaultDate(state.month);
    $("sSubmit").disabled = true;
    try {
      await store.addTx({ type: "in", amount, date, cat: $("sCat").value, note: "", createdAt: Date.now() });
      $("sAmount").value = "";
    } catch (err) {
      $("sError").textContent = "Le montant n'a pas été enregistré : " + (err?.message || "réessaie.");
    } finally { $("sSubmit").disabled = false; }
  });

  $("fCat").addEventListener("change", () => { updateNoteField(); if (isOther($("fCat").value)) $("fNote").focus(); });

  $("fixedForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("xName").value.trim(), amount = parseAmount($("xAmount").value), day = Math.round(Number($("xDay").value));
    if (!name) { $("xError").textContent = "Donne un nom, par exemple « Loyer »."; return; }
    if (!(amount > 0)) { $("xError").textContent = "Indique un montant supérieur à 0."; return; }
    if (!(day >= 1 && day <= 31)) { $("xError").textContent = "Le jour doit être entre 1 et 31."; return; }
    if (!$("xCat").value) { $("xError").textContent = "Crée d'abord une catégorie de dépense."; return; }
    $("xError").textContent = "";
    const r = { id: newId("r"), name, amount, cat: $("xCat").value, day };
    $("xName").value = ""; $("xAmount").value = ""; $("xDay").value = "1";
    $("fixedDetails").open = false;
    saveSettings({ ...state.settings, recurring: [...(state.settings.recurring || []), r] });
  });

  $("fixedList").addEventListener("click", async (e) => {
    const a = e.target.closest("[data-addfixed]");
    if (a) {
      const r = (state.settings.recurring || []).find((x) => x.id === a.dataset.addfixed);
      if (!r || fixedDone(r, state.month)) return;
      a.disabled = true;
      try { await addFixed(r); } catch { a.disabled = false; a.textContent = "Réessayer"; }
      return;
    }
    const d = e.target.closest("[data-delfixed]");
    if (d && arm(d)) saveSettings({ ...state.settings, recurring: (state.settings.recurring || []).filter((x) => x.id !== d.dataset.delfixed) });
  });

  $("fixedAll").addEventListener("click", async () => {
    const b = $("fixedAll");
    const todo = (state.settings.recurring || []).filter((r) => !fixedDone(r, state.month));
    b.disabled = true;
    try { for (const r of todo) await addFixed(r); }
    catch { b.textContent = "Une dépense n'a pas pu être ajoutée. Réessaie."; }
    finally { b.disabled = false; }
  });

  $("goalForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("gName").value.trim(), raw = $("gTarget").value.trim(), target = raw ? parseAmount(raw) : 0;
    if (!name) { $("gError").textContent = "Donne un nom à ton objectif."; return; }
    if (!(target >= 0)) { $("gError").textContent = "Le montant visé doit être un nombre, par exemple 100000."; return; }
    $("gError").textContent = "";
    $("gName").value = ""; $("gTarget").value = "";
    $("goalDetails").open = false;
    saveSettings({ ...state.settings, goals: [...(state.settings.goals || []), { id: newId("g"), name, target }] });
  });

  $("goalList").addEventListener("click", (e) => {
    const d = e.target.closest("[data-delgoal]");
    if (!d) return;
    const used = state.txs.some((t) => t.type === "save" && t.cat === d.dataset.delgoal);
    if (arm(d, used ? "Confirmer (l'historique reste)" : "Confirmer")) saveSettings({ ...state.settings, goals: (state.settings.goals || []).filter((g) => g.id !== d.dataset.delgoal) });
  });

  $("saveForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!store) return;
    const amount = parseAmount($("vAmount").value);
    if (!(amount > 0)) { $("vError").textContent = "Indique un montant supérieur à 0."; return; }
    $("vError").textContent = "";
    $("vSubmit").disabled = true;
    try {
      await store.addTx({ type: "save", amount, date: defaultDate(state.month), cat: $("vGoal").value, note: "", createdAt: Date.now() });
      $("vAmount").value = "";
    } catch (err) { $("vError").textContent = "Le montant n'a pas été enregistré : " + (err?.message || "réessaie."); }
    finally { $("vSubmit").disabled = false; }
  });

  const goTo = (ym) => { state.month = ym; state.navigated = true; if (!state.editing) $("fDate").value = defaultDate(ym); render(); };
  $("prev").addEventListener("click", () => goTo(shiftMonth(state.month, -1)));
  $("next").addEventListener("click", () => goTo(shiftMonth(state.month, 1)));

  const dsel = $("startDay");
  dsel.innerHTML = Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">${i + 1 === 1 ? "1er" : i + 1} du mois</option>`).join("");
  dsel.addEventListener("change", () => {
    const next = { ...state.settings, startDay: Number(dsel.value) };
    state.settings = next;
    state.month = periodOf(today());
    $("fDate").value = defaultDate(state.month);
    saveSettings(next);
  });
  $("carryOn").addEventListener("change", (e) => saveSettings({ ...state.settings, carry: e.target.checked }));

  $("catEditor").addEventListener("change", (e) => {
    const row = e.target.closest(".cat-row");
    if (!row || !e.target.dataset.f) return;
    const f = e.target.dataset.f;
    let v = e.target.value;
    if (f === "budget") { v = v.trim() === "" ? 0 : parseAmount(v); if (!(v >= 0)) { e.target.value = ""; return; } }
    if (f === "name" && !v.trim()) return;
    const cats = state.settings.categories.map((c) => (c.id === row.dataset.id ? { ...c, [f]: f === "name" ? v.trim() : v } : c));
    e.target.blur();
    saveSettings({ ...state.settings, categories: cats });
  });

  $("catEditor").addEventListener("click", (e) => {
    const b = e.target.closest("[data-delcat]");
    if (!b) return;
    const id = b.dataset.delcat;
    const used = state.txs.some((t) => t.cat === id);
    if (!b.hasAttribute("data-armed")) {
      b.setAttribute("data-armed", ""); b.textContent = used ? "Utilisée, confirmer" : "Confirmer";
      setTimeout(() => { if (b.isConnected) { b.removeAttribute("data-armed"); b.textContent = "Suppr."; } }, 3000);
      return;
    }
    saveSettings({ ...state.settings, categories: state.settings.categories.filter((c) => c.id !== id) });
  });

  $("addCat").addEventListener("click", () => {
    const name = $("newCatName").value.trim();
    if (!name) { $("newCatName").focus(); return; }
    const base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cat";
    let id = base, i = 2;
    while (state.settings.categories.some((c) => c.id === id)) id = base + "-" + i++;
    const color = PALETTE[state.settings.categories.length % PALETTE.length];
    $("newCatName").value = "";
    saveSettings({ ...state.settings, categories: [...state.settings.categories, { id, name, kind: $("newCatKind").value, color, budget: 0 }] });
  });

  $("currency").addEventListener("change", (e) => saveSettings({ ...state.settings, currency: e.target.value }));

  // ---------- export / import ----------
  function offer(filename, data, msg = $("toolsMsg")) {
    try {
      const url = URL.createObjectURL(new Blob([data], { type: filename.endsWith(".csv") ? "text/csv" : "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      msg.textContent = "Fichier enregistré : " + filename;
    } catch { msg.textContent = "Le téléchargement n'est pas disponible ici."; }
  }
  $("exportCsv").addEventListener("click", () => {
    const q = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
    const rows = [["Date", "Type", "Catégorie", "Note", "Montant"].map(q).join(";")];
    [...state.txs].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
      rows.push([t.date, t.type === "in" ? "Revenu" : t.type === "save" ? "Épargne" : "Dépense", t.type === "save" ? goalById(t.cat).name : catById(t.cat).name, t.note, (t.type === "in" ? t.amount : -t.amount).toFixed(2).replace(".", ",")].map(q).join(";"));
    });
    offer("budget-" + today() + ".csv", "﻿" + rows.join("\r\n"));
  });
  // On a phone, the share sheet lets the backup leave the device (Drive, WhatsApp, e-mail…). Elsewhere it is downloaded.
  // Returns the message to show the person.
  async function backup() {
    const filename = "budget-sauvegarde-" + today() + ".json";
    const data = JSON.stringify({ version: 1, settings: state.settings, transactions: state.txs }, null, 2);
    let file = null;
    try { file = new File([data], filename, { type: "application/json" }); } catch { file = null; }
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    let text;
    if (touch && file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Sauvegarde Mon Budget" }); }
      catch (e) { return e?.name === "AbortError" ? "Sauvegarde annulée." : "Le partage n'a pas marché. Réessaie."; }
      text = "Sauvegarde envoyée. Garde-la dans un endroit sûr (Drive, e-mail…).";
    } else {
      const m = { textContent: "" };
      offer(filename, data, m);
      if (!m.textContent.startsWith("Fichier")) return m.textContent;
      text = "Sauvegarde enregistrée dans tes Téléchargements (" + filename + "). Copie-la sur un Drive, une clé USB ou envoie-la-toi par e-mail.";
    }
    await saveSettings({ ...state.settings, lastBackup: Date.now(), backupSnooze: 0 });
    return text;
  }
  $("exportJson").addEventListener("click", async () => { $("toolsMsg").textContent = await backup(); });
  $("backupNow").addEventListener("click", async () => setStatus(await backup()));
  $("backupLater").addEventListener("click", () => saveSettings({ ...state.settings, backupSnooze: Date.now() + 7 * 86400000 }));
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !store) return;
    const msg = $("toolsMsg");
    let data, txs;
    try {
      data = JSON.parse(await file.text());
      if (!Array.isArray(data.transactions) || !data.settings || !Array.isArray(data.settings.categories)) throw new Error("format");
      txs = data.transactions.filter((t) => t && typeof t.id === "string" && /^[A-Za-z0-9_\-.~:@+]{1,100}$/.test(t.id) && Number(t.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
        .map((t) => ({ ...t, amount: Number(t.amount), type: ["in", "save"].includes(t.type) ? t.type : "out" }));
    } catch {
      msg.textContent = "Ce fichier n'est pas une sauvegarde Mon Budget valide.";
      return;
    }
    try {
      await store.replaceAll(txs, data.settings);
      msg.textContent = txs.length + " opération(s) importée(s). Elles remplacent les données précédentes.";
    } catch (err) {
      msg.textContent = "Import impossible : " + (err?.message || "réessaie.");
    }
  });

  $("fDate").value = today();
  init();
})();

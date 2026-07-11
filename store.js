/* ── Cofre — camada de dados (Supabase) ──────────────────
   Mesma API pública da v1 (localStorage). Agora o dado mora no
   Supabase e sincroniza cel/PC. Valores em CENTAVOS.

   Espelho em memória (`state`): o app.js segue lendo S.transactions
   etc. de forma síncrona. As escritas atualizam o espelho na hora
   (render imediato) e empurram pro Supabase em background; se o push
   falhar, avisa e recarrega do servidor pra ressincronizar. */

const Store = (() => {
  const HORIZON_MONTHS = 24; // até onde materializar séries indefinidas
  const sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);

  let state = null;

  /* ── datas util ── */
  const pad = n => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const ymOf = dateStr => dateStr.slice(0, 7);
  const currentYM = () => ymOf(todayStr());
  const daysInMonth = ym => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  };
  const addMonthsYM = (ym, n) => {
    const [y, m] = ym.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  };
  // mesma data em outro mês, dia clampado (31 → 30/28)
  const sameDayInYM = (dateStr, ym) => {
    const day = Number(dateStr.slice(8, 10));
    return `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`;
  };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));

  // só as colunas de transação (evita mandar created_at etc. em upsert/insert)
  const txCols = t => ({
    id: t.id, type: t.type, description: t.description, amount: t.amount,
    date: t.date, account_id: t.account_id, account_to: t.account_to,
    category_id: t.category_id, cleared: t.cleared,
    series_id: t.series_id, series_index: t.series_index,
  });

  /* ── auth ── */
  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  }
  const signIn = (email, password) => sb.auth.signInWithPassword({ email, password });
  const signOut = () => sb.auth.signOut();

  /* ── supabase helpers ── */
  // aguarda um builder do supabase, lança em erro
  async function q(builder) {
    const { data, error } = await builder;
    if (error) throw error;
    return data;
  }
  // empurra escrita em background; em erro, avisa e ressincroniza
  function push(fn) {
    Promise.resolve().then(fn).catch(async (err) => {
      console.error('[Cofre] sync falhou:', err);
      alert('Erro ao salvar no servidor:\n' + (err.message || err) + '\n\nRecarregando dados do servidor.');
      try { await load(); if (typeof window.render === 'function') window.render(); } catch (_) {}
    });
  }

  /* ── carga inicial (precisa de sessão) ── */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // token recém-emitido pode ser rejeitado como "issued at future" pelo validador
  // (tolerância ~zero). Numa 2ª tentativa o token já é velho o bastante e passa.
  const isClockErr = e => /future|issued at|jwt/i.test(e?.message || '');

  async function load() {
    let batch;
    for (let attempt = 0; ; attempt++) {
      try {
        batch = await Promise.all([
          q(sb.from('accounts').select('*').order('created_at')),
          q(sb.from('categories').select('*').order('created_at')),
          q(sb.from('series').select('*')),
          q(sb.from('transactions').select('*')),
          q(sb.from('prefs').select('*')),
        ]);
        break;
      } catch (e) {
        if (attempt < 2 && isClockErr(e)) { await sleep(1200); continue; }
        throw e;
      }
    }
    const [accounts, categories, series, transactions, prefsRows] = batch;
    const prefs = {};
    for (const r of prefsRows) prefs[r.key] = r.value;
    if (prefs.carry === undefined) prefs.carry = true;
    state = { accounts, categories, series, transactions, prefs };
    await ensureRecurringHorizon();
    return state;
  }

  /* ── séries indefinidas: garantir linhas até o horizonte ── */
  async function ensureRecurringHorizon() {
    const last = addMonthsYM(currentYM(), HORIZON_MONTHS);
    const newRows = [];
    for (const sr of state.series) {
      if (sr.kind !== 'recurring' || sr.end_month) continue;
      const rows = state.transactions.filter(t => t.series_id === sr.id);
      if (!rows.length) continue;
      rows.sort((a, b) => a.date < b.date ? -1 : 1);
      const tpl = rows[rows.length - 1];
      let ym = addMonthsYM(ymOf(tpl.date), 1);
      while (ym <= last) {
        const row = { ...txCols(tpl), id: uid(), date: sameDayInYM(tpl.date, ym), cleared: false };
        state.transactions.push(row);
        newRows.push(row);
        ym = addMonthsYM(ym, 1);
      }
    }
    if (newRows.length) await q(sb.from('transactions').insert(newRows));
  }

  /* ── CRUD ── */
  const get = () => state;

  function addAccount(name, initial) {
    const a = { id: uid(), name, initial, archived: false };
    state.accounts.push(a);
    push(() => q(sb.from('accounts').insert(a)));
    return a;
  }
  function updateAccount(id, patch) {
    Object.assign(state.accounts.find(a => a.id === id), patch);
    push(() => q(sb.from('accounts').update(patch).eq('id', id)));
  }
  function deleteAccount(id) {
    state.accounts = state.accounts.filter(a => a.id !== id);
    push(() => q(sb.from('accounts').delete().eq('id', id)));
  }

  function addCategory(name) {
    const c = { id: uid(), name, archived: false };
    state.categories.push(c);
    push(() => q(sb.from('categories').insert(c)));
    return c;
  }
  function updateCategory(id, patch) {
    Object.assign(state.categories.find(c => c.id === id), patch);
    push(() => q(sb.from('categories').update(patch).eq('id', id)));
  }
  function deleteCategory(id) {
    // no banco a FK (on delete set null) zera category_id das transações
    state.transactions.forEach(t => { if (t.category_id === id) t.category_id = null; });
    state.categories = state.categories.filter(c => c.id !== id);
    push(() => q(sb.from('categories').delete().eq('id', id)));
  }

  /* cria transação (com série, se repeat != none). Retorna a primeira linha. */
  function addTransaction(data, repeat, installments) {
    const base = {
      type: data.type, description: data.description, amount: data.amount,
      account_id: data.account_id, account_to: data.account_to ?? null,
      category_id: data.category_id ?? null, cleared: data.cleared,
    };
    const rows = [];
    let series = null, first = null;

    if (repeat === 'none') {
      first = { id: uid(), ...base, date: data.date, series_id: null, series_index: null };
      rows.push(first);
    } else if (repeat === 'installment') {
      series = { id: uid(), kind: 'installment', total: installments, end_month: null };
      for (let k = 0; k < installments; k++) {
        const ym = addMonthsYM(ymOf(data.date), k);
        const row = { id: uid(), ...base, date: sameDayInYM(data.date, ym), series_id: series.id, series_index: k + 1, cleared: k === 0 ? data.cleared : false };
        if (k === 0) first = row;
        rows.push(row);
      }
    } else { // recurring
      series = { id: uid(), kind: 'recurring', total: null, end_month: null };
      const last = addMonthsYM(currentYM(), HORIZON_MONTHS);
      let ym = ymOf(data.date), k = 0;
      while (ym <= last) {
        const row = { id: uid(), ...base, date: sameDayInYM(data.date, ym), series_id: series.id, series_index: null, cleared: k === 0 ? data.cleared : false };
        if (k === 0) first = row;
        rows.push(row);
        ym = addMonthsYM(ym, 1); k++;
      }
    }

    if (series) state.series.push(series);
    state.transactions.push(...rows);
    push(async () => {
      if (series) await q(sb.from('series').insert(series));
      await q(sb.from('transactions').insert(rows));
    });
    return first;
  }

  /* edita 1 linha */
  function updateTransaction(id, patch) {
    Object.assign(state.transactions.find(t => t.id === id), patch);
    push(() => q(sb.from('transactions').update(patch).eq('id', id)));
  }

  /* edita a linha + todas as futuras da mesma série.
     Se o dia mudou, desloca o dia das futuras também. */
  function updateTransactionForward(id, patch) {
    const tx = state.transactions.find(t => t.id === id);
    const newDay = patch.date ? Number(patch.date.slice(8, 10)) : null;
    const changed = [];
    for (const t of state.transactions) {
      if (t.id !== id && (t.series_id !== tx.series_id || t.date < tx.date)) continue;
      const p = { ...patch };
      if (t.id === id) { Object.assign(t, p); changed.push(t); continue; }
      delete p.date; delete p.cleared;
      if (newDay) {
        const ym = ymOf(t.date);
        p.date = `${ym}-${pad(Math.min(newDay, daysInMonth(ym)))}`;
      }
      Object.assign(t, p);
      changed.push(t);
    }
    push(() => q(sb.from('transactions').upsert(changed.map(txCols))));
  }

  function deleteTransaction(id) {
    state.transactions = state.transactions.filter(t => t.id !== id);
    push(() => q(sb.from('transactions').delete().eq('id', id)));
  }

  /* apaga a linha + futuras; série indefinida ganha end_month (não re-estende) */
  function deleteTransactionForward(id) {
    const tx = state.transactions.find(t => t.id === id);
    const sr = state.series.find(s => s.id === tx.series_id);
    const sid = tx.series_id, cutoff = tx.date;
    state.transactions = state.transactions.filter(t => t.series_id !== sid || t.date < cutoff);
    let endMonth = null;
    if (sr && sr.kind === 'recurring') { sr.end_month = addMonthsYM(ymOf(cutoff), -1); endMonth = sr.end_month; }
    push(async () => {
      await q(sb.from('transactions').delete().eq('series_id', sid).gte('date', cutoff));
      if (endMonth !== null) await q(sb.from('series').update({ end_month: endMonth }).eq('id', sid));
    });
  }

  function setPref(key, val) {
    state.prefs[key] = val;
    push(() => q(sb.from('prefs').upsert({ key, value: val })));
  }

  function seriesOf(tx) { return state.series.find(s => s.id === tx.series_id) || null; }

  return {
    getSession, signIn, signOut,
    load, get,
    addAccount, updateAccount, deleteAccount,
    addCategory, updateCategory, deleteCategory,
    addTransaction, updateTransaction, updateTransactionForward,
    deleteTransaction, deleteTransactionForward,
    setPref, seriesOf,
    util: { todayStr, ymOf, currentYM, addMonthsYM, daysInMonth, sameDayInYM },
  };
})();

/* ── Cofre — UI ──────────────────────────────────────── */

let S;                       // espelho de dados, preenchido no boot após login
const U = Store.util;

const ui = {
  ym: /^#\d{4}-\d{2}$/.test(location.hash) ? location.hash.slice(1) : U.currentYM(),
  view: 'ledger',
  editingId: null,   // id da transação em edição (null = nova)
  formType: 'expense',
};

/* ── helpers ── */
const $  = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = cents => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = cents => 'R$ ' + fmt(cents);

function parseMoney(str) {
  let s = String(str).trim().replace(/R\$\s*/i, '').replace(/\s/g, '').replace(/^[-+]/, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const v = Number(s);
  if (!isFinite(v) || v <= 0) return null;
  return Math.round(v * 100);
}

const MONTHS = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const ymLabel = ym => {
  const [y, m] = ym.split('-').map(Number);
  return { name: MONTHS[m - 1], year: y };
};
const dmy = dateStr => dateStr.slice(8, 10) + '/' + dateStr.slice(5, 7) + '/' + dateStr.slice(0, 4);
function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const accById = id => S.accounts.find(a => a.id === id);
const catById = id => S.categories.find(c => c.id === id);

/* ── contabilidade ── */
// efeito numa conta específica
function signedForAccount(t, accId) {
  if (t.type === 'transfer') return t.account_id === accId ? -t.amount : t.account_to === accId ? t.amount : 0;
  if (t.account_id !== accId) return 0;
  return t.type === 'income' ? t.amount : -t.amount;
}
// efeito no conjunto de contas selecionadas (transferência interna se anula)
function signedSel(t, sel) {
  if (t.type === 'transfer') {
    let v = 0;
    if (sel.has(t.account_id)) v -= t.amount;
    if (sel.has(t.account_to)) v += t.amount;
    return v;
  }
  if (!sel.has(t.account_id)) return 0;
  return t.type === 'income' ? t.amount : -t.amount;
}
// a transação toca alguma conta selecionada?
const touches = (t, sel) => sel.has(t.account_id) || (t.type === 'transfer' && sel.has(t.account_to));

// saldo acumulado (contas selecionadas) antes do mês ym
function carryBefore(ym, sel) {
  let v = 0;
  for (const a of S.accounts) if (sel.has(a.id)) v += a.initial;
  for (const t of S.transactions) if (U.ymOf(t.date) < ym) v += signedSel(t, sel);
  return v;
}
function accountBalance(accId) {
  const today = U.todayStr();
  let v = accById(accId).initial;
  for (const t of S.transactions) if (t.date <= today) v += signedForAccount(t, accId);
  return v;
}
// contas selecionadas (default: todas); descarta ids que sumiram
function selectedAccounts() {
  const ids = S.accounts.map(a => a.id);
  if (!ui.accSel) ui.accSel = new Set(ids);
  else for (const id of [...ui.accSel]) if (!ids.includes(id)) ui.accSel.delete(id);
  return ui.accSel;
}

const monthTxs = ym => S.transactions.filter(t => U.ymOf(t.date) === ym);
const isLocked = ym => ym < U.currentYM();

/* ── render raiz ── */
function render() {
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.view === ui.view));
  const v = $('#view');
  if (ui.view === 'ledger') v.innerHTML = renderLedger();
  if (ui.view === 'accounts') v.innerHTML = renderAccounts();
  if (ui.view === 'categories') v.innerHTML = renderCategories();
  $('#fab').hidden = !(ui.view === 'ledger' && !isLocked(ui.ym));
}

/* ── view: transações ── */
function renderLedger() {
  const ym = ui.ym;
  const { name, year } = ymLabel(ym);
  const sel = selectedAccounts();
  const carry = carryBefore(ym, sel);
  const carryOn = S.prefs.carry;
  const prevLast = `${U.addMonthsYM(ym, -1)}-${String(U.daysInMonth(U.addMonthsYM(ym, -1))).padStart(2, '0')}`;

  const txs = monthTxs(ym).filter(t => touches(t, sel)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const byDay = new Map();
  for (const t of txs) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }

  let running = carryOn ? carry : 0;
  let net = 0;
  let days = '';
  for (const [date, list] of byDay) {
    let rows = '';
    for (const t of list) {
      net += signedSel(t, sel);
      running += signedSel(t, sel);
      rows += txRow(t, ym, sel);
    }
    days += `
      <div class="day">
        <div class="day-head">${dmy(date)}, <span class="wd">${weekday(date)}</span></div>
        ${rows}
        <div class="day-close"><span class="l">SALDO DO DIA</span>
          <span class="v num ${running < 0 ? 'neg' : ''}">${brl(running)}</span></div>
      </div>`;
  }

  const endBalance = carry + net;

  return `
    <section class="month-nav">
      <button class="arrow" data-nav="-1" aria-label="Mês anterior">&#9664;</button>
      <div class="month-title">${name}<small>${year}</small></div>
      <button class="arrow" data-nav="1" aria-label="Próximo mês">&#9654;</button>
    </section>
    ${ym !== U.currentYM() ? `<button class="month-today" data-today>voltar pro mês atual</button>` : ''}

    <div class="acc-strip">
      ${S.accounts.map(a => {
        const on = sel.has(a.id);
        const b = accountBalance(a.id);
        return `<button class="acc-chip sel ${on ? 'on' : ''}" data-accsel="${a.id}">
          <span class="chkbox">${on ? '&#10003;' : ''}</span>
          <span class="acc-txt"><span class="n">${esc(a.name)}</span>
          <span class="v num ${b < 0 ? 'neg' : ''}">${brl(b)}</span></span>
        </button>`;
      }).join('') || '<div class="empty">Nenhuma conta. Crie uma na aba Contas.</div>'}
    </div>

    <div class="card carry">
      <div>
        <div class="lbl">Saldo do mês anterior (em ${dmy(prevLast)})</div>
        <div class="val num ${carry < 0 ? 'neg' : ''}">${brl(carry)}</div>
      </div>
      <label class="switch"><input type="checkbox" data-carry ${carryOn ? 'checked' : ''}> incluir no saldo do dia</label>
    </div>

    <div class="card ledger">
      ${isLocked(ym) ? `<div class="lock-note">&#128274; Mês anterior ao atual: somente leitura.</div>` : ''}
      ${sel.size === 0
        ? `<div class="empty">Marque uma conta acima pra ver o extrato.</div>`
        : (days || `<div class="empty">Nenhuma transação em ${name} de ${year}.</div>`)}
    </div>

    <div class="card month-end">
      <div class="row"><span class="l">Resultado do mês (receitas &minus; despesas)</span>
        <span class="v num ${net < 0 ? 'neg' : ''}">${brl(net)}</span></div>
      <div class="row"><span class="l">Saldo no fim do mês (acumulado)</span>
        <span class="v num ${endBalance < 0 ? 'neg' : ''}">${brl(endBalance)}</span></div>
    </div>`;
}

function txRow(t, ym, sel) {
  const locked = isLocked(ym);
  const sr = Store.seriesOf(t);
  const parc = sr && sr.kind === 'installment' ? ` <span class="parc">(${t.series_index}/${sr.total})</span>` : '';
  const chk = `<button class="chk num ${t.cleared ? 'on' : ''} ${locked ? 'ro' : ''}" data-chk="${t.id}"
      title="${t.cleared ? 'Consolidada' : 'Não consolidada'}">&#10003;&#10003;</button>`;

  if (t.type === 'transfer') {
    const line = (meta, sign, amount) => `
      <div class="tx ${locked ? 'locked' : ''}">
        <span class="ico">&#8646;</span>
        <div class="mid" data-edit="${t.id}">
          <div class="desc">${esc(t.description)}${parc}</div>
          <div class="meta">${meta}</div>
        </div>
        <span class="amt num xf">${sign}&nbsp;${fmt(amount)}</span>
        ${chk}
      </div>`;
    let out = '';
    if (sel.has(t.account_id))  // saída da conta de origem
      out += line(`Transferência &rarr; ${esc(accById(t.account_to)?.name ?? '?')}`, '&minus;', t.amount);
    if (sel.has(t.account_to))  // entrada como crédito no destino
      out += line(`Transferência &larr; ${esc(accById(t.account_id)?.name ?? '?')}`, '+', t.amount);
    return out;
  }

  const neg = t.type === 'expense';
  const cat = t.category_id ? esc(catById(t.category_id)?.name ?? '') : 'Sem categoria';
  return `
    <div class="tx ${locked ? 'locked' : ''}">
      <span class="ico">${sr ? '&#8635;' : ''}</span>
      <div class="mid" data-edit="${t.id}">
        <div class="desc">${esc(t.description)}${parc}</div>
        <div class="meta">${cat} &middot; ${esc(accById(t.account_id)?.name ?? '?')}</div>
      </div>
      <span class="amt num ${neg ? 'neg' : 'pos'}">${neg ? '&minus;' : '+'}&nbsp;${fmt(t.amount)}</span>
      ${chk}
    </div>`;
}

/* ── view: contas ── */
function renderAccounts() {
  return `
    <div class="view-head"><h1>Contas</h1>
      <button class="btn primary" data-add-account>+ Nova conta</button></div>
    <div class="card list-card">
      ${S.accounts.map(a => {
        const b = accountBalance(a.id);
        return `<div class="li">
          <div class="grow">
            <div class="name">${esc(a.name)}</div>
            <div class="sub">Saldo inicial: ${brl(a.initial)}</div>
          </div>
          <div class="right">
            <div class="bal num ${b < 0 ? 'neg' : ''}">${brl(b)}</div>
            <div class="sub">saldo atual</div>
          </div>
          <button class="mini" data-edit-account="${a.id}">Editar</button>
          <button class="mini danger" data-del-account="${a.id}">Excluir</button>
        </div>`;
      }).join('') || '<div class="empty">Nenhuma conta.</div>'}
    </div>`;
}

/* ── view: categorias ── */
function renderCategories() {
  const count = id => S.transactions.filter(t => t.category_id === id).length;
  return `
    <div class="view-head"><h1>Categorias</h1>
      <button class="btn primary" data-add-cat>+ Nova categoria</button></div>
    <div class="card list-card">
      ${S.categories.map(c => `
        <div class="li">
          <div class="grow"><div class="name">${esc(c.name)}</div>
            <div class="sub">${count(c.id)} transação(ões)</div></div>
          <button class="mini" data-ren-cat="${c.id}">Renomear</button>
          <button class="mini danger" data-del-cat="${c.id}">Excluir</button>
        </div>`).join('') || '<div class="empty">Nenhuma categoria.</div>'}
    </div>`;
}

/* ── modal de transação ── */
const txModal = $('#txModal');
const txForm = $('#txForm');

function setFormType(type) {
  ui.formType = type;
  $$('#typeSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.type === type));
  txForm.querySelector('[data-f="category"]').style.display = type === 'transfer' ? 'none' : '';
  txForm.querySelector('[data-f="accountTo"]').style.display = type === 'transfer' ? '' : 'none';
  $('#accLabel').textContent = type === 'transfer' ? 'Conta origem' : 'Conta';
}

function fillSelects() {
  const accs = S.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  txForm.account.innerHTML = accs;
  txForm.accountTo.innerHTML = accs;
  txForm.category.innerHTML = '<option value="">Sem categoria</option>' +
    S.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function openTxModal(txId) {
  ui.editingId = txId;
  fillSelects();
  txForm.reset();
  txForm.date.min = `${U.currentYM()}-01`;
  const editing = !!txId;
  $('#txTitle').textContent = editing ? 'Editar transação' : 'Nova transação';
  $('#txDelete').hidden = !editing;
  txForm.querySelector('[data-f="repeat"]').style.display = editing ? 'none' : '';
  txForm.querySelector('[data-f="nparc"]').style.display = 'none';

  if (editing) {
    const t = S.transactions.find(x => x.id === txId);
    setFormType(t.type);
    txForm.date.value = t.date;
    txForm.amount.value = fmt(t.amount);
    txForm.description.value = t.description;
    txForm.category.value = t.category_id ?? '';
    txForm.account.value = t.account_id;
    if (t.account_to) txForm.accountTo.value = t.account_to;
    txForm.cleared.checked = t.cleared;
  } else {
    setFormType('expense');
    txForm.date.value = ui.ym === U.currentYM() ? U.todayStr() : `${ui.ym}-01`;
  }
  txModal.showModal();
  if (!editing) setTimeout(() => txForm.description.focus(), 50);
}

function readForm() {
  const amount = parseMoney(txForm.amount.value);
  if (amount == null) { alert('Valor inválido.'); return null; }
  const date = txForm.date.value;
  if (!date) { alert('Escolha a data.'); return null; }
  if (U.ymOf(date) < U.currentYM()) { alert('Não dá pra criar ou mover transação pra mês anterior ao atual.'); return null; }
  const type = ui.formType;
  const account_id = txForm.account.value;
  const account_to = type === 'transfer' ? txForm.accountTo.value : null;
  if (type === 'transfer' && account_id === account_to) { alert('Origem e destino precisam ser contas diferentes.'); return null; }
  return {
    type, date, amount,
    description: txForm.description.value.trim() || 'Sem descrição',
    category_id: type === 'transfer' ? null : (txForm.category.value || null),
    account_id, account_to,
    cleared: txForm.cleared.checked,
  };
}

/* escopo: 'one' | 'future' | null (cancelou) */
function askScope(what) {
  return new Promise(resolve => {
    const dlg = $('#scopeModal');
    $('#scopeTitle').textContent = what === 'delete' ? 'Excluir' : 'Salvar alteração em';
    $('#scopeHint').textContent = 'Essa transação se repete. Aplicar só nesta ou nesta e em todas as futuras?';
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('close', onClose);
      resolve(v);
    };
    const onClick = e => {
      const sc = e.target.dataset.scope;
      if (!sc) return;
      dlg.close();
      finish(sc === 'cancel' ? null : sc);
    };
    const onClose = () => finish(null);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

/* modal de conta (add/editar). Resolve {name, initial} ou null */
function askAccount(init) {
  return new Promise(resolve => {
    const dlg = $('#accModal'), form = $('#accForm');
    $('#accTitle').textContent = init ? 'Editar conta' : 'Nova conta';
    form.reset();
    if (init) { form.accname.value = init.name; form.initial.value = fmt(init.initial); }
    let done = false;
    const finish = v => { if (done) return; done = true; cleanup(); resolve(v); };
    const onSubmit = e => {
      e.preventDefault();
      const name = form.accname.value.trim();
      if (!name) { form.accname.focus(); return; }
      dlg.close();
      finish({ name, initial: parseMoney(form.initial.value) ?? 0 });
    };
    const onClick = e => { if (e.target.closest('[data-cancel]')) dlg.close(); };
    const onClose = () => finish(null);
    function cleanup() { form.removeEventListener('submit', onSubmit); dlg.removeEventListener('click', onClick); dlg.removeEventListener('close', onClose); }
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    setTimeout(() => form.name.focus(), 50);
  });
}

/* modal de 1 campo de texto. Resolve string ou null */
function askPrompt({ title, label, value = '' }) {
  return new Promise(resolve => {
    const dlg = $('#promptModal'), form = $('#promptForm');
    $('#promptTitle').textContent = title;
    $('#promptLabel').textContent = label;
    form.reset(); form.field.value = value;
    let done = false;
    const finish = v => { if (done) return; done = true; cleanup(); resolve(v); };
    const onSubmit = e => {
      e.preventDefault();
      const val = form.field.value.trim();
      if (!val) { form.field.focus(); return; }
      dlg.close(); finish(val);
    };
    const onClick = e => { if (e.target.closest('[data-cancel]')) dlg.close(); };
    const onClose = () => finish(null);
    function cleanup() { form.removeEventListener('submit', onSubmit); dlg.removeEventListener('click', onClick); dlg.removeEventListener('close', onClose); }
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    setTimeout(() => { form.field.focus(); form.field.select(); }, 50);
  });
}

/* modal de confirmação. Resolve true/false */
function askConfirm({ title, message = '', okLabel = 'Confirmar' }) {
  return new Promise(resolve => {
    const dlg = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = message;
    $('#confirmMsg').hidden = !message;
    $('#confirmOk').textContent = okLabel;
    let done = false;
    const finish = v => { if (done) return; done = true; cleanup(); resolve(v); };
    const onClick = e => { const b = e.target.closest('[data-confirm]'); if (!b) return; dlg.close(); finish(b.dataset.confirm === '1'); };
    const onClose = () => finish(false);
    function cleanup() { dlg.removeEventListener('click', onClick); dlg.removeEventListener('close', onClose); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

async function saveTx() {
  const data = readForm();
  if (!data) return;

  if (!ui.editingId) {
    const repeat = txForm.repeat.value;
    const n = Math.max(2, Math.min(240, Number(txForm.installments.value) || 12));
    Store.addTransaction(data, repeat, n);
  } else {
    const t = S.transactions.find(x => x.id === ui.editingId);
    if (t.series_id) {
      const scope = await askScope('edit');
      if (!scope) return;
      if (scope === 'future') Store.updateTransactionForward(t.id, data);
      else Store.updateTransaction(t.id, data);
    } else {
      Store.updateTransaction(t.id, data);
    }
  }
  txModal.close();
  render();
}

async function deleteTx() {
  const t = S.transactions.find(x => x.id === ui.editingId);
  if (t.series_id) {
    const scope = await askScope('delete');
    if (!scope) return;
    if (scope === 'future') Store.deleteTransactionForward(t.id);
    else Store.deleteTransaction(t.id);
  } else {
    if (!confirm('Excluir esta transação?')) return;
    Store.deleteTransaction(t.id);
  }
  txModal.close();
  render();
}

/* ── eventos ── */
$$('.tab').forEach(b => b.addEventListener('click', () => { ui.view = b.dataset.view; render(); }));
$('#fab').addEventListener('click', () => openTxModal(null));

$('#view').addEventListener('click', async e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { ui.ym = U.addMonthsYM(ui.ym, Number(nav.dataset.nav)); render(); return; }
  if (e.target.closest('[data-today]')) { ui.ym = U.currentYM(); render(); return; }

  const accSel = e.target.closest('[data-accsel]');
  if (accSel) {
    const id = accSel.dataset.accsel;
    const sel = selectedAccounts();
    sel.has(id) ? sel.delete(id) : sel.add(id);
    render(); return;
  }

  const chk = e.target.closest('[data-chk]');
  if (chk && !chk.classList.contains('ro')) {
    const t = S.transactions.find(x => x.id === chk.dataset.chk);
    Store.updateTransaction(t.id, { cleared: !t.cleared });
    render(); return;
  }

  const edit = e.target.closest('[data-edit]');
  if (edit && !isLocked(ui.ym)) { openTxModal(edit.dataset.edit); return; }

  // contas
  if (e.target.closest('[data-add-account]')) {
    const res = await askAccount(null);
    if (!res) return;
    const a = Store.addAccount(res.name, res.initial);
    ui.accSel?.add(a.id);
    render(); return;
  }
  const editAcc = e.target.closest('[data-edit-account]');
  if (editAcc) {
    const a = accById(editAcc.dataset.editAccount);
    const res = await askAccount({ name: a.name, initial: a.initial });
    if (!res) return;
    Store.updateAccount(a.id, { name: res.name, initial: res.initial });
    render(); return;
  }
  const delAcc = e.target.closest('[data-del-account]');
  if (delAcc) {
    const id = delAcc.dataset.delAccount;
    const used = S.transactions.some(t => t.account_id === id || t.account_to === id);
    if (used) { await askConfirm({ title: 'Não dá pra excluir', message: 'Essa conta tem transações. Apague ou mova as transações antes.', okLabel: 'Entendi' }); return; }
    if (await askConfirm({ title: 'Excluir conta?', message: accById(id)?.name ?? '', okLabel: 'Excluir' })) { Store.deleteAccount(id); render(); }
    return;
  }

  // categorias
  if (e.target.closest('[data-add-cat]')) {
    const name = await askPrompt({ title: 'Nova categoria', label: 'Nome' });
    if (name) Store.addCategory(name);
    render(); return;
  }
  const ren = e.target.closest('[data-ren-cat]');
  if (ren) {
    const c = catById(ren.dataset.renCat);
    const name = await askPrompt({ title: 'Renomear categoria', label: 'Novo nome', value: c.name });
    if (name) Store.updateCategory(c.id, { name });
    render(); return;
  }
  const delCat = e.target.closest('[data-del-cat]');
  if (delCat) {
    const c = catById(delCat.dataset.delCat);
    const n = S.transactions.filter(t => t.category_id === c.id).length;
    if (await askConfirm({ title: `Excluir "${c.name}"?`, message: n ? `${n} transação(ões) ficam sem categoria.` : '', okLabel: 'Excluir' })) {
      Store.deleteCategory(c.id); render();
    }
    return;
  }
});

$('#view').addEventListener('change', e => {
  if (e.target.matches('[data-carry]')) { Store.setPref('carry', e.target.checked); render(); }
});

// modal
$$('#typeSeg button').forEach(b => b.addEventListener('click', () => setFormType(b.dataset.type)));
txForm.addEventListener('change', e => {
  if (e.target.name === 'repeat')
    txForm.querySelector('[data-f="nparc"]').style.display = e.target.value === 'installment' ? '' : 'none';
});
txForm.addEventListener('submit', e => { e.preventDefault(); saveTx(); });
$('#txDelete').addEventListener('click', deleteTx);
$$('[data-close]').forEach(b => b.addEventListener('click', () => txModal.close()));

/* ── boot: sessão → login → carrega dados → render ── */
const authModal = $('#authModal');
const authForm = $('#authForm');

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#authError');
  const btn = $('#authSubmit');
  err.hidden = true;
  btn.disabled = true;
  const { error } = await Store.signIn(authForm.email.value.trim(), authForm.password.value);
  btn.disabled = false;
  if (error) { err.textContent = 'Não deu: ' + error.message; err.hidden = false; return; }
  authForm.reset();
  authModal.close();
  await start();
});

async function start() {
  try {
    S = await Store.load();
    $('#logout').hidden = false;
    render();
  } catch (e) {
    alert('Erro ao carregar dados:\n' + (e.message || e));
    authModal.showModal();
  }
}

$('#logout').addEventListener('click', async () => {
  await Store.signOut();
  location.reload();
});

async function boot() {
  const session = await Store.getSession();
  if (!session) { authModal.showModal(); return; }
  await start();
}

/* ── refresh: pull-to-refresh + voltar pro app ── */
const anyDialogOpen = () => $$('dialog').some(d => d.open);

async function refreshData() {
  if (!S || anyDialogOpen()) return;
  try { S = await Store.load(); render(); } catch (_) {}
}

const ptr = $('#ptr');
let ptrStartY = null, ptrActive = false;

addEventListener('touchstart', e => {
  ptrActive = window.scrollY <= 0 && e.touches.length === 1 && !anyDialogOpen();
  if (ptrActive) { ptrStartY = e.touches[0].clientY; ptr.style.transition = 'none'; }
}, { passive: true });

addEventListener('touchmove', e => {
  if (!ptrActive) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy > 0 && window.scrollY <= 0) {
    const pull = Math.min(dy * 0.5, 90);
    ptr.style.height = pull + 'px';
    ptr.classList.toggle('ready', pull >= 40);
  } else {
    ptr.style.height = '0px'; ptr.classList.remove('ready');
  }
}, { passive: true });

addEventListener('touchend', async () => {
  if (!ptrActive) return;
  ptrActive = false;
  const ready = ptr.classList.contains('ready');
  ptr.style.transition = '';
  ptr.classList.remove('ready');
  if (ready) {
    ptr.classList.add('loading'); ptr.style.height = '64px';
    await refreshData();
    ptr.classList.remove('loading');
  }
  ptr.style.height = '0px';
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshData();
});

boot();

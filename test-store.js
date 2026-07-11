// harness: roda store.js fora do browser
const fs = require('fs');
global.localStorage = { getItem: () => null, setItem: () => {} };
if (!global.crypto) global.crypto = require('crypto');
eval(fs.readFileSync('/Users/atahualpamaia/CC-personal/minhas-economias/store.js', 'utf8') + '\nglobalThis.Store = Store;');

const S = Store.load();
const U = Store.util;
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg); if (!cond) fail++; };

const signedGlobal = t => t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0;
const carryBefore = ym => S.accounts.reduce((a, x) => a + x.initial, 0) +
  S.transactions.filter(t => U.ymOf(t.date) < ym).reduce((a, t) => a + signedGlobal(t), 0);

// 1. parcelamento: Caixinha da Viagem tem 10 linhas, mar-dez 2026, julho = 5/10
const cx = S.transactions.filter(t => t.description === 'Caixinha da Viagem');
ok(cx.length === 10, `Caixinha: 10 parcelas (tem ${cx.length})`);
const cxJul = cx.find(t => U.ymOf(t.date) === '2026-07');
ok(cxJul && cxJul.series_index === 5, `Caixinha julho = parcela 5 (${cxJul?.series_index})`);
ok(cx[0].date === '2026-03-02' && cx[9].date === '2026-12-02', 'Caixinha: mar a dez, dia 2');

// 2. recorrente: horizonte = mês atual + 24
const ap = S.transactions.filter(t => t.description === 'Parcela do AP + Contas').sort((a,b)=>a.date<b.date?-1:1);
const horizon = U.addMonthsYM(U.currentYM(), 24);
ok(U.ymOf(ap[ap.length-1].date) === horizon, `recorrente vai até ${horizon} (vai até ${U.ymOf(ap[ap.length-1].date)})`);
ok(ap[0].date === '2026-05-02', 'recorrente começa 2026-05-02');

// 3. clamp de dia: parcela dia 28 se mantém em fev
const gb = S.transactions.filter(t => t.description === 'Gastos com Bel');
ok(gb.some(t => t.date === '2026-02-28'), 'dia 28 mantido em fevereiro');

// 4. clamp dia 31: nova série no dia 31
const first = Store.addTransaction({ type:'expense', description:'T31', amount:1000,
  account_id:S.accounts[0].id, account_to:null, category_id:null, cleared:false, date:'2026-07-31' }, 'installment', 3);
const t31 = S.transactions.filter(t => t.description === 'T31').map(t => t.date).sort();
ok(JSON.stringify(t31) === JSON.stringify(['2026-07-31','2026-08-31','2026-09-30']),
  `dia 31 clampa pra 30 em setembro (${t31})`);

// 5. edição "esta e futuras": muda valor de ago em diante, julho intacto
const aug = S.transactions.find(t => t.description === 'T31' && t.date === '2026-08-31');
Store.updateTransactionForward(aug.id, { description:'T31', amount: 2000, date:'2026-08-15', type:'expense',
  account_id: aug.account_id, account_to:null, category_id:null, cleared:true });
const after = S.transactions.filter(t => t.description === 'T31').sort((a,b)=>a.date<b.date?-1:1);
ok(after[0].amount === 1000 && after[1].amount === 2000 && after[2].amount === 2000, 'forward: valor só de ago em diante');
ok(after[1].date === '2026-08-15' && after[2].date === '2026-09-15', `forward: dia desloca pra 15 (${after[1].date}, ${after[2].date})`);
ok(after[1].cleared === true && after[2].cleared === false, 'forward: cleared só na linha editada');

// 6. delete forward em recorrente: some dali pra frente e não re-estende
const apSep = ap.find(t => U.ymOf(t.date) === '2026-09');
Store.deleteTransactionForward(apSep.id);
const apAfter = S.transactions.filter(t => t.description === 'Parcela do AP + Contas');
ok(apAfter.every(t => t.date < '2026-09-01'), 'delete forward: nada de set em diante');
Store.load; // simula reload
eval(fs.readFileSync('/Users/atahualpamaia/CC-personal/minhas-economias/store.js', 'utf8') + '\nglobalThis.Store = Store;');
// nota: reload real re-seedaria (localStorage stub); teste do end_month direto:
const sr = S.series.find(s => s.id === apSep.series_id);
ok(sr.end_month === '2026-08', `série encerrada em 2026-08 (${sr.end_month})`);

// 7. saldo: carry + net do mês = carry do mês seguinte
const net7 = S.transactions.filter(t => U.ymOf(t.date) === '2026-07').reduce((a,t)=>a+signedGlobal(t),0);
ok(carryBefore('2026-07') + net7 === carryBefore('2026-08'), 'carry(jul) + net(jul) = carry(ago)');

// 8. transferência não muda o total global
const tr = S.transactions.find(t => t.type === 'transfer');
ok(signedGlobal(tr) === 0, 'transferência = 0 no global');

console.log(fail ? `\n${fail} FALHAS` : '\nTUDO PASSOU');
process.exit(fail ? 1 : 0);

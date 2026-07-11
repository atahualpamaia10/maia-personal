-- ── Cofre — schema Supabase ─────────────────────────────
-- Colar inteiro no SQL Editor do projeto (Run).
-- Valores monetários em CENTAVOS (bigint). Datas como date ('YYYY-MM-DD').
-- Single-user: RLS libera acesso total só pra usuário autenticado.
-- A anon key (pública, vai no browser) não lê nem escreve nada sem login.

-- ── tabelas ──────────────────────────────────────────────

create table accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  initial    bigint not null default 0,        -- saldo inicial, centavos
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table series (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('installment','recurring')),
  total      int,          -- nº de parcelas (installment); null p/ recurring
  end_month  text,         -- 'YYYY-MM' quando recorrente foi encerrada; senão null
  created_at timestamptz not null default now()
);

create table transactions (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('expense','income','transfer')),
  description  text not null default '',
  amount       bigint not null check (amount > 0),   -- centavos
  date         date not null,
  account_id   uuid not null references accounts(id) on delete restrict,
  account_to   uuid references accounts(id) on delete restrict,   -- destino (transfer)
  category_id  uuid references categories(id) on delete set null,
  cleared      boolean not null default false,       -- consolidada
  series_id    uuid references series(id) on delete cascade,
  series_index int,                                  -- k da parcela (1..total); null p/ recurring
  created_at   timestamptz not null default now()
);

create table prefs (
  key   text primary key,   -- ex: 'carry'
  value jsonb not null
);

-- ── índices (consultas por mês e por série) ──────────────

create index tx_date_idx    on transactions (date);
create index tx_series_idx  on transactions (series_id);
create index tx_account_idx on transactions (account_id);

-- ── RLS: opção A (login obrigatório) ─────────────────────

alter table accounts     enable row level security;
alter table categories   enable row level security;
alter table series       enable row level security;
alter table transactions enable row level security;
alter table prefs        enable row level security;

create policy "auth full access" on accounts     for all to authenticated using (true) with check (true);
create policy "auth full access" on categories   for all to authenticated using (true) with check (true);
create policy "auth full access" on series       for all to authenticated using (true) with check (true);
create policy "auth full access" on transactions for all to authenticated using (true) with check (true);
create policy "auth full access" on prefs        for all to authenticated using (true) with check (true);

-- ── Migração: financeiro por usuário ────────────────────
-- Roda inteiro no SQL Editor do Supabase, UMA vez.
-- Passa de "todo mundo logado vê tudo" pra "cada um só vê o seu".

-- 1. coluna user_id (default = usuário logado)
alter table accounts     add column user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table categories   add column user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table series       add column user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table transactions add column user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table prefs        add column user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- 2. backfill: o dado que já existe vira do usuário mais antigo (você)
do $$
declare owner uuid := (select id from auth.users order by created_at limit 1);
begin
  update accounts     set user_id = owner where user_id is null;
  update categories   set user_id = owner where user_id is null;
  update series        set user_id = owner where user_id is null;
  update transactions set user_id = owner where user_id is null;
  update prefs        set user_id = owner where user_id is null;
end $$;

-- 3. exigir user_id daqui pra frente
alter table accounts     alter column user_id set not null;
alter table categories   alter column user_id set not null;
alter table series       alter column user_id set not null;
alter table transactions alter column user_id set not null;
alter table prefs        alter column user_id set not null;

-- 4. prefs: a chave passa a ser por usuário (antes era global)
alter table prefs drop constraint prefs_pkey;
alter table prefs add primary key (user_id, key);

-- 5. policies: cada um só vê/mexe no que é seu
drop policy "auth full access" on accounts;
drop policy "auth full access" on categories;
drop policy "auth full access" on series;
drop policy "auth full access" on transactions;
drop policy "auth full access" on prefs;

create policy "own rows" on accounts     for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on categories   for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on series       for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on transactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on prefs        for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 6. índices por usuário
create index accounts_user_idx     on accounts (user_id);
create index categories_user_idx   on categories (user_id);
create index series_user_idx       on series (user_id);
create index transactions_user_idx on transactions (user_id);

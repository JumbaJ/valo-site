-- VALO Phase 3 — accounts + persistent paper trading
-- Run this in Supabase: Dashboard → SQL Editor → New query → paste → Run

-- profiles: one row per user, auto-created on signup
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  icon text,
  created_at timestamptz default now()
);

-- paper wallet: every new user starts with 10 SOL + 25,000 $VALO
create table if not exists wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sol_balance numeric not null default 10,
  valo_balance numeric not null default 25000,
  updated_at timestamptz default now()
);

-- open positions
create table if not exists positions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_key text not null,          -- pool address (live) or sim id
  sym text,
  qty numeric not null default 0,
  entry_price numeric not null default 0,
  pay_unit text not null default 'SOL',
  opened_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, token_key)
);

-- full trade log — mirrors the v2.0.2 TX-accounting fields
create table if not exists activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_key text not null,
  sym text,
  side text not null check (side in ('buy','sell')),
  amt numeric not null,
  unit text not null,
  price numeric not null,
  tok_qty numeric,
  val_usd numeric,
  pnl_money numeric,
  rem_qty numeric,
  ts timestamptz default now()
);

-- watchlist: the whole sections structure as one JSON blob per user
create table if not exists watchlists (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sections jsonb not null default '[]',
  loose jsonb not null default '[]',
  updated_at timestamptz default now()
);

-- auto-trader bot runs
create table if not exists bot_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_key text not null,
  sym text,
  side text,
  level numeric,
  remaining numeric default 0,
  entry numeric,
  pay text default 'SOL',
  status text default 'live',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---- Row Level Security: every user touches ONLY their own rows ----
alter table profiles   enable row level security;
alter table wallets    enable row level security;
alter table positions  enable row level security;
alter table activity   enable row level security;
alter table watchlists enable row level security;
alter table bot_runs   enable row level security;

create policy "own profile"   on profiles   for all using (auth.uid() = id)      with check (auth.uid() = id);
create policy "own wallet"    on wallets    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own positions" on positions  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own activity"  on activity   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own watchlist" on watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own bots"      on bot_runs   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- auto-provision profile + wallet + watchlist on signup
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, handle) values (new.id, split_part(new.email, '@', 1)) on conflict do nothing;
  insert into wallets (user_id) values (new.id) on conflict do nothing;
  insert into watchlists (user_id) values (new.id) on conflict do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

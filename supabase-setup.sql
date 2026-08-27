create table if not exists public.budget_entries (
  id uuid primary key,
  event_key text not null,
  item text not null,
  category text not null check (category in ('Software', 'Hardware', 'Supplies', 'Food')),
  entry_type text not null check (entry_type in ('forecast', 'actual')),
  amount_cents integer not null check (amount_cents >= 0),
  source_url text,
  forecast_entry_id uuid references public.budget_entries(id),
  receipt_url text,
  created_at timestamptz not null default now()
);

alter table public.budget_entries add column if not exists forecast_entry_id uuid references public.budget_entries(id);
alter table public.budget_entries add column if not exists receipt_url text;

insert into storage.buckets (id, name, public)
values ('budget-receipts', 'budget-receipts', true)
on conflict (id) do nothing;

drop policy if exists "Public receipt upload access" on storage.objects;
create policy "Public receipt upload access"
on storage.objects for insert
to anon
with check (bucket_id = 'budget-receipts');

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  name text not null,
  event_date date not null,
  location text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.event_budgets (
  event_id uuid primary key references public.events(id) on delete cascade,
  allocated_cents integer not null check (allocated_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.page_visits (
  id bigint generated always as identity primary key,
  visited_at timestamptz not null default now()
);

insert into public.events (event_key, name, event_date, location)
values ('halloween-2026', 'Halloween Theme', '2026-10-22', 'Frankford Public School')
on conflict (event_key) do nothing;

insert into public.event_budgets (event_id, allocated_cents)
select id, 250000
from public.events
where event_key = 'halloween-2026'
on conflict (event_id) do nothing;

alter table public.budget_entries enable row level security;
alter table public.events enable row level security;
alter table public.event_budgets enable row level security;
alter table public.page_visits enable row level security;

drop policy if exists "Public event read access" on public.events;
drop policy if exists "Public event insert access" on public.events;
drop policy if exists "Public event delete access" on public.events;
drop policy if exists "Public event budget read access" on public.event_budgets;
drop policy if exists "Public event budget insert access" on public.event_budgets;
drop policy if exists "Public event budget update access" on public.event_budgets;
drop policy if exists "Public event budget delete access" on public.event_budgets;
drop policy if exists "Public budget entry read access" on public.budget_entries;
drop policy if exists "Public budget entry insert access" on public.budget_entries;
drop policy if exists "Public budget entry delete access" on public.budget_entries;
drop policy if exists "Public visit insert access" on public.page_visits;

create policy "Public event read access"
on public.events for select
to anon
using (true);

create policy "Public event insert access"
on public.events for insert
to anon
with check (true);

create policy "Public event delete access"
on public.events for delete
to anon
using (true);

create policy "Public event budget read access"
on public.event_budgets for select
to anon
using (true);

create policy "Public event budget insert access"
on public.event_budgets for insert
to anon
with check (true);

create policy "Public event budget update access"
on public.event_budgets for update
to anon
using (true)
with check (true);

create policy "Public event budget delete access"
on public.event_budgets for delete
to anon
using (true);

create policy "Public budget entry read access"
on public.budget_entries for select
to anon
using (true);

create policy "Public budget entry insert access"
on public.budget_entries for insert
to anon
with check (true);

create policy "Public budget entry delete access"
on public.budget_entries for delete
to anon
using (true);

create policy "Public visit insert access"
on public.page_visits for insert
to anon
with check (true);

do $$
begin
  alter publication supabase_realtime add table public.budget_entries;
exception
  when duplicate_object then null;
end;
$$;
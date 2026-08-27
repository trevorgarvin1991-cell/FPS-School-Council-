create table if not exists public.budget_entries (
  id uuid primary key,
  event_key text not null,
  item text not null,
  category text not null check (category in ('Software', 'Hardware', 'Supplies', 'Food')),
  entry_type text not null check (entry_type in ('forecast', 'actual')),
  amount_cents integer not null check (amount_cents >= 0),
  source_url text,
  created_at timestamptz not null default now()
);

alter table public.budget_entries enable row level security;

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

alter publication supabase_realtime add table public.budget_entries;
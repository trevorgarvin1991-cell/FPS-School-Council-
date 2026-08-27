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

insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', true)
on conflict (id) do nothing;

drop policy if exists "Public receipt upload access" on storage.objects;
create policy "Public receipt upload access"
on storage.objects for insert
to anon
with check (bucket_id = 'budget-receipts');

drop policy if exists "Public task attachment upload access" on storage.objects;
drop policy if exists "Public task attachment delete access" on storage.objects;
create policy "Public task attachment upload access"
on storage.objects for insert
to anon
with check (bucket_id = 'task-attachments');

create policy "Public task attachment delete access"
on storage.objects for delete
to anon
using (bucket_id = 'task-attachments');

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

create table if not exists public.event_tasks (
  id uuid primary key,
  event_key text not null,
  title text not null,
  assignee text not null default '',
  status text not null check (status in ('todo', 'in-progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.event_tasks(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.page_visits (
  id bigint generated always as identity primary key,
  visitor_id uuid,
  visited_at timestamptz not null default now()
);

alter table public.page_visits add column if not exists visitor_id uuid;
create index if not exists page_visits_visitor_id_idx on public.page_visits (visitor_id);

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
alter table public.event_tasks enable row level security;
alter table public.task_attachments enable row level security;
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
drop policy if exists "Public task read access" on public.event_tasks;
drop policy if exists "Public task insert access" on public.event_tasks;
drop policy if exists "Public task update access" on public.event_tasks;
drop policy if exists "Public task delete access" on public.event_tasks;
drop policy if exists "Public task attachment read access" on public.task_attachments;
drop policy if exists "Public task attachment insert access" on public.task_attachments;
drop policy if exists "Public task attachment delete access" on public.task_attachments;
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

create policy "Public task read access"
on public.event_tasks for select
to anon
using (true);

create policy "Public task insert access"
on public.event_tasks for insert
to anon
with check (true);

create policy "Public task update access"
on public.event_tasks for update
to anon
using (true)
with check (true);

create policy "Public task delete access"
on public.event_tasks for delete
to anon
using (true);

create policy "Public task attachment read access"
on public.task_attachments for select
to anon
using (true);

create policy "Public task attachment insert access"
on public.task_attachments for insert
to anon
with check (true);

create policy "Public task attachment delete access"
on public.task_attachments for delete
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

do $$
begin
  alter publication supabase_realtime add table public.task_attachments;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.event_tasks;
exception
  when duplicate_object then null;
end;
$$;
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

insert into storage.buckets (id, name, public)
values ('council-documents', 'council-documents', true)
on conflict (id) do nothing;

drop policy if exists "Public receipt upload access" on storage.objects;
create policy "Public receipt upload access"
on storage.objects for insert
to authenticated
with check (bucket_id = 'budget-receipts');

drop policy if exists "Public task attachment upload access" on storage.objects;
drop policy if exists "Public task attachment delete access" on storage.objects;
create policy "Public task attachment upload access"
on storage.objects for insert
to authenticated
with check (bucket_id = 'task-attachments');

create policy "Public task attachment delete access"
on storage.objects for delete
to authenticated
using (bucket_id = 'task-attachments');

drop policy if exists "Council document upload access" on storage.objects;
drop policy if exists "Council document delete access" on storage.objects;
create policy "Council document upload access"
on storage.objects for insert
to authenticated
with check (bucket_id = 'council-documents');

create policy "Council document delete access"
on storage.objects for delete
to authenticated
using (bucket_id = 'council-documents');

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
  last_comment text not null default '',
  status text not null check (status in ('todo', 'in-progress', 'completed')),
  last_editor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_tasks add column if not exists last_editor_id uuid;
alter table public.event_tasks add column if not exists last_comment text not null default '';

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.event_tasks(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.council_documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_path text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.floor_plan_markers (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  label text not null,
  details text not null default '',
  color text not null default '#d71920',
  details_url text not null default '',
  x_percent numeric not null check (x_percent between 0 and 100),
  y_percent numeric not null check (y_percent between 0 and 100),
  created_at timestamptz not null default now()
);

alter table public.floor_plan_markers add column if not exists details text not null default '';
alter table public.floor_plan_markers add column if not exists color text not null default '#d71920';
alter table public.floor_plan_markers add column if not exists details_url text not null default '';

create table if not exists public.page_visits (
  id bigint generated always as identity primary key,
  visitor_id uuid,
  device_type text not null default 'Unknown' check (device_type in ('Desktop', 'Mobile', 'Tablet', 'Unknown')),
  visited_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null default '',
  browser_id uuid,
  action text not null check (action in ('budget_added', 'budget_removed', 'task_added', 'task_removed', 'task_updated')),
  entity_type text not null check (entity_type in ('budget_item', 'task')),
  entity_id uuid,
  entity_label text not null default '',
  occurred_at timestamptz not null default now()
);

alter table public.activity_log add column if not exists browser_id uuid;

create or replace function public.log_council_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.activity_log (actor_id, actor_email, browser_id, action, entity_type, entity_id, entity_label)
    values (
      auth.uid(),
      coalesce(auth.jwt() ->> 'email', ''),
      (to_jsonb(old) ->> 'last_editor_id')::uuid,
      case when tg_table_name = 'budget_entries' then 'budget_removed' else 'task_removed' end,
      case when tg_table_name = 'budget_entries' then 'budget_item' else 'task' end,
      old.id,
      case when tg_table_name = 'budget_entries' then to_jsonb(old) ->> 'item' else to_jsonb(old) ->> 'title' end
    );
    return old;
  end if;

  insert into public.activity_log (actor_id, actor_email, browser_id, action, entity_type, entity_id, entity_label)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', ''),
    (to_jsonb(new) ->> 'last_editor_id')::uuid,
    case
      when tg_table_name = 'budget_entries' then 'budget_added'
      when tg_op = 'INSERT' then 'task_added'
      else 'task_updated'
    end,
    case when tg_table_name = 'budget_entries' then 'budget_item' else 'task' end,
    new.id,
    case when tg_table_name = 'budget_entries' then to_jsonb(new) ->> 'item' else to_jsonb(new) ->> 'title' end
  );
  return new;
end;
$$;

drop trigger if exists budget_entry_activity_log on public.budget_entries;
create trigger budget_entry_activity_log
after insert or delete on public.budget_entries
for each row execute function public.log_council_activity();

drop trigger if exists task_activity_log on public.event_tasks;
create trigger task_activity_log
after insert or update or delete on public.event_tasks
for each row execute function public.log_council_activity();

alter table public.page_visits add column if not exists visitor_id uuid;
alter table public.page_visits add column if not exists device_type text not null default 'Unknown' check (device_type in ('Desktop', 'Mobile', 'Tablet', 'Unknown'));
create index if not exists page_visits_visitor_id_idx on public.page_visits (visitor_id);

create or replace view public.page_visit_audience as
with visits as (
  select
    id,
    visitor_id,
    device_type,
    visited_at,
    row_number() over (
      partition by visitor_id
      order by visited_at, id
    ) as visit_number,
    min(visited_at) over (partition by visitor_id) as first_seen_at,
    max(visited_at) over (partition by visitor_id) as last_seen_at,
    lag(visited_at) over (
      partition by visitor_id
      order by visited_at, id
    ) as previous_visit_at
  from public.page_visits
), daily_visits as (
  select
    visited_at::date as visit_date,
    count(*) as daily_total,
    count(distinct visitor_id) as daily_unique_browsers
  from public.page_visits
  group by visited_at::date
)
select
  visits.id,
  visits.visitor_id,
  visits.visited_at,
  case
    when visits.visitor_id in (
      '202c4cd2-576c-4da2-9182-3ed6c22547ae'::uuid,
      'f761847e-ec91-4521-bf6d-47e161b28687'::uuid,
      '13c00a9d-2ad7-4c44-8c05-52f7ac965a1e'::uuid,
      'a103e196-9eb8-4f63-9929-aac9892c28a5'::uuid
    ) then 'Me'
    else 'Others'
  end as visitor,
  case
    when visits.visit_number = 1 then 'First visit'
    else 'Returning visit'
  end as visit_type,
  visits.visited_at::date as visit_date,
  visits.visited_at::time as visit_time,
  trim(to_char(visits.visited_at, 'Day')) as visit_day,
  concat(left(visits.visitor_id::text, 8), '...') as browser_marker,
  extract(hour from visits.visited_at)::integer as visit_hour,
  extract(isodow from visits.visited_at) in (6, 7) as is_weekend,
  visits.visit_number,
  visits.first_seen_at,
  visits.last_seen_at,
  visits.previous_visit_at,
  extract(day from visits.visited_at - visits.previous_visit_at)::integer as days_since_previous_visit,
  daily_visits.daily_total,
  daily_visits.daily_unique_browsers,
  visits.device_type
from visits
join daily_visits on daily_visits.visit_date = visits.visited_at::date;

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
alter table public.council_documents enable row level security;
alter table public.floor_plan_markers enable row level security;
alter table public.page_visits enable row level security;
alter table public.activity_log enable row level security;

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
drop policy if exists "Public floor plan marker read access" on public.floor_plan_markers;
drop policy if exists "Public floor plan marker insert access" on public.floor_plan_markers;
drop policy if exists "Public floor plan marker update access" on public.floor_plan_markers;
drop policy if exists "Public floor plan marker delete access" on public.floor_plan_markers;
drop policy if exists "Public visit insert access" on public.page_visits;
drop policy if exists "Council budget entry insert access" on public.budget_entries;
drop policy if exists "Council budget entry delete access" on public.budget_entries;
drop policy if exists "Council budget entry read access" on public.budget_entries;
drop policy if exists "Council task insert access" on public.event_tasks;
drop policy if exists "Council task update access" on public.event_tasks;
drop policy if exists "Council task delete access" on public.event_tasks;
drop policy if exists "Guest task update access" on public.event_tasks;
drop policy if exists "Council task read access" on public.event_tasks;
drop policy if exists "Council task attachment read access" on public.task_attachments;
drop policy if exists "Public council document read access" on public.council_documents;
drop policy if exists "Council document insert access" on public.council_documents;
drop policy if exists "Council document delete access" on public.council_documents;

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

create policy "Council budget entry read access"
on public.budget_entries for select
to authenticated
using (true);

create policy "Council budget entry insert access"
on public.budget_entries for insert
to authenticated
with check (auth.uid() is not null);

create policy "Council budget entry delete access"
on public.budget_entries for delete
to authenticated
using (auth.uid() is not null);

create policy "Public task read access"
on public.event_tasks for select
to anon
using (true);

create policy "Council task read access"
on public.event_tasks for select
to authenticated
using (true);

create policy "Council task insert access"
on public.event_tasks for insert
to authenticated
with check (auth.uid() is not null);

create policy "Council task update access"
on public.event_tasks for update
to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "Guest task update access"
on public.event_tasks for update
to anon
using (true)
with check (true);

create policy "Council task delete access"
on public.event_tasks for delete
to authenticated
using (auth.uid() is not null);

create policy "Public task attachment read access"
on public.task_attachments for select
to anon
using (true);

create policy "Council task attachment read access"
on public.task_attachments for select
to authenticated
using (true);

create policy "Public task attachment insert access"
on public.task_attachments for insert
to anon
with check (true);

create policy "Public task attachment delete access"
on public.task_attachments for delete
to anon
using (true);

create policy "Public council document read access"
on public.council_documents for select
to anon, authenticated
using (true);

create policy "Council document insert access"
on public.council_documents for insert
to authenticated
with check (auth.uid() is not null);

create policy "Council document delete access"
on public.council_documents for delete
to authenticated
using (auth.uid() is not null);

create policy "Public floor plan marker read access"
on public.floor_plan_markers for select
to anon, authenticated
using (true);

create policy "Public floor plan marker insert access"
on public.floor_plan_markers for insert
to anon
with check (true);

create policy "Public floor plan marker update access"
on public.floor_plan_markers for update
to anon
using (true)
with check (true);

create policy "Public floor plan marker delete access"
on public.floor_plan_markers for delete
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
  alter publication supabase_realtime add table public.floor_plan_markers;
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
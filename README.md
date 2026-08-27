# FPS-School-Council-

Frankford Public School Council application for:

- Budgetary information tracking
- Event planning management
- Quick access to the October event planning Google document
- Link to the official school site

## Usage

Open `index.html` in a browser to use the app.

## Hosting And DNS

The site is published with GitHub Pages at `www.fpscouncil.com`.

- Cloudflare DNS dashboard: [fpscouncil.com DNS records](https://dash.cloudflare.com/2b0d30f03511bd603cefb546bf72ce40/fpscouncil.com/dns/records)
- GitHub Pages source: `main` branch, `/ (root)` directory
- Custom domain: `www.fpscouncil.com`

Keep these DNS records set to **DNS only** while GitHub Pages verifies the domain:

| Type | Name | Target |
| --- | --- | --- |
| CNAME | `www` | `trevorgarvin1991-cell.github.io` |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

After GitHub Pages verifies the domain and issues a certificate, enable HTTPS in the repository's Pages settings.

## Shared Budget Data

Budget entries, Kanban tasks, task attachments, floor plan markers, and uploaded receipts sync between devices through Supabase.

1. Create a project in [Supabase](https://supabase.com/dashboard).
2. In the project, open **SQL Editor**, paste the contents of [supabase-setup.sql](supabase-setup.sql), and run it. The script creates the budget tables, the public `budget-receipts` storage bucket, and the access policies required by the site.
3. Open **Connect** or **Project Settings > API** and copy the project URL and publishable key.
4. In [index.html](index.html), update the two values in `window.supabase.createClient(...)` with that URL and publishable key.

Run the script again after pulling future schema updates; its table and column setup is safe to rerun.

The setup also creates `events`, `event_budgets`, `event_tasks`, `task_attachments`, `council_documents`, and `floor_plan_markers`, plus the `task-attachments` and `council-documents` storage buckets. Signed-in council members can add documents through the Document Repository tab; visitors can view the shared document list. Each event budget has exactly one owning event through `event_budgets.event_id`, and is deleted automatically when its event is removed. The Halloween event and its $2,500 allocation are seeded on first run.

## Council Member Access

Visitors can view budget and task information. Adding or removing budget items and tasks requires a Supabase account. Guests can edit existing tasks; each guest edit records the anonymous browser marker that made it. Create each council member in **Authentication > Users > Add user** in the Supabase dashboard, setting an email and password. Council members then select **Sign in** on the site before making protected changes.

Every budget and task change is recorded in `public.activity_log` with the signed-in account, action, item or task name, and timestamp. Review it in the Supabase Table Editor or run:

```sql
select actor_email, browser_id, action, entity_label, occurred_at
from public.activity_log
order by occurred_at desc;
```

## Page Visit Analytics

Each browser session records an anonymous visit timestamp and a randomly generated browser marker in the `page_visits` table. The marker is stored only in that browser's local storage, so it identifies a browser rather than a person. No names, IP addresses, referrers, or device information are stored by the site.

Run this query in the Supabase SQL Editor to see the most recent visitors:

```sql
select visited_at
from public.page_visits
order by visited_at desc;
```

For daily counts:

```sql
select date(visited_at) as day, count(*) as visits
from public.page_visits
group by day
order by day desc;
```

For unique browser counts:

```sql
select count(distinct visitor_id) as unique_browsers
from public.page_visits
where visitor_id is not null;
```

To see `Me` and `Others` as a persistent dashboard table, rerun [supabase-setup.sql](supabase-setup.sql) in the Supabase SQL Editor. Then open `page_visit_audience` in the Table Editor; its `visitor` column labels the configured browser marker as `Me` and every other browser as `Others`.

To label your browser's visits separately, first open the site in your browser, open its developer console, and run:

```js
localStorage.getItem('fps-visitor-id-v1')
```

Then replace `YOUR_VISITOR_ID` below with the returned value and run this in the Supabase SQL Editor:

```sql
select
	visited_at,
	case
		when visitor_id = 'YOUR_VISITOR_ID'::uuid then 'Me'
		else 'Others'
	end as visitor
from public.page_visits
order by visited_at desc;
```

The supplied policies allow visitors to view public event and budget information. Budget and task changes require a signed-in council member; event and floor-plan changes remain public.

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

Budget entries, Kanban tasks, and uploaded receipts sync between devices through Supabase.

1. Create a project in [Supabase](https://supabase.com/dashboard).
2. In the project, open **SQL Editor**, paste the contents of [supabase-setup.sql](supabase-setup.sql), and run it. The script creates the budget tables, the public `budget-receipts` storage bucket, and the access policies required by the site.
3. Open **Connect** or **Project Settings > API** and copy the project URL and publishable key.
4. In [index.html](index.html), update the two values in `window.supabase.createClient(...)` with that URL and publishable key.

Run the script again after pulling future schema updates; its table and column setup is safe to rerun.

The setup also creates `events`, `event_budgets`, and `event_tasks`. Each event budget has exactly one owning event through `event_budgets.event_id`, and is deleted automatically when its event is removed. The Halloween event and its $2,500 allocation are seeded on first run.

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

The supplied policies allow visitors to read, add, update, and remove event and budget data without signing in. Add council-member authentication and more restrictive policies before using the public site for sensitive or restricted financial information.

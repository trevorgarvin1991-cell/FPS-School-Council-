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

Budget entries sync between devices through Supabase. Before using the shared ledger, open the Supabase project's **SQL Editor**, paste the contents of [supabase-setup.sql](supabase-setup.sql), and run it once.

The setup also creates `events` and `event_budgets`. Each event budget has exactly one owning event through `event_budgets.event_id`, and is deleted automatically when its event is removed. The Halloween event and its $2,500 allocation are seeded on first run.

The supplied policies allow visitors to read, add, update, and remove event and budget data without signing in. Add council-member authentication before using the public site for sensitive or restricted financial information.

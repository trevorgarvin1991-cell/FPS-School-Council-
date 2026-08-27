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

# DMM — Dynatrace Mass Management Portal

A self-hosted web portal for managing multiple Dynatrace environments from a single interface. Built on Tornado (async Python), Bootstrap 5, and Chart.js — zero external databases, zero build steps.

## What it does

DMM gives you a unified dashboard across all your Dynatrace environments with full CRUD operations, something the native Dynatrace UI makes painful when you're managing dozens of tenants. Switch environments in one click, bulk-enable/disable host monitoring, import/export auto-tag rules between tenants, query and chart any metric, and get an at-a-glance health overview — all from `localhost:8888`.

## Features

### Analytics & Monitoring
- **Environment Overview** — KPI cards + Chart.js doughnut/bar charts for problems, SLO health, vulnerabilities, host monitoring, synthetic monitors, and ActiveGate status
- **Metric Explorer** — query any metric selector with configurable time range and resolution, rendered as interactive line charts with expandable data tables. Client-side filter for browsing 4000+ available metrics
- **Problems** — severity/impact/status with time range filters, one-click close
- **Events** — browse Davis events, ingest custom events (deployment markers, annotations)
- **Logs** — search log entries with DQL-style queries

### Configuration Management
- **Auto-Tag Rules** — list, inspect rule conditions, import/export as JSON, delete
- **Maintenance Windows** — create, inspect schedules/scopes, export, delete
- **SLOs** — create from JSON, monitor error budgets with progress bars, delete
- **Network Zones** — create, delete (with safety check for connected agents)
- **Settings 2.0** — browse all settings schemas, inspect/export objects
- **Extensions 2.0** — view monitoring configs, inspect schemas, delete versions

### Infrastructure
- **Hosts** — full host inventory with tags, host groups, consumed host units. Bulk enable/disable monitoring per host group
- **ActiveGates** — connection status, modules, auto-update settings, version distribution
- **Synthetic Monitors** — enable/disable toggle per monitor
- **Releases** — software release tracking with stage breakdown and time range filter

### Security & Access
- **Security Problems** — vulnerability listing with severity breakdown, one-click mute
- **API Tokens** — list existing tokens, create new tokens with scope selection
- **Audit Log** — filterable audit trail
- **Account Management** — SSO user/group management, permission assignment (requires OAuth client)

### Operational
- **Dashboards** — list, export JSON, delete
- **Tags** — bulk add/remove tags via entity selectors
- **Request Naming** — manage service request naming rules
- **Entities** — query entities by selector with field selection

## Quick Start

### Prerequisites

- Python 3.10+
- A Dynatrace environment with an API token

### Installation

```bash
git clone <repo-url> dmm2
cd dmm2
pip install aiohttp tornado
```

### Configuration

Copy the secrets template and fill in your environment details:

```bash
cp secrets.template.json secrets.json
```

Edit `secrets.json`:

```json
{
    "account_management": {
        "account": "YOUR_ACCOUNT_UUID",
        "client_id": "YOUR_OAUTH_CLIENT_ID",
        "secret": "YOUR_OAUTH_CLIENT_SECRET"
    },
    "environments": [
        {
            "name": "Production",
            "account": "abc12345",
            "secret": "dt0c01.XXXXXXXX.XXXXXXXXXXXXXXXX"
        },
        {
            "name": "Staging",
            "account": "def67890",
            "secret": "dt0c01.YYYYYYYY.YYYYYYYYYYYYYYYY"
        }
    ]
}
```

**`environments`** — each entry needs:
- `name` — display label (shown in the portal UI)
- `account` — your Dynatrace environment ID (the `abc12345` part of `abc12345.live.dynatrace.com`)
- `secret` — API token with appropriate scopes

**`account_management`** (optional) — only needed for SSO user/group management. Requires an OAuth client configured in Dynatrace Account Management.

### Required API Token Scopes

At minimum your token needs:
- `Read entities`, `Read problems`, `Read metrics`, `Read SLO`, `Read security problems`, `Read audit logs`, `Read synthetic monitors`, `Read extensions`, `Read settings`, `Read network zones`, `Read ActiveGates`, `Read releases`, `Access problem and event feed, metrics, and topology`

For write operations add:
- `Write entities`, `Write problems`, `Write settings`, `Write SLO`, `Write extensions`, `Create and read synthetic monitors, locations, and nodes`, `Write API tokens`, `Ingest metrics`, `Ingest events`, `Write security problems`

For configuration management:
- `Read configuration`, `Write configuration`

### Run

```bash
python main.py
```

Opens `http://127.0.0.1:8888` in your browser. Select an environment from the home page, then navigate via the portal.

## Project Structure

```
dmm2/
├── main.py                 # Tornado web app — 59 routes, 56 handlers
├── dt_client.py            # Async Dynatrace API client (v1 + v2 + Account API)
├── dt_secrets.py           # Secrets loader
├── secrets.json            # Your environment credentials (DO NOT COMMIT)
├── secrets.template.json   # Template for secrets.json
├── templates/              # Tornado HTML templates (29 files)
│   ├── base.html           # Layout — Bootstrap 5 + Chart.js CDN
│   ├── overview.html       # Analytics dashboard with 6 Chart.js charts
│   ├── metrics.html        # Metric query + charting + browser
│   ├── portal.html         # Navigation hub
│   └── ...                 # One template per feature
└── static/
    └── favicon.ico
```

## Architecture

- **Tornado** async web framework — non-blocking I/O for concurrent API calls
- **aiohttp** client sessions — connection pooling, automatic pagination
- **Bootstrap 5** via CDN — responsive layout, no build step
- **Chart.js 4** via CDN — doughnut, bar, and line charts for analytics
- **Zero database** — all data is fetched live from Dynatrace APIs
- **Multi-environment** — switch tenants via session cookie, each with its own API client

The `DynatraceClient` class provides a clean async interface with:
- Generic CRUD helpers for v1 and v2 config APIs
- Automatic pagination (both v1 cursor-style and v2 `nextPageKey`)
- Bearer token management for Account API (OAuth2 client credentials flow)
- Connection pooling via shared `aiohttp.ClientSession`

## Notes

- This is an internal tool — it listens on `127.0.0.1` only. Do not expose to the internet without adding authentication.
- The `cookie_secret` in `main.py` should be changed to a random value in production.
- XSRF protection is disabled by default. Enable `xsrf_cookies=True` and add `{% module xsrf_form_html() %}` to forms if deploying beyond localhost.
- All destructive operations (delete, close, mute) require confirmation dialogs.

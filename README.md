# yeyaxin-trading-agent-site

A personal multi-agent stock-research site at **[yeyaxin.com/trade](https://yeyaxin.com/trade/)**. Built on top of [TradingAgents](https://github.com/TauricResearch/TradingAgents) — the upstream project provides the per-ticker LLM pipeline; everything else (portfolios, synthesis, web UI, persistence, deploy) is custom.

> ⚠️ **Not investment advice.** This is a personal research tool. Outputs are AI-generated, can be wrong, and shouldn't be the basis for any actual trade.

---

## What it does

Pick a ticker. Nine specialized AI agents read the financials, news, sentiment, and chart; a bull and a bear debate; a trader proposes a sized trade; a risk team and portfolio manager approve or reject. Results are saved per-portfolio so you can track positions across analyses.

### The agent pipeline (per ticker)

```
You: ticker + date
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ Analysts (parallel reads)                                    │
│   Fundamentals · Sentiment · News · Technical                │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ Researcher debate                                            │
│   Bull   ⇄   Bear   (configurable rounds)                    │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ Trader: proposes entry / stop / target / size               │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ Risk team (3 perspectives) + Portfolio Manager               │
│   Aggressive · Conservative · Neutral                        │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
        BUY / HOLD / SELL with confidence
        + structured trade plan
        + full agent transcripts
```

---

## Features

### Authentication
- **Single shared password** ([`yaxinangela`](~/Desktop/yeyaxin-trade-password.txt) — kept locally, never committed). Anyone with the password can run analyses, edit portfolios, and synthesize. Browse-only is open.
- **Tab-scoped storage**: password lives in `sessionStorage`, evaporates when the tab closes. Each new tab re-prompts.
- **Auto-prompt on 401**: if the server rejects a stale password mid-session, the modal pops up automatically. Up to 3 retry attempts before surfacing an error.
- Server-side stored in **AWS Secrets Manager** (`yeyaxin/trade-agent/password`); rotated by writing a new value and force-redeploying App Runner.

### Portfolios
- **3 portfolio slots** (`p1`/`p2`/`p3`), 20 positions max per slot, plus cash.
- **Server-side persistence** in DynamoDB — every browser/device with the password sees the same book. Edits sync within 30s via revalidation, instantly via custom `storage` events for other tabs.
- **Cash on hand** is its own editable card (separate from the position-add form).
- **Live ticker search** powered by Finnhub: type "NVDA" → see "NVIDIA Corp · $205.19 +0.16%" in the dropdown. The picked ticker carries its live price into the form.
- **Avg cost is optional**: leave blank and the form records the current Finnhub market price as your cost basis (with a yellow warning explaining the fallback).

### Per-ticker analysis lifecycle
Each position has a server-persisted lifecycle state:

| State | Meaning | UI |
|---|---|---|
| `never-analyzed` | No run ever produced for this ticker | Button: **Analyze** (accent) |
| `running` | An agent run is in flight (any tab/device sees this) | Button: **Running…** (disabled) |
| `ready` | Last run completed successfully | Button: **Re-analyze** + "X ago" subtext |
| `error` | Last run failed | Button: **Retry** (red) + error tooltip |

**Re-analyze and Force-refresh do identical work per ticker.** Both call `runner.execute(RunRequest)` → `TradingAgentsGraph.propagate(ticker, date)`. Force-refresh is just "execute N times in a loop over stale tickers" — there is no separate code path.

**Force Refresh is disabled** while ANY ticker in the portfolio is `running`. Tooltip explains why.

### Portfolio synthesis (custom feature, not from upstream)
> ⚠️ TradingAgents is a single-ticker library. The portfolio-level synthesis (book commentary, factor exposure, sizing-aware actions like BUY MORE / HOLD / TRIM / EXIT) is custom code in `agent-runner/src/agent_runner/synthesizer.py`. One Anthropic call with structured output, not a multi-agent pipeline.

- Synthesize button at the top of every portfolio detail page.
- **Disabled unless EVERY ticker is in `ready` state.** Tooltip lists which tickers are blocking and why.
- Cheap (~$0.012 per synthesis on Haiku) because it reasons over per-ticker summaries, not raw data.

### Cost protection
- **Anthropic-side hard cap**: $20/month on the API key (set at console.anthropic.com → API Keys → Limits). This is the ultimate ceiling.
- **App-level cap**: server refuses to start a run if (current month spend + estimated cost) > monthly cap. Spend ledger persisted in DynamoDB.
- **Pre-flight estimate**: every action (Re-analyze, Force Refresh, Synthesize) shows the projected cost in the UI before you click.
- **Live month spend** displayed alongside.
- **Per-call retries (10x with exponential backoff)** on Anthropic 429 / 529 to absorb brief TPM spikes during peak agent rounds without failing the whole run.
- **CloudWatch billing alarm** at $20 sends email to `ye.yaxin3@gmail.com`.

### Run reports
- Every successful run produces a JSON saved to S3 at `s3://trade.yeyaxin.com/runs/{ticker}-{date}.json`.
- A Lambda triggered by the S3 PutObject fires a GitHub Actions `workflow_dispatch` to rebuild the static site. New report pages appear at `yeyaxin.com/trade/runs/{id}/` ~2 minutes after the agent finishes.
- Reports include: BUY/HOLD/SELL + confidence, one-line summary, bull/bear/risks bullets, trade plan (action, size, entry, stop, target), full transcripts of all 9 agents.

### Pages
| Path | What |
|---|---|
| `/trade/` | Landing — pipeline diagram, intro |
| `/trade/portfolio/` | Index of portfolio slots |
| `/trade/portfolio/{p1\|p2\|p3}/` | Detail view: synthesize button, summary, cash, synthesis result, positions table, force refresh, manage positions |
| `/trade/runs/{id}/` | Per-ticker analysis report (one per agent run) |
| `/trade/history/` | Chronological list of all runs |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser                                                          │
│   yeyaxin.com/trade/* → CloudFront → S3 (Next.js static export)  │
└──────────────────────────────────────────────────────────────────┘
                       │
                       │ /portfolios, /run, /synthesize
                       │ Authorization: Bearer <password>
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ trade-agent.yeyaxin.com → App Runner                             │
│   Container: 293231434576.dkr.ecr.us-west-2.amazonaws.com/       │
│              yeyaxin-trade-agent:latest                          │
│   FastAPI (uvicorn) on :8787                                     │
│   - /run + /synthesize → TradingAgents pipeline                  │
│   - /portfolios CRUD                                             │
│   - /jobs status tracking (in-memory per container)              │
└──────────────────────────────────────────────────────────────────┘
        │              │                    │
        ▼              ▼                    ▼
┌─────────────┐  ┌────────────┐  ┌───────────────────────────────┐
│ Anthropic   │  │ DynamoDB   │  │ S3: trade.yeyaxin.com         │
│ Claude API  │  │ - spend    │  │ - static site (out/)          │
│             │  │ - portfolios│  │ - runs/{id}.json (results)   │
└─────────────┘  └────────────┘  └───────────────────────────────┘
                                          │
                                          │ ObjectCreated event
                                          ▼
                                 ┌────────────────────┐
                                 │ Lambda             │
                                 │ site-rebuild-      │
                                 │ trigger            │
                                 │  → GitHub Actions  │
                                 │     workflow_      │
                                 │     dispatch       │
                                 └────────────────────┘
```

### Repos & secrets

| Where | What |
|---|---|
| GitHub repo (public) | `yeyaxin/yeyaxin-trading-agent-site` |
| GitHub Actions secrets | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (scoped IAM `yeyaxin-trade-deploy`), `NEXT_PUBLIC_FINNHUB_API_KEY` |
| AWS Secrets Manager (`yeyaxin/trade-agent/...`) | `password`, `anthropic-api-key`, `github-pat` |
| Local `~/Desktop/yeyaxin-trade-password.txt` | Plain text, chmod 600. Source of truth for the shared password. |
| Local `agent-runner/.env` | `ANTHROPIC_API_KEY` for CLI use (gitignored) |

---

## Cost analysis

### Monthly steady state

```
AWS infrastructure                                    ~$8–12/mo
─────────────────────────────────────────────────────
  App Runner (1 vCPU / 2 GB always-on)                $6.00
    Memory: 2 GB × $3/GB-mo = $6 fixed (24/7)
    CPU: $0.064/vCPU-hr only when handling requests
       (negligible at our usage)
  Route 53 hosted zone + DNS queries                  $0.55
  Secrets Manager (3 secrets × $0.40)                 $1.20
  ECR storage (~1.2 GB at $0.10/GB)                   $0.12
  CloudFront + S3 + DynamoDB + Lambda                 ~$1.00
  CloudWatch logs + Cost Explorer queries             ~$0.30

Anthropic API                                          variable
─────────────────────────────────────────────────────
  Per-ticker run (Haiku 4.5):  ~$0.48
  Portfolio synthesis (Haiku): ~$0.012
  Realistic monthly: $5–15
  Hard server-side cap:        $20

ALL-IN                                              ~$15–25/mo
                                          (max ~$32/mo with cap hit)
```

### Verified at 2026-06-14 (mid-June)

```
Service                 MTD spend
────────────────────────────────────
AWS App Runner          $0.66  (half-month at this rate)
AWS Route 53            $0.50
AWS Secrets Manager     $0.07  (prorated)
AWS Cost Explorer       $0.01
AWS DynamoDB            <$0.01
ECR                     <$0.01
S3 + CloudFront + CW    <$0.01
Tax                     $0.13
─────────────────────────
AWS subtotal            ~$1.40

Anthropic API (DDB ledger): $1.61 MTD
```

### What you can't reduce easily
- **App Runner memory ($6/mo)** is the floor. The service exists 24/7 and you pay for memory while it does. AWS doesn't offer one-click scale-to-zero for App Runner; you'd have to either accept manual `pause-service` calls (~30s cold start on resume) or migrate to a different compute service (significant refactor).
- **Route 53 hosted zone ($0.50/mo)** is the cost of owning yeyaxin.com.
- **Secrets Manager ($0.40/secret)** is the cost of managing each secret. We have 3.

### What you can scale
- **Anthropic API** is your direct lever. Each agent run is ~$0.48 on Haiku 4.5. The $20 cap protects you regardless.
- **Sonnet 4.6** is opt-in (~3× the cost of Haiku for stronger reasoning). UI exposes the toggle.

---

## Infrastructure inventory (AWS resources)

| Service | Resource | Region |
|---|---|---|
| **S3** | `trade.yeyaxin.com` (static site + run JSONs) | us-west-2 |
| **S3** | `yeyaxin.com`, `www.yeyaxin.com` (legacy site) | us-west-2 |
| **CloudFront** | Distribution `E34RSZK4DII7XD` aliased to `yeyaxin.com` + `www.yeyaxin.com` | global |
| **CloudFront Function** | `strip-trade-prefix` (URL rewriting for `/trade/*`) | global |
| **Route 53** | Hosted zone `Z1XJZKBP7GYE00` for `yeyaxin.com` | global |
| **DynamoDB** | `yeyaxin-trade-agent-spend` (ledger, on-demand) | us-west-2 |
| **DynamoDB** | `yeyaxin-trade-portfolios` (portfolio rows, on-demand) | us-west-2 |
| **App Runner** | Service `yeyaxin-trade-agent`, custom domain `trade-agent.yeyaxin.com` | us-west-2 |
| **ECR** | Repo `yeyaxin-trade-agent` (1 image, ~180 MB compressed) | us-west-2 |
| **Secrets Manager** | `yeyaxin/trade-agent/password` | us-west-2 |
| **Secrets Manager** | `yeyaxin/trade-agent/anthropic-api-key` | us-west-2 |
| **Secrets Manager** | `yeyaxin/trade-agent/github-pat` | us-west-2 |
| **Lambda** | `yeyaxin-site-rebuild-trigger` (S3 → GitHub workflow_dispatch) | us-west-2 |
| **IAM** | User `yeyaxin-trade-deploy` (CI/CD: S3 sync + CloudFront invalidate) | global |
| **IAM** | Role `yeyaxin-trade-agent-instance` (App Runner runtime) | global |
| **IAM** | Role `yeyaxin-trade-agent-access` (App Runner ECR pull) | global |
| **IAM** | Role `yeyaxin-site-rebuild-trigger` (Lambda exec) | global |
| **CloudWatch** | Alarm `yeyaxin-monthly-charges-over-20usd` → SNS → email | us-east-1 |
| **SNS** | Topic `yeyaxin-billing-alerts` | us-east-1 |

---

## Repository layout

```
yeyaxin-trading-agent-site/
├── README.md                         # this file
├── package.json
├── next.config.ts                    # output: 'export', basePath: /trade
├── .github/workflows/deploy.yml      # CI: build → S3 sync → invalidate
├── infra/
│   ├── cloudfront/strip-trade.js     # CloudFront Function source
│   └── lambda/site-rebuild-trigger/  # S3 → workflow_dispatch Lambda
├── scripts/
│   └── generate-runs-index.mjs       # prebuild: fetch runs/ from S3 → bundle
├── src/                              # Next.js (static export)
│   ├── app/
│   │   ├── page.tsx                  # /trade/ landing
│   │   ├── portfolio/page.tsx        # portfolios index
│   │   ├── portfolio/[id]/page.tsx   # portfolio detail
│   │   ├── runs/[id]/page.tsx        # per-run report
│   │   └── history/page.tsx          # all runs list
│   ├── components/
│   │   ├── PortfolioDetail.tsx       # the heaviest UI
│   │   ├── PasswordGate.tsx          # PasswordPromptHost (global modal)
│   │   ├── TickerSearch.tsx          # Finnhub typeahead w/ live prices
│   │   ├── RunReport.tsx             # /runs/[id]/ render
│   │   └── …
│   ├── lib/
│   │   ├── agentClient.ts            # auth + 401 retry + portfolio CRUD
│   │   ├── portfolio.ts              # usePortfolios hook
│   │   ├── ticker-state.ts           # lifecycle state derivation
│   │   ├── job-tracker.ts            # in-flight job state per portfolio
│   │   ├── finnhub.ts                # ticker search + quote
│   │   └── cost.ts                   # token pricing + estimators
│   └── data/runs/                    # auto-populated from S3 at build
└── agent-runner/                     # Python service (deployed to App Runner)
    ├── Dockerfile                    # multi-stage uv build, linux/amd64
    ├── pyproject.toml
    └── src/agent_runner/
        ├── server.py                 # FastAPI: /health /run /synthesize /portfolios /jobs
        ├── runner.py                 # SINGLE entry: execute() → TradingAgents
        ├── adapter.py                # AgentState → Run JSON
        ├── synthesizer.py            # custom: portfolio-level Anthropic call
        ├── schema.py                 # pydantic mirrors of src/lib/types.ts
        ├── meter.py                  # token pricing
        ├── dynamo_ledger.py          # DDB-backed spend ledger
        ├── portfolios_store.py       # DDB-backed portfolio CRUD
        ├── s3_publisher.py           # publish runs/synthesis JSON
        └── cli_run.py / cli_synthesize.py
```

---

## Local development

```sh
# Site (Next.js)
cd ~/yeyaxin-trading-agent-site
npm install
npm run dev    # http://localhost:3000/trade/

# Agent server (Python)
cd agent-runner
uv sync
cp .env.example .env  # set ANTHROPIC_API_KEY
uv run agent-server   # http://localhost:8787/health
```

By default the site points at the production agent server (`trade-agent.yeyaxin.com`). To use your local agent-runner during dev, set `NEXT_PUBLIC_AGENT_SERVER_URL=http://localhost:8787` in `.env.local`.

The `agent-runner/README.md` has the operational details (CLIs, calibration, env vars).

---

## Deployment

### Site (Next.js → S3 → CloudFront)
Every push to `main` triggers `.github/workflows/deploy.yml`:
1. `node scripts/generate-runs-index.mjs` — pull latest run JSONs from S3
2. `next build` — static export to `out/`
3. `aws s3 sync out/ s3://trade.yeyaxin.com/`
4. `aws cloudfront create-invalidation`

Total: ~40s. Live at `yeyaxin.com/trade/` within ~2 min including CDN propagation.

### Agent server (Python → ECR → App Runner)
Manual rebuild + push when `agent-runner/**/*.py` changes:

```sh
cd ~/yeyaxin-trading-agent-site/agent-runner
finch build --platform linux/amd64 -t yeyaxin-trade-agent:latest .
finch tag yeyaxin-trade-agent:latest \
  293231434576.dkr.ecr.us-west-2.amazonaws.com/yeyaxin-trade-agent:latest
aws ecr get-login-password --region us-west-2 | \
  finch login --username AWS --password-stdin \
  293231434576.dkr.ecr.us-west-2.amazonaws.com
finch push 293231434576.dkr.ecr.us-west-2.amazonaws.com/yeyaxin-trade-agent:latest

# Force App Runner to pull the new image:
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-west-2:293231434576:service/yeyaxin-trade-agent/819a6d9b970f40f1873165736109ad94 \
  --region us-west-2
```

Total: ~5–7 min including build + propagation.

### Site rebuild on agent run completion
Agent writes `runs/{id}.json` to S3 → S3 ObjectCreated event → Lambda `yeyaxin-site-rebuild-trigger` → GitHub `workflow_dispatch` → CI → site live with new run. ~2 min after agent finishes.

---

## Operational notes

### Rotate the password
```sh
unset AWS_PROFILE
TMP=$(mktemp); printf '%s' 'new-password' > "$TMP"
aws secretsmanager put-secret-value --region us-west-2 \
  --secret-id yeyaxin/trade-agent/password --secret-string "file://$TMP"
rm -f "$TMP"
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-west-2:293231434576:service/yeyaxin-trade-agent/819a6d9b970f40f1873165736109ad94 \
  --region us-west-2
# Then update ~/Desktop/yeyaxin-trade-password.txt
```

### Inspect spend
```sh
# Server-tracked Anthropic spend (authoritative):
aws dynamodb scan --region us-west-2 --table-name yeyaxin-trade-agent-spend

# Live state (also visible at /trade/portfolio/):
curl https://trade-agent.yeyaxin.com/health

# AWS month-to-date by service:
aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=$(date -u +%Y-%m-01),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

### Health check
```sh
curl https://trade-agent.yeyaxin.com/health
# expect: {"ok":true,"anthropicConfigured":true,"monthlyCapUsd":20,...}
```

### View an in-flight job
```sh
PASSWORD=$(grep '^Password:' ~/Desktop/yeyaxin-trade-password.txt | awk '{print $2}')
curl -H "Authorization: Bearer $PASSWORD" https://trade-agent.yeyaxin.com/jobs
```

### Manually trigger a CI rebuild
```sh
gh workflow run deploy.yml --repo yeyaxin/yeyaxin-trading-agent-site --ref main
```

---

## What I built vs what TradingAgents provides

[TradingAgents](https://github.com/TauricResearch/TradingAgents) is a **single-ticker analysis library**:
- 4 analysts (fundamentals, market/technical, news, social/sentiment)
- Bull/bear researcher debate
- Trader synthesizing the debate
- 3-perspective risk debate (aggressive/conservative/neutral)
- Risk Manager + Research Manager final approval
- Per-ticker memory + reflection
- Backtesting harness (also single-ticker, just iterates dates)

Everything in this repo *outside* of `TradingAgentsGraph.propagate(ticker, date)` calls is custom:
- Portfolio modeling (positions, weights, cash, NAV) — `agent-runner/schema.py`, `src/lib/types.ts`, `lib/portfolio.ts`
- Cross-ticker / book-level reasoning — `agent-runner/src/agent_runner/synthesizer.py` (one Anthropic call with structured output)
- Sizing decisions, factor exposure — same synthesizer prompt
- HTTP server — `agent-runner/src/agent_runner/server.py` (FastAPI)
- Persistence — DynamoDB tables (spend ledger + portfolios)
- Web UI — the entire Next.js site
- Auth, password gate, deploy pipeline, billing alarms — all custom

---

## License

This project itself is unreleased; treat as private. TradingAgents (used as a dependency) is Apache-2.0.

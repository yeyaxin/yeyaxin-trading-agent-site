# agent-runner

Python service that runs [TradingAgents](https://github.com/TauricResearch/TradingAgents) per-ticker analyses and a custom portfolio synthesizer. Provides a FastAPI HTTP server consumed by the Next.js site, plus CLI entry points for direct/scripted use.

**Deployment**: production at `https://trade-agent.yeyaxin.com` (App Runner, us-west-2). See the root [`README.md`](../README.md) for the broader architecture.

---

## Setup (local development)

```sh
cd agent-runner
uv sync                       # installs deps in .venv
cp .env.example .env          # then edit .env: set ANTHROPIC_API_KEY
```

`.env` is gitignored. Set a hard spend cap on your Anthropic key at [console.anthropic.com → API Keys → Limits](https://console.anthropic.com/settings/limits) — that's the authoritative cap. The `MONTHLY_CAP_USD` / `DAILY_CAP_USD` env vars are belt-and-suspenders.

---

## CLI usage

### Per-ticker analysis
```sh
uv run run-analysis NVDA --date 2026-06-14 --model haiku --depth 1
# --model: haiku (default, ~$0.48) | sonnet (~$1.50)
# --depth: 0–3 bull/bear debate rounds (more rounds = more cost)
# --dry-run: print the plan + estimate without spending tokens
```

Writes `../src/data/runs/{ticker}-{date}.json` AND uploads to `s3://trade.yeyaxin.com/runs/...` (when `RUN_JSON_BUCKET` is set, which is the App Runner default).

### Portfolio synthesis
```sh
uv run synthesize-portfolio path/to/portfolio.json --model haiku
```

The portfolio JSON must match `src/lib/types.ts:Portfolio`. The CLI loads the latest per-ticker run for each position from `../src/data/runs/` (local) or S3 (when configured). Errors loudly if any position has no run.

> ⚠️ Synthesis is **not** part of TradingAgents — it's a custom single-Anthropic-call wrapper that reasons over per-ticker results to produce book-level commentary, factor exposure, and sizing-aware actions.

### Local HTTP server
```sh
uv run agent-server   # listens on http://localhost:8787
```

Useful for testing UI changes locally without redeploying. Set `NEXT_PUBLIC_AGENT_SERVER_URL=http://localhost:8787` in the site's `.env.local` to point the site at your local instance.

---

## Production deployment

```sh
cd agent-runner
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

Total wall-clock ~5–7 min. Watch `aws apprunner describe-service` until `Status: RUNNING`.

---

## API

All non-health endpoints require `Authorization: Bearer <password>`.

| Endpoint | Method | What |
|---|---|---|
| `/health` | GET | Public. Returns version, month/day spend, caps, `anthropicConfigured`. |
| `/portfolios` | GET | List all 3 portfolio slots. |
| `/portfolios/{slot}` | GET / PUT / DELETE | Single portfolio CRUD. `slot` ∈ {p1,p2,p3}. |
| `/run` | POST | `{ticker, asOfDate?, model?, depth?, portfolioId?}` → starts an agent run, returns jobId. |
| `/synthesize` | POST | `{portfolio, model?, portfolioId?}` → starts a synthesis call, returns jobId. |
| `/jobs` | GET | `?state=running&portfolioId=p1` — list jobs in container memory. |
| `/jobs/{jobId}` | GET | Single job status, decision, cost. |

Job state machine: `queued → running → done | error`. Job records carry `kind` (`run` | `synth`), `ticker`, `portfolioId`, `runId`, `actualCostUsd`, `error`.

---

## Cost guards

- **Pre-flight estimate check** before any LLM call. If (current month spend + estimated cost) > `MONTHLY_CAP_USD`, returns 402 with the reason.
- **Spend ledger** in DynamoDB (`yeyaxin-trade-agent-spend`) — atomic increments via `UpdateExpression: ADD`. Day rolls at UTC midnight, month rolls on the 1st.
- **`max_retries=10` with exponential backoff** on the Anthropic SDK + LangChain `ChatAnthropic`. Brief 429/529 spikes during peak agent rounds don't fail the run.
- The Anthropic-side cap (set at console.anthropic.com) is the ultimate floor.

Calibrated per-run cost: ~$0.48 on Haiku 4.5 with depth=1 (~258k input + 45k output tokens). Per-synthesis: ~$0.012.

---

## Files

```
agent-runner/
├── Dockerfile                       # multi-stage, linux/amd64, uv-based
├── pyproject.toml
├── .env.example                     # copy to .env, never commit
├── .gitignore
└── src/agent_runner/
    ├── server.py                    # FastAPI: /health /run /synthesize /portfolios /jobs
    ├── runner.py                    # SINGLE entry point: execute() → TradingAgentsGraph.propagate
    ├── adapter.py                   # AgentState → Run JSON
    ├── synthesizer.py               # custom: portfolio synthesis Anthropic call
    ├── schema.py                    # pydantic mirrors of src/lib/types.ts
    ├── meter.py                     # token pricing
    ├── dynamo_ledger.py             # DDB-backed spend ledger
    ├── portfolios_store.py          # DDB-backed portfolio CRUD
    ├── s3_publisher.py              # publish runs/synthesis JSON to S3
    ├── env.py                       # dotenv loading + paths
    ├── cli_run.py                   # `run-analysis` entry point
    └── cli_synthesize.py            # `synthesize-portfolio` entry point
```

### One canonical entry point
`runner.execute(RunRequest)` is the **only** way the system runs an agent pipeline. Every path leads here:

- HTTP `POST /run` → `_do_run` → `execute(...)`
- Force-refresh button (UI) → loops over stale tickers → `POST /run` per ticker → `execute(...)`
- CLI `uv run run-analysis ...` → `execute(...)`

So **Re-analyze and Force-refresh produce identical results** for the same ticker — same model config, same TradingAgents call, same Anthropic API behavior.

---

## Environment variables

| Var | Required? | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Read from `.env` (local) or Secrets Manager (App Runner) |
| `AGENT_PASSWORD` | Yes (production) | Read from Secrets Manager. Unset = auth disabled (local dev only). |
| `DYNAMODB_TABLE` | Production | If set, spend ledger uses DDB instead of `.spend.json` |
| `RUN_JSON_BUCKET` | Production | If set, runs and synthesis published to `s3://{bucket}/runs/...` |
| `PORTFOLIOS_TABLE` | Production | DDB table for portfolio rows (default `yeyaxin-trade-portfolios`) |
| `MONTHLY_CAP_USD` | No | Default `20`. App-level cap. |
| `DAILY_CAP_USD` | No | Default `5`. App-level cap. |
| `AWS_REGION` | Production | Default `us-west-2`. |
| `CORS_EXTRA_ORIGINS` | No | Comma-separated list of additional allowed Origins. |

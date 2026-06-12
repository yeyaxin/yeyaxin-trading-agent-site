# agent-runner

Local CLI + HTTP server that runs [TradingAgents](https://github.com/TauricResearch/TradingAgents) and emits report JSON the Next.js site renders. **Local-only** for Phase 2 — never deploy this server to the public internet without auth.

## Setup

One-time:

```sh
cd agent-runner
uv sync                                       # installs deps in .venv
cp .env.example .env                          # then edit .env: set ANTHROPIC_API_KEY
```

`.env` is gitignored. The Anthropic key never leaves this directory.

Set a hard spend cap on your Anthropic key at console.anthropic.com → API Keys → Limits. The `MONTHLY_CAP_USD` / `DAILY_CAP_USD` knobs in `.env` are **belt-and-suspenders** app-level guards — they don't replace the Anthropic-side cap.

## Usage

### Run a single ticker

```sh
uv run run-analysis NVDA --date 2026-06-10 --model haiku --depth 1
# --model: haiku (default) | sonnet
# --depth: 0–3 bull/bear debate rounds (each round adds ~$0.05–$0.30)
# --dry-run: print the plan + estimate without spending tokens
```

Writes `../src/data/runs/nvda-2026-06-10.json`. The site picks it up on next reload.

### Synthesize a portfolio

```sh
uv run synthesize-portfolio path/to/portfolio.json --model haiku
```

The portfolio JSON must match `src/lib/types.ts` `Portfolio`. The CLI loads the latest per-ticker run for each position from `../src/data/runs/`. If any ticker has no run, the CLI errors and tells you which.

For the demo book:

```sh
uv run synthesize-portfolio ../src/data/portfolios/demo.json
```

Writes `../src/data/portfolios/demo-synthesis.json`.

### Run the local HTTP server (for the live "Re-analyze" buttons)

Two terminals while developing:

| Terminal | Command | Where |
|---|---|---|
| A — site | `npm run dev` | `~/yeyaxin-trading-agent-site/` |
| B — agent server | `uv run agent-server` | `~/yeyaxin-trading-agent-site/agent-runner/` |

Site polls `localhost:8787/health` every 30s. When it's reachable AND `ANTHROPIC_API_KEY` is set, the **Re-analyze** and **Force refresh** buttons go live.

```sh
# probe directly:
curl http://localhost:8787/health
```

## Calibration step (do this once)

The token shape numbers in `src/lib/cost.ts` (80k input / 13k output per run) are estimates. Replace them with measured numbers from your first real run:

1. `uv run run-analysis NVDA --date $(date +%Y-%m-%d) --model haiku --depth 1`
2. Note the printed actual cost + token counts.
3. If the actual is wildly different (>2×) from the estimate, update `TYPICAL_RUN_TOKENS` in `src/lib/cost.ts` and `estimate_run_cost`'s defaults in `agent_runner/meter.py`.
4. Verify: open the site, navigate to `/runs/nvda-{date}/`, confirm the agent reports + decision render.

## Files

```
agent-runner/
├── pyproject.toml
├── .env.example                  # copy to .env, never commit
├── .gitignore
├── .spend.json                   # auto-created, tracks daily/monthly spend
└── src/agent_runner/
    ├── schema.py                 # pydantic mirrors of src/lib/types.ts
    ├── meter.py                  # token pricing + spend ledger
    ├── env.py                    # dotenv loading + paths
    ├── adapter.py                # TradingAgents output → Run JSON
    ├── runner.py                 # the per-ticker pipeline
    ├── synthesizer.py            # one-shot Anthropic call for portfolios
    ├── cli_run.py                # `run-analysis` entry point
    ├── cli_synthesize.py         # `synthesize-portfolio` entry point
    └── server.py                 # FastAPI on localhost:8787
```

## Cost guards in this layer

- **Per-run estimate check** before any LLM call. Refuses to start if estimate > remaining daily or monthly budget.
- **Spend ledger** at `.spend.json`. Persisted across CLI invocations. Day rolls at UTC midnight, month rolls on the 1st.
- **Server `/run` endpoint** runs the same check before queueing a job. Returns 402 with the reason if blocked.
- These are belt-and-suspenders. The authoritative cap lives at the Anthropic console.

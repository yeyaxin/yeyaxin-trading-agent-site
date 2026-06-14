"""One-shot portfolio synthesis pass over per-ticker runs."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .env import load_env, require, site_data_dir
from .meter import (
    Tally,
    cost_for,
    SpendLedger,
    get_caps_from_env,
)
from .schema import (
    FactorExposure,
    Portfolio,
    PortfolioSynthesis,
    PositionDecision,
    Run,
    SynthesisUsage,
)


SYSTEM_PROMPT = """You are a portfolio manager synthesizing per-ticker analyst reports
into a portfolio-level view. You receive:
1. A portfolio (positions with shares and optional avg cost, plus cash).
2. Per-ticker analyst runs (decision, bull/bear cases, risks, trade plan).

Produce a JSON object with these fields:
- bookCommentary: a 4-6 sentence essay covering concentration, factor exposure,
  and the single most leveraged action.
- decisions: array of {ticker, action, rationale, sizingNote, perTickerRunId,
  lastAnalyzedAt}. Action is one of BUY_MORE, HOLD, TRIM, EXIT. Sizing must
  reference current weight as a % of NAV.
- factorExposure: array of {label, weightPct} — 3-6 factors covering geography,
  sector, theme, and cash.
- topRisks: array of 3-5 strings, portfolio-level (concentration, correlation,
  earnings clustering — not generic ticker risks).

Be specific. Quote numbers from the inputs. Do not produce generic advice."""


def _load_run(ticker: str) -> Run | None:
    """Find the latest Run for a ticker. Tries local site-data first
    (works in CLI mode), then falls back to S3 (works in App Runner where
    runs only live in S3 after publish)."""
    runs_dir = site_data_dir() / "runs"
    if runs_dir.exists():
        matches = sorted(runs_dir.glob(f"{ticker.lower()}-*.json"))
        if matches:
            return Run.model_validate_json(matches[-1].read_text())

    bucket = os.environ.get("RUN_JSON_BUCKET")
    if bucket:
        return _load_run_from_s3(bucket, ticker)
    return None


def _load_run_from_s3(bucket: str, ticker: str) -> Run | None:
    import boto3

    s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-west-2"))
    paginator = s3.get_paginator("list_objects_v2")
    candidates: list[tuple[str, Any]] = []
    prefix = f"runs/{ticker.lower()}-"
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith(".json"):
                candidates.append((key, obj.get("LastModified")))
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[1] or 0, reverse=True)
    latest_key = candidates[0][0]
    body = s3.get_object(Bucket=bucket, Key=latest_key)["Body"].read()
    return Run.model_validate_json(body)


def _load_portfolio(portfolio_path: Path) -> Portfolio:
    return Portfolio.model_validate_json(portfolio_path.read_text())


def _build_user_message(p: Portfolio, runs: dict[str, Run]) -> str:
    lines: list[str] = []
    lines.append(f"PORTFOLIO: {p.name} (id={p.id})")
    lines.append(f"  cash: ${p.cashUsd:,.2f}")
    lines.append("  positions:")
    for pos in p.positions:
        avg = f"${pos.avgCost:.2f}" if pos.avgCost else "—"
        last = f"${pos.lastPrice:.2f}" if pos.lastPrice else "—"
        lines.append(
            f"    {pos.ticker}: {pos.shares} sh, avgCost {avg}, lastPrice {last}"
        )
    lines.append("")
    lines.append("PER-TICKER ANALYST RUNS:")
    for ticker, run in runs.items():
        lines.append(f"--- {ticker} ({run.asOfDate}, decision={run.decision}, "
                     f"confidence={run.confidence:.2f}) ---")
        lines.append(f"oneLine: {run.oneLine}")
        lines.append(f"runId: {run.id}")
        lines.append(f"createdAt: {run.createdAt}")
        if run.bullCase:
            lines.append("bullCase: " + " | ".join(run.bullCase))
        if run.bearCase:
            lines.append("bearCase: " + " | ".join(run.bearCase))
        if run.risks:
            lines.append("risks: " + " | ".join(run.risks))
        lines.append(f"trade: {run.tradePlan.model_dump_json()}")
        lines.append("")
    return "\n".join(lines)


def synthesize(portfolio_path: Path, model: str = "claude-haiku-4-5") -> PortfolioSynthesis:
    """CLI-style entry point. Reads portfolio from disk, then defers to
    synthesize_portfolio()."""
    portfolio = _load_portfolio(portfolio_path)
    return synthesize_portfolio(portfolio, model=model)


def synthesize_portfolio(
    portfolio: Portfolio, model: str = "claude-haiku-4-5"
) -> PortfolioSynthesis:
    load_env()
    require("ANTHROPIC_API_KEY")
    from anthropic import Anthropic

    runs: dict[str, Run] = {}
    missing: list[str] = []
    for pos in portfolio.positions:
        run = _load_run(pos.ticker)
        if run is None:
            missing.append(pos.ticker)
            continue
        runs[pos.ticker] = run

    if missing:
        raise RuntimeError(
            "no per-ticker runs found for: "
            + ", ".join(missing)
            + ". Re-analyze each missing ticker first."
        )

    daily_cap, monthly_cap = get_caps_from_env()
    estimated_cost = cost_for(model, 5_000, 3_000)
    table = os.environ.get("DYNAMODB_TABLE")
    if table:
        from .dynamo_ledger import DynamoSpendLedger

        ledger: Any = DynamoSpendLedger.load(table)
    else:
        ledger_path = Path(__file__).resolve().parent.parent.parent / ".spend.json"
        ledger = SpendLedger.load(ledger_path)
    from datetime import date as _date
    ok, why = ledger.can_spend(estimated_cost, _date.today(), daily_cap, monthly_cap)
    if not ok:
        raise RuntimeError(f"cost cap blocked synthesis: {why}")

    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], max_retries=10)
    user = _build_user_message(portfolio, runs)

    schema = {
        "type": "object",
        "properties": {
            "bookCommentary": {"type": "string"},
            "decisions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ticker": {"type": "string"},
                        "action": {"enum": ["BUY_MORE", "HOLD", "TRIM", "EXIT"]},
                        "rationale": {"type": "string"},
                        "sizingNote": {"type": "string"},
                        "perTickerRunId": {"type": "string"},
                        "lastAnalyzedAt": {"type": "string"},
                    },
                    "required": [
                        "ticker", "action", "rationale", "sizingNote",
                        "perTickerRunId", "lastAnalyzedAt",
                    ],
                },
            },
            "factorExposure": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "weightPct": {"type": "number"},
                    },
                    "required": ["label", "weightPct"],
                },
            },
            "topRisks": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["bookCommentary", "decisions", "factorExposure", "topRisks"],
    }

    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user}],
        tools=[
            {
                "name": "emit_synthesis",
                "description": "Emit the structured portfolio synthesis.",
                "input_schema": schema,
            }
        ],
        tool_choice={"type": "tool", "name": "emit_synthesis"},
    )

    payload: dict[str, Any] = {}
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", "") == "emit_synthesis":
            payload = dict(block.input)  # type: ignore[arg-type]
            break
    if not payload:
        raise RuntimeError("model did not return a tool_use block; cannot synthesize")

    tally = Tally()
    tally.add(
        model,
        int(response.usage.input_tokens),
        int(response.usage.output_tokens),
    )

    # Anthropic's structured output respects `required` most of the time
    # but occasionally drops fields. Use defensive access so a missing list
    # produces an empty section instead of a KeyError that loses the run.
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    raw_decisions = payload.get("decisions") or []
    raw_factors = payload.get("factorExposure") or []
    raw_risks = payload.get("topRisks") or []
    synth = PortfolioSynthesis(
        id=f"{portfolio.id}-synth-{now[:10]}-{now[11:19].replace(':', '')}",
        portfolioId=portfolio.id,
        createdAt=now,
        bookCommentary=str(payload.get("bookCommentary") or ""),
        decisions=[PositionDecision(**d) for d in raw_decisions if isinstance(d, dict)],
        factorExposure=[FactorExposure(**f) for f in raw_factors if isinstance(f, dict)],
        topRisks=[str(r) for r in raw_risks],
        usage=SynthesisUsage(costUsd=round(tally.cost_usd, 4)),
    )

    out_dir = site_data_dir() / "portfolios"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{portfolio.id}-synthesis.json"
    out_path.write_text(json.dumps(synth.model_dump(exclude_none=True), indent=2))

    try:
        from .s3_publisher import publish_synthesis

        publish_synthesis(synth)
    except Exception as e:  # noqa: BLE001
        print(f"warning: S3 publish failed: {e}")

    ledger.commit(tally.cost_usd, _date.today())

    return synth

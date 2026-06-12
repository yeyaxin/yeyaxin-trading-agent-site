"""Drive a single TradingAgents run end-to-end and emit Run JSON."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from .adapter import to_run
from .env import load_env, require, site_data_dir
from .meter import (
    SpendLedger,
    Tally,
    estimate_run_cost,
    get_caps_from_env,
)
from .schema import Run


@dataclass
class RunRequest:
    ticker: str
    as_of_date: str  # YYYY-MM-DD
    deep_model: str
    quick_model: str
    debate_rounds: int = 1
    online_tools: bool = True


@dataclass
class RunResult:
    run: Run
    json_path: Path
    estimated_cost_usd: float
    actual_cost_usd: float


def _spend_ledger_path() -> Path:
    return Path(__file__).resolve().parent.parent.parent / ".spend.json"


def _ledger() -> Any:
    table = os.environ.get("DYNAMODB_TABLE")
    if table:
        from .dynamo_ledger import DynamoSpendLedger

        return DynamoSpendLedger.load(table)
    return SpendLedger.load(_spend_ledger_path())


def _check_caps(estimated_cost: float) -> None:
    daily_cap, monthly_cap = get_caps_from_env()
    ledger = _ledger()
    ok, why = ledger.can_spend(estimated_cost, date.today(), daily_cap, monthly_cap)
    if not ok:
        raise RuntimeError(f"cost cap blocked the run: {why}")


def _commit_spend(actual_cost: float) -> None:
    _ledger().commit(actual_cost, date.today())


def _build_config(req: RunRequest) -> dict[str, Any]:
    # All five top-line fields are required by tradingagents.config.TradingAgentsConfig.
    # Risk-discuss rounds is the conservative/aggressive/neutral debate; keep it small
    # to control cost. Recursion limit caps LangGraph node visits.
    return {
        "llm_provider": "anthropic",
        "deep_think_llm": req.deep_model,
        "quick_think_llm": req.quick_model,
        "max_debate_rounds": req.debate_rounds,
        "max_risk_discuss_rounds": 1,
        "max_recur_limit": 50,
    }


def _instantiate_graph(config: dict[str, Any], callbacks: list[Any]) -> Any:
    """Lazy-import TradingAgents so this module can load without it."""
    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
    except ImportError as e:
        raise RuntimeError(
            "tradingagents not installed in this venv; run "
            "`uv sync` from agent-runner/."
        ) from e
    _patch_anthropic_effort()
    return TradingAgentsGraph(config=config, callbacks=callbacks)


def _make_token_callback(tally: "Tally", default_model: str) -> Any:
    """Subclass BaseCallbackHandler to capture usage_metadata from every LLM call.
    Built lazily so this module imports without LangChain in the way."""
    from langchain_core.callbacks import BaseCallbackHandler

    class _TokenCapture(BaseCallbackHandler):
        ignore_llm = False
        ignore_chat_model = False

        def on_llm_end(self, response, *args: Any, **kwargs: Any) -> None:  # type: ignore[no-untyped-def]
            try:
                for batch in getattr(response, "generations", []) or []:
                    for gen in batch:
                        msg = getattr(gen, "message", None)
                        if msg is None:
                            continue
                        usage = getattr(msg, "usage_metadata", None)
                        if not isinstance(usage, dict):
                            continue
                        ti = int(usage.get("input_tokens", 0) or 0)
                        to = int(usage.get("output_tokens", 0) or 0)
                        if ti == 0 and to == 0:
                            continue
                        rm = getattr(msg, "response_metadata", None) or {}
                        model = rm.get("model_name") or rm.get("model") or default_model
                        try:
                            tally.add(str(model), ti, to)
                        except ValueError:
                            tally.add(default_model, ti, to)
            except Exception:
                return

    return _TokenCapture()


def _patch_anthropic_effort() -> None:
    """TradingAgents 0.7.0 always forwards `reasoning_effort` to Anthropic as
    `effort`, but Claude 4.5/4.7 family models reject the param ('Extra inputs
    are not permitted'). Strip it for Anthropic builds. Idempotent.
    """
    from tradingagents import llm as ta_llm

    if getattr(ta_llm, "_yeyaxin_effort_patched", False):
        return
    original = ta_llm.build_chat_model

    def patched(provider, model, *, reasoning_effort=None, callbacks=None):  # type: ignore[no-untyped-def]
        effective = None if provider == "anthropic" else reasoning_effort
        return original(
            provider,
            model,
            reasoning_effort=effective,
            callbacks=callbacks,
        )

    ta_llm.build_chat_model = patched
    # graph imports the symbol directly — re-bind there too.
    from tradingagents.graph import trading_graph as ta_graph
    ta_graph.build_chat_model = patched

    ta_llm._yeyaxin_effort_patched = True


def _propagate(graph: Any, req: RunRequest) -> tuple[Any, Any]:
    """Returns (AgentState, TradeRecommendation) from TradingAgents."""
    return graph.propagate(req.ticker.upper(), req.as_of_date)


def execute(req: RunRequest) -> RunResult:
    """Run the agent pipeline and write the JSON. Raises if cost cap is exceeded."""
    load_env()
    require("ANTHROPIC_API_KEY")
    os.environ.setdefault("ANTHROPIC_API_KEY", os.environ["ANTHROPIC_API_KEY"])

    estimated = estimate_run_cost(req.deep_model)
    _check_caps(estimated)

    config = _build_config(req)
    tally = Tally()
    callback = _make_token_callback(tally, default_model=req.deep_model)
    graph = _instantiate_graph(config, callbacks=[callback])
    agent_state, recommendation = _propagate(graph, req)

    run = to_run(
        ticker=req.ticker,
        as_of_date=req.as_of_date,
        agent_state=agent_state,
        recommendation=recommendation,
        deep_model=req.deep_model,
        quick_model=req.quick_model,
        debate_rounds=req.debate_rounds,
        tally=tally,
    )

    out_dir = site_data_dir() / "runs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{run.id}.json"
    out_path.write_text(json.dumps(run.model_dump(exclude_none=True), indent=2))

    # Publish to S3 if configured (production). Local dev runs without
    # RUN_JSON_BUCKET set will skip this.
    try:
        from .s3_publisher import publish_run

        publish_run(run)
    except Exception as e:  # noqa: BLE001
        # Don't fail the run if S3 publish fails; the local file is still written.
        print(f"warning: S3 publish failed: {e}")

    _commit_spend(tally.cost_usd)

    return RunResult(
        run=run,
        json_path=out_path,
        estimated_cost_usd=estimated,
        actual_cost_usd=tally.cost_usd,
    )



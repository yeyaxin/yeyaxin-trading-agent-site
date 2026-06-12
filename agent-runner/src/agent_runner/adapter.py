"""Convert TradingAgents AgentState + TradeRecommendation into our site's
Run JSON. This is the one place that knows the upstream library shape.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from .meter import Tally
from .schema import (
    AgentReport,
    ModelPair,
    Run,
    TradePlan,
    Usage,
)


def _safe_str(x: Any) -> str:
    if x is None:
        return ""
    if isinstance(x, str):
        return x.strip()
    return str(x).strip()


def _attr(obj: Any, key: str, default: Any = "") -> Any:
    """getattr-or-getitem, since AgentState is a pydantic model and tests/dicts may pass dicts."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _summary(body: str) -> str:
    body = body.strip()
    if not body:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", body)
    return parts[0][:240] if parts else body[:240]


_HEADER_RE = re.compile(r"^#{1,6}\s")
_SPEAKER_RE = re.compile(r"^(?:Bull(?:ish)?|Bear(?:ish)?|Bull Analyst|Bear Analyst)\s*:\s*", re.I)


def _bullets_from(text: str, *, limit: int = 5) -> list[str]:
    if not text:
        return []
    bullets: list[str] = []
    seen: set[str] = set()

    def _accept(s: str) -> bool:
        s = _SPEAKER_RE.sub("", s).strip()
        # skip markdown headers (`#` / `##` lines)
        if _HEADER_RE.match(s):
            return False
        # skip emphasis-only lines (e.g. "**Headline**")
        if re.fullmatch(r"\**[A-Z0-9 ,.\-:]+\**", s):
            return False
        if 20 < len(s) < 280 and s not in seen:
            seen.add(s)
            bullets.append(s)
            return True
        return False

    # First pass: explicit list markers (- * • numbered).
    for line in text.splitlines():
        raw = line.strip()
        if not raw:
            continue
        m = re.match(r"^(?:[-•*]|\d+[.)])\s+(.*)$", raw)
        if not m:
            continue
        _accept(m.group(1))
        if len(bullets) >= limit:
            return bullets

    if bullets:
        return bullets

    # Fallback: substantive sentences that aren't headers.
    for s in re.split(r"(?<=[.!?])\s+", text):
        _accept(s.strip())
        if len(bullets) >= limit:
            break
    return bullets


def _build_agents(state: Any) -> list[AgentReport]:
    fundamentals = _safe_str(_attr(state, "fundamentals_report"))
    sentiment = _safe_str(_attr(state, "sentiment_report"))
    news = _safe_str(_attr(state, "news_report"))
    technical = _safe_str(_attr(state, "market_report"))
    invest_debate = _attr(state, "investment_debate_state")
    bull = _safe_str(_attr(invest_debate, "bull_history"))
    bear = _safe_str(_attr(invest_debate, "bear_history"))
    investment_plan = _safe_str(_attr(state, "investment_plan"))
    trader_plan = _safe_str(_attr(state, "trader_investment_plan"))
    risk_debate = _attr(state, "risk_debate_state")
    risk_judge = _safe_str(_attr(risk_debate, "judge_decision"))
    final_decision = _safe_str(_attr(state, "final_trade_decision"))

    out: list[AgentReport] = []

    if fundamentals:
        out.append(AgentReport(
            kind="fundamentals", title="Fundamentals Analyst",
            summary=_summary(fundamentals), body=fundamentals,
        ))
    if sentiment:
        out.append(AgentReport(
            kind="sentiment", title="Sentiment Analyst",
            summary=_summary(sentiment), body=sentiment,
        ))
    if news:
        out.append(AgentReport(
            kind="news", title="News Analyst",
            summary=_summary(news), body=news,
        ))
    if technical:
        out.append(AgentReport(
            kind="technical", title="Technical Analyst",
            summary=_summary(technical), body=technical,
        ))
    if bull:
        out.append(AgentReport(
            kind="bull", title="Bull Researcher",
            summary=_summary(bull), body=bull,
        ))
    if bear:
        out.append(AgentReport(
            kind="bear", title="Bear Researcher",
            summary=_summary(bear), body=bear,
        ))
    if trader_plan or investment_plan:
        body = trader_plan or investment_plan
        out.append(AgentReport(
            kind="trader", title="Trader",
            summary=_summary(body), body=body,
        ))
    if risk_judge:
        out.append(AgentReport(
            kind="risk", title="Risk Manager",
            summary=_summary(risk_judge), body=risk_judge,
        ))
    if final_decision:
        out.append(AgentReport(
            kind="portfolio", title="Portfolio Manager",
            summary=_summary(final_decision), body=final_decision,
        ))

    return out


def _trade_plan(rec: Any, decision: str) -> TradePlan:
    def _fmt(value: Any, suffix: str = "") -> str:
        if value is None:
            return "Not specified"
        if isinstance(value, (int, float)):
            return f"${value:,.2f}{suffix}"
        return str(value)

    size_fraction = _attr(rec, "size_fraction")
    size = (
        f"{float(size_fraction) * 100:.1f}% of position"
        if isinstance(size_fraction, (int, float))
        else "Not specified"
    )
    return TradePlan(
        action=decision,  # type: ignore[arg-type]
        size=size,
        entry=_fmt(_attr(rec, "entry_reference_price")),
        stop=_fmt(_attr(rec, "stop_loss")),
        target=_fmt(_attr(rec, "target_price")),
    )


def to_run(
    *,
    ticker: str,
    as_of_date: str,
    agent_state: Any,
    recommendation: Any,
    deep_model: str,
    quick_model: str,
    debate_rounds: int,
    tally: Tally,
) -> Run:
    decision = _safe_str(_attr(recommendation, "signal", "HOLD")) or "HOLD"
    if decision not in ("BUY", "HOLD", "SELL"):
        decision = "HOLD"

    confidence_raw = _attr(recommendation, "confidence", 0.5)
    try:
        confidence = float(confidence_raw)
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence if confidence <= 1.0 else confidence / 100.0))

    rationale = _safe_str(_attr(recommendation, "rationale"))
    final_decision = _safe_str(_attr(agent_state, "final_trade_decision"))
    one_line_source = rationale or final_decision or f"{ticker}: agent panel produced no clear signal."
    one_line_parts = re.split(r"(?<=[.!?])\s+", one_line_source.strip())
    one_line = next(
        (s.strip() for s in one_line_parts if len(s.strip()) > 30),
        one_line_source[:200].strip(),
    )

    # Bull/bear bullets come from investment_debate_state's per-side histories;
    # risks come from the risk-judge decision.
    invest_debate = _attr(agent_state, "investment_debate_state")
    risk_debate = _attr(agent_state, "risk_debate_state")
    bull_case = _bullets_from(_safe_str(_attr(invest_debate, "bull_history")))
    bear_case = _bullets_from(_safe_str(_attr(invest_debate, "bear_history")))
    risks = _bullets_from(_safe_str(_attr(risk_debate, "judge_decision")))

    agents = _build_agents(agent_state)
    trade_plan = _trade_plan(recommendation, decision)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    run_id = f"{ticker.lower()}-{as_of_date}"

    return Run(
        id=run_id,
        ticker=ticker.upper(),
        asOfDate=as_of_date,
        createdAt=now,
        model=ModelPair(deep=deep_model, quick=quick_model),
        debateRounds=debate_rounds,
        decision=decision,  # type: ignore[arg-type]
        confidence=confidence,
        oneLine=one_line,
        bullCase=bull_case,
        bearCase=bear_case,
        risks=risks,
        tradePlan=trade_plan,
        agents=agents,
        usage=Usage(
            inputTokens=tally.input_tokens,
            outputTokens=tally.output_tokens,
            costUsd=round(tally.cost_usd, 4),
        ),
    )

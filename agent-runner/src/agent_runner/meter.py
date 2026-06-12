"""Token + cost accounting. Mirrors src/lib/cost.ts pricing constants."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

PRICING_PER_M_TOKENS: dict[str, dict[str, float]] = {
    # ($/M input, $/M output) — confirm against Anthropic pricing before relying on numbers.
    "claude-haiku-4-5": {"input": 1.0, "output": 5.0},
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
    "claude-opus-4-8": {"input": 15.0, "output": 75.0},
}


def cost_for(model: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICING_PER_M_TOKENS.get(model)
    if not p:
        raise ValueError(f"unknown model {model!r}; add it to PRICING_PER_M_TOKENS")
    return (input_tokens / 1_000_000) * p["input"] + (output_tokens / 1_000_000) * p[
        "output"
    ]


@dataclass
class Tally:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    by_model: dict[str, dict[str, int | float]] = field(default_factory=dict)

    def add(self, model: str, input_tokens: int, output_tokens: int) -> None:
        c = cost_for(model, input_tokens, output_tokens)
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.cost_usd += c
        bucket = self.by_model.setdefault(
            model, {"inputTokens": 0, "outputTokens": 0, "costUsd": 0.0}
        )
        bucket["inputTokens"] = int(bucket["inputTokens"]) + input_tokens
        bucket["outputTokens"] = int(bucket["outputTokens"]) + output_tokens
        bucket["costUsd"] = float(bucket["costUsd"]) + c


@dataclass
class SpendLedger:
    """Persists daily/monthly spend at agent-runner/.spend.json so the cost
    cap survives restarts. Not bulletproof (race-y under concurrent CLIs), but
    this is single-user."""

    path: Path
    day: str = ""
    month: str = ""
    day_spent_usd: float = 0.0
    month_spent_usd: float = 0.0

    @classmethod
    def load(cls, path: Path) -> "SpendLedger":
        ledger = cls(path=path)
        if not path.exists():
            return ledger
        try:
            data = json.loads(path.read_text())
            ledger.day = data.get("day", "")
            ledger.month = data.get("month", "")
            ledger.day_spent_usd = float(data.get("daySpentUsd", 0.0))
            ledger.month_spent_usd = float(data.get("monthSpentUsd", 0.0))
        except (OSError, ValueError, json.JSONDecodeError):
            pass
        return ledger

    def save(self) -> None:
        self.path.write_text(
            json.dumps(
                {
                    "day": self.day,
                    "month": self.month,
                    "daySpentUsd": round(self.day_spent_usd, 6),
                    "monthSpentUsd": round(self.month_spent_usd, 6),
                },
                indent=2,
            )
        )

    def _roll(self, today: date) -> None:
        d = today.isoformat()
        m = today.strftime("%Y-%m")
        if self.day != d:
            self.day = d
            self.day_spent_usd = 0.0
        if self.month != m:
            self.month = m
            self.month_spent_usd = 0.0

    def can_spend(
        self,
        planned_usd: float,
        today: date,
        daily_cap: float,
        monthly_cap: float,
    ) -> tuple[bool, str]:
        self._roll(today)
        if self.day_spent_usd + planned_usd > daily_cap:
            return (
                False,
                f"daily cap: would push ${self.day_spent_usd:.2f} -> "
                f"${self.day_spent_usd + planned_usd:.2f} above ${daily_cap:.2f}",
            )
        if self.month_spent_usd + planned_usd > monthly_cap:
            return (
                False,
                f"monthly cap: would push ${self.month_spent_usd:.2f} -> "
                f"${self.month_spent_usd + planned_usd:.2f} above ${monthly_cap:.2f}",
            )
        return True, ""

    def commit(self, actual_usd: float, today: date) -> None:
        self._roll(today)
        self.day_spent_usd += actual_usd
        self.month_spent_usd += actual_usd
        self.save()


def get_caps_from_env() -> tuple[float, float]:
    monthly = float(os.environ.get("MONTHLY_CAP_USD", "20"))
    daily = float(os.environ.get("DAILY_CAP_USD", "5"))
    return daily, monthly


def estimate_run_cost(model: str, input_tokens: int = 260_000, output_tokens: int = 45_000) -> float:
    """Per-run estimate. Calibrated 2026-06-11 against a real Haiku 4.5 /
    depth-1 NVDA run (258k in / 45k out → $0.48). Re-calibrate if a future
    run drifts >2x."""
    return cost_for(model, input_tokens, output_tokens)

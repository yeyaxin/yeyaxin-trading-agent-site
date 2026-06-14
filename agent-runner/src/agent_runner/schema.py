"""Pydantic mirrors of src/lib/types.ts. Single source of truth for the JSON
the site reads from src/data/. Field names + casing must match TS exactly.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Decision = Literal["BUY", "HOLD", "SELL"]
PortfolioAction = Literal["BUY_MORE", "HOLD", "TRIM", "EXIT"]
AgentKind = Literal[
    "fundamentals",
    "sentiment",
    "news",
    "technical",
    "bull",
    "bear",
    "trader",
    "risk",
    "portfolio",
]


class AgentReport(BaseModel):
    kind: AgentKind
    title: str
    summary: str
    body: str
    highlights: list[str] | None = None


class TradePlan(BaseModel):
    action: Decision
    size: str
    entry: str
    stop: str
    target: str


class Usage(BaseModel):
    inputTokens: int = Field(ge=0)
    outputTokens: int = Field(ge=0)
    costUsd: float = Field(ge=0)


class ModelPair(BaseModel):
    deep: str
    quick: str


class Run(BaseModel):
    id: str
    ticker: str
    asOfDate: str  # YYYY-MM-DD
    createdAt: str  # ISO 8601 UTC
    model: ModelPair
    debateRounds: int = Field(ge=0)
    decision: Decision
    confidence: float = Field(ge=0.0, le=1.0)
    oneLine: str
    bullCase: list[str]
    bearCase: list[str]
    risks: list[str]
    tradePlan: TradePlan
    agents: list[AgentReport]
    usage: Usage
    demo: bool | None = None


class Position(BaseModel):
    ticker: str
    shares: float = Field(gt=0)
    avgCost: float | None = Field(default=None, gt=0)
    lastPrice: float | None = Field(default=None, gt=0)

    # Per-ticker analysis state (mirrors src/lib/types.ts Position).
    lastJobId: str | None = None
    lastAnalyzedAt: str | None = None
    lastRunId: str | None = None
    lastError: str | None = None


class Portfolio(BaseModel):
    id: str
    name: str
    positions: list[Position]
    cashUsd: float = Field(ge=0)
    createdAt: str
    updatedAt: str


class PositionDecision(BaseModel):
    # All fields default-able so a missing key in Anthropic's structured
    # output doesn't crash the whole synthesis. The UI tolerates empties.
    ticker: str = ""
    action: PortfolioAction = "HOLD"
    rationale: str = ""
    sizingNote: str = ""
    perTickerRunId: str | None = None
    lastAnalyzedAt: str | None = None


class FactorExposure(BaseModel):
    label: str = ""
    weightPct: float = Field(default=0, ge=0)


class SynthesisUsage(BaseModel):
    costUsd: float = Field(ge=0)


class PortfolioSynthesis(BaseModel):
    id: str
    portfolioId: str
    createdAt: str
    bookCommentary: str
    decisions: list[PositionDecision]
    factorExposure: list[FactorExposure]
    topRisks: list[str]
    usage: SynthesisUsage
    demo: bool | None = None

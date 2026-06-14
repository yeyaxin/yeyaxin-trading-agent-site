export type Decision = "BUY" | "HOLD" | "SELL";

export type AgentKind =
  | "fundamentals"
  | "sentiment"
  | "news"
  | "technical"
  | "bull"
  | "bear"
  | "trader"
  | "risk"
  | "portfolio";

export type AgentReport = {
  kind: AgentKind;
  title: string;
  summary: string;
  body: string;
  highlights?: string[];
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type Run = {
  id: string;
  ticker: string;
  asOfDate: string;
  createdAt: string;
  model: { deep: string; quick: string };
  debateRounds: number;
  decision: Decision;
  confidence: number;
  oneLine: string;
  bullCase: string[];
  bearCase: string[];
  risks: string[];
  tradePlan: { action: Decision; size: string; entry: string; stop: string; target: string };
  agents: AgentReport[];
  usage: Usage;
  demo?: boolean;
};

export type RunSummary = Pick<
  Run,
  "id" | "ticker" | "asOfDate" | "createdAt" | "decision" | "confidence" | "oneLine"
> & { costUsd: number };

/**
 * Per-position analysis state. Persisted server-side so it's consistent
 * across browsers / tabs / sessions.
 *
 * Lifecycle:
 *   never-analyzed (no fields set) → running (lastJobId set) → ready
 *     (lastAnalyzedAt + lastRunId set, lastJobId/Error cleared)
 *   running → error (lastError set, lastJobId cleared)
 */
export type Position = {
  ticker: string;
  shares: number;
  avgCost?: number;
  lastPrice?: number;

  /** Set when an agent run for this ticker is in flight; cleared when done/error. */
  lastJobId?: string;
  /** ISO 8601 timestamp of the last successful analysis. Drives staleness. */
  lastAnalyzedAt?: string;
  /** Run id (e.g. "nvda-2026-06-14") of the most recent successful run. */
  lastRunId?: string;
  /** Set on the most recent failed run; cleared by the next successful run. */
  lastError?: string;
};

export type Portfolio = {
  id: string;
  name: string;
  positions: Position[];
  cashUsd: number;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioAction = "BUY_MORE" | "HOLD" | "TRIM" | "EXIT";

export type PositionDecision = {
  ticker: string;
  action: PortfolioAction;
  rationale: string;
  sizingNote: string;
  perTickerRunId?: string;
  lastAnalyzedAt?: string;
};

export type FactorExposure = { label: string; weightPct: number };

export type PortfolioSynthesis = {
  id: string;
  portfolioId: string;
  createdAt: string;
  bookCommentary: string;
  decisions: PositionDecision[];
  factorExposure: FactorExposure[];
  topRisks: string[];
  usage: { costUsd: number };
  demo?: boolean;
};

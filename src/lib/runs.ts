import type { Run, RunSummary } from "./types";
import { ALL_RUNS } from "@/data/runs/_index";

const all: Run[] = ALL_RUNS;

export function getRuns(): Run[] {
  return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRun(id: string): Run | undefined {
  return all.find((r) => r.id === id);
}

export function summarize(r: Run): RunSummary {
  return {
    id: r.id,
    ticker: r.ticker,
    asOfDate: r.asOfDate,
    createdAt: r.createdAt,
    decision: r.decision,
    confidence: r.confidence,
    oneLine: r.oneLine,
    costUsd: r.usage.costUsd,
  };
}

// For each ticker, prefer the most recent run by createdAt.
export const tickerToRunId: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const r of getRuns()) {
    if (!(r.ticker in map)) map[r.ticker] = r.id;
  }
  return map;
})();

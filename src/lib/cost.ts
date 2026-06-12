export const MONTHLY_CAP_USD = 20;

export const MODEL_PRICING_PER_M_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 15, output: 75 },
};

// Calibrated 2026-06-11 against a real Haiku 4.5 / depth-1 NVDA run:
// 258,532 input / 44,577 output → $0.48. Update if a future run drifts >2x.
export const TYPICAL_RUN_TOKENS = { inputTokens: 260_000, outputTokens: 45_000 };

export function priceRun(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = MODEL_PRICING_PER_M_TOKENS[model];
  if (!p) return Number.NaN;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

export function estimateRunCost(model: string): number {
  return priceRun(model, TYPICAL_RUN_TOKENS.inputTokens, TYPICAL_RUN_TOKENS.outputTokens);
}

export type Spend = { monthSoFar: number; cap: number; remaining: number; canRun: boolean };

export function evaluateSpend(monthSoFar: number, plannedCost: number): Spend {
  const remaining = Math.max(0, MONTHLY_CAP_USD - monthSoFar);
  return {
    monthSoFar,
    cap: MONTHLY_CAP_USD,
    remaining,
    canRun: plannedCost <= remaining,
  };
}

export function formatUsd(n: number): string {
  if (Number.isNaN(n)) return "—";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

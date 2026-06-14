import type { Position } from "./types";

export type TickerLifecycle =
  | "never-analyzed"
  | "running"
  | "ready"
  | "error";

export type TickerState = {
  lifecycle: TickerLifecycle;
  /** ISO 8601 of the last successful analysis, if any. */
  lastAnalyzedAt: string | null;
  /** Run id of the last successful analysis, links to /runs/{id}/. */
  lastRunId: string | null;
  /** In-flight job id when lifecycle === "running". */
  jobId: string | null;
  /** Last error message when lifecycle === "error". */
  errorMessage: string | null;
};

/**
 * Compute the lifecycle state of one position purely from server-side
 * Position fields. The UI is allowed to merge in optimistic local state
 * (e.g. "we just clicked Analyze, the server hasn't confirmed yet") on top.
 */
export function deriveTickerState(pos: Position): TickerState {
  if (pos.lastJobId) {
    return {
      lifecycle: "running",
      lastAnalyzedAt: pos.lastAnalyzedAt ?? null,
      lastRunId: pos.lastRunId ?? null,
      jobId: pos.lastJobId,
      errorMessage: null,
    };
  }
  if (pos.lastError) {
    return {
      lifecycle: "error",
      lastAnalyzedAt: pos.lastAnalyzedAt ?? null,
      lastRunId: pos.lastRunId ?? null,
      jobId: null,
      errorMessage: pos.lastError,
    };
  }
  if (pos.lastAnalyzedAt) {
    return {
      lifecycle: "ready",
      lastAnalyzedAt: pos.lastAnalyzedAt,
      lastRunId: pos.lastRunId ?? null,
      jobId: null,
      errorMessage: null,
    };
  }
  return {
    lifecycle: "never-analyzed",
    lastAnalyzedAt: null,
    lastRunId: pos.lastRunId ?? null,
    jobId: null,
    errorMessage: null,
  };
}

/** "3h ago" / "5d ago" / "just now" given an ISO timestamp. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const ms = Date.now() - t;
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export const STALE_HOURS = 8;

export function isStale(state: TickerState): boolean {
  if (state.lifecycle !== "ready") return false;
  if (!state.lastAnalyzedAt) return true;
  const age = Date.now() - new Date(state.lastAnalyzedAt).getTime();
  return age > STALE_HOURS * 60 * 60 * 1000;
}

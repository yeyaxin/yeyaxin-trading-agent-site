"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentServerError,
  fetchJob,
  listJobs,
  pollJob,
  startRun,
  type Job,
} from "./agentClient";

const LS_PREFIX = "yeyaxin.runningJobs.v1";

type Tracked = {
  ticker: string;
  jobId: string;
  startedAt: string;
  estimatedCostUsd?: number;
};

export type TickerJobState =
  | { state: "idle" }
  | { state: "running"; jobId: string; startedAt: string; estimatedCostUsd?: number }
  | { state: "done"; jobId: string; runId: string | null; cost: number | null }
  | { state: "error"; jobId: string | null; message: string };

function lsKey(portfolioId: string): string {
  return `${LS_PREFIX}.${portfolioId}`;
}

function readLS(portfolioId: string): Record<string, Tracked> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(lsKey(portfolioId));
    return raw ? (JSON.parse(raw) as Record<string, Tracked>) : {};
  } catch {
    return {};
  }
}

function writeLS(portfolioId: string, data: Record<string, Tracked>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lsKey(portfolioId), JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Per-portfolio job tracker. Owns:
 *  - localStorage persistence of (ticker -> running job)
 *  - polling each running job to completion
 *  - resuming on remount via /jobs?portfolioId=X
 */
export function useJobTracker(portfolioId: string, agentReady: boolean) {
  const [byTicker, setByTicker] = useState<Record<string, TickerJobState>>(
    () => {
      const ls = readLS(portfolioId);
      const out: Record<string, TickerJobState> = {};
      for (const [t, rec] of Object.entries(ls)) {
        out[t] = {
          state: "running",
          jobId: rec.jobId,
          startedAt: rec.startedAt,
          estimatedCostUsd: rec.estimatedCostUsd,
        };
      }
      return out;
    },
  );
  const trackedRef = useRef<Set<string>>(new Set());

  const persistRunning = useCallback(
    (next: Record<string, TickerJobState>) => {
      const data: Record<string, Tracked> = {};
      for (const [ticker, st] of Object.entries(next)) {
        if (st.state === "running") {
          data[ticker] = {
            ticker,
            jobId: st.jobId,
            startedAt: st.startedAt,
            estimatedCostUsd: st.estimatedCostUsd,
          };
        }
      }
      writeLS(portfolioId, data);
    },
    [portfolioId],
  );

  const updateOne = useCallback(
    (ticker: string, st: TickerJobState) => {
      setByTicker((prev) => {
        const next = { ...prev, [ticker]: st };
        persistRunning(next);
        return next;
      });
    },
    [persistRunning],
  );

  const trackJob = useCallback(
    (ticker: string, jobId: string) => {
      const key = `${ticker}:${jobId}`;
      if (trackedRef.current.has(key)) return;
      trackedRef.current.add(key);
      void (async () => {
        try {
          const job = await pollJob(jobId);
          if (job.state === "error") {
            updateOne(ticker, {
              state: "error",
              jobId,
              message: job.error ?? "job failed",
            });
          } else {
            updateOne(ticker, {
              state: "done",
              jobId,
              runId: job.runId,
              cost: job.actualCostUsd,
            });
          }
        } catch (e) {
          const msg =
            e instanceof AgentServerError
              ? `Agent server: ${e.message}`
              : e instanceof Error
                ? e.message
                : String(e);
          updateOne(ticker, { state: "error", jobId, message: msg });
        }
      })();
    },
    [updateOne],
  );

  // Resume polling on mount + when agent comes back online
  useEffect(() => {
    if (!agentReady) return;
    let cancelled = false;
    void (async () => {
      // 1. Re-attach to anything in localStorage
      for (const [ticker, st] of Object.entries(byTicker)) {
        if (st.state === "running") {
          // verify job still exists server-side
          try {
            const job = await fetchJob(st.jobId);
            if (cancelled) return;
            if (job.state === "running" || job.state === "queued") {
              trackJob(ticker, st.jobId);
            } else if (job.state === "done") {
              updateOne(ticker, {
                state: "done",
                jobId: st.jobId,
                runId: job.runId,
                cost: job.actualCostUsd,
              });
            } else if (job.state === "error") {
              updateOne(ticker, {
                state: "error",
                jobId: st.jobId,
                message: job.error ?? "job failed",
              });
            }
          } catch {
            // server restarted; job is gone — clear it
            updateOne(ticker, {
              state: "error",
              jobId: st.jobId,
              message:
                "Job was lost (agent server may have restarted). Try again.",
            });
          }
        }
      }
      // 2. Discover any in-flight server-side jobs we don't yet know about
      try {
        const inflight = await listJobs({
          state: "running",
          portfolioId,
        });
        if (cancelled) return;
        for (const job of inflight) {
          if (!job.ticker) continue;
          if (byTicker[job.ticker]?.state === "running") continue;
          updateOne(job.ticker, {
            state: "running",
            jobId: job.jobId,
            startedAt: job.createdAt ?? new Date().toISOString(),
          });
          trackJob(job.ticker, job.jobId);
        }
      } catch {
        /* listing failed; non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentReady, portfolioId]);

  const startTickerRun = useCallback(
    async (ticker: string, model: "haiku" | "sonnet" = "haiku") => {
      try {
        const start = await startRun({ ticker, model, portfolioId });
        const startedAt = new Date().toISOString();
        updateOne(ticker, {
          state: "running",
          jobId: start.jobId,
          startedAt,
          estimatedCostUsd: start.estimatedCostUsd,
        });
        trackJob(ticker, start.jobId);
        return { ok: true as const, jobId: start.jobId };
      } catch (e) {
        if (e instanceof AgentServerError && e.status === 401) {
          return { ok: false as const, status: 401 };
        }
        const msg =
          e instanceof AgentServerError
            ? `Agent server: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e);
        updateOne(ticker, { state: "error", jobId: null, message: msg });
        return { ok: false as const, status: 0 };
      }
    },
    [portfolioId, trackJob, updateOne],
  );

  const clearTickerStatus = useCallback(
    (ticker: string) => {
      setByTicker((prev) => {
        const { [ticker]: _omit, ...rest } = prev;
        void _omit;
        persistRunning(rest);
        return rest;
      });
    },
    [persistRunning],
  );

  return { byTicker, startTickerRun, clearTickerStatus };
}

"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_AGENT_SERVER_URL || "https://trade-agent.yeyaxin.com";

const PASSWORD_KEY = "yeyaxin.tradeAgentPassword.v1";

export type Health = {
  ok: boolean;
  version: string;
  monthSpentUsd: number;
  daySpentUsd: number;
  monthlyCapUsd: number;
  dailyCapUsd: number;
  anthropicConfigured: boolean;
};

export type StartResp = { jobId: string; estimatedCostUsd: number };

export type Job = {
  jobId: string;
  state: "queued" | "running" | "done" | "error";
  error: string | null;
  runId: string | null;
  decision: string | null;
  actualCostUsd: number | null;
};

export class AgentServerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const agentBaseUrl = DEFAULT_BASE_URL;

export function getPassword(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

export function setPassword(password: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (password) window.localStorage.setItem(PASSWORD_KEY, password);
    else window.localStorage.removeItem(PASSWORD_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

function authHeaders(): Record<string, string> {
  const p = getPassword();
  return p ? { Authorization: `Bearer ${p}` } : {};
}

export async function fetchHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    const r = await fetch(`${agentBaseUrl}/health`, { signal });
    if (!r.ok) return null;
    return (await r.json()) as Health;
  } catch {
    return null;
  }
}

export async function startRun(input: {
  ticker: string;
  asOfDate?: string;
  model?: "haiku" | "sonnet";
  depth?: number;
}): Promise<StartResp> {
  const r = await fetch(`${agentBaseUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      ticker: input.ticker,
      asOfDate: input.asOfDate,
      model: input.model ?? "haiku",
      depth: input.depth ?? 1,
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new AgentServerError(r.status, text || `agent-server ${r.status}`);
  }
  return (await r.json()) as StartResp;
}

export async function startSynth(input: {
  portfolioPath: string;
  model?: "haiku" | "sonnet";
}): Promise<StartResp> {
  const r = await fetch(`${agentBaseUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      portfolioPath: input.portfolioPath,
      model: input.model ?? "haiku",
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new AgentServerError(r.status, text || `agent-server ${r.status}`);
  }
  return (await r.json()) as StartResp;
}

export async function fetchJob(jobId: string, signal?: AbortSignal): Promise<Job> {
  const r = await fetch(`${agentBaseUrl}/jobs/${encodeURIComponent(jobId)}`, {
    signal,
    headers: { ...authHeaders() },
  });
  if (!r.ok) throw new AgentServerError(r.status, `job ${jobId}: ${r.status}`);
  return (await r.json()) as Job;
}

export async function pollJob(
  jobId: string,
  opts: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<Job> {
  const interval = opts.intervalMs ?? 2000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await fetchJob(jobId, opts.signal);
    if (job.state === "done" || job.state === "error") return job;
    await new Promise((r) => setTimeout(r, interval));
  }
}

export function useAgentHealth(): { health: Health | null; loading: boolean } {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    ctrlRef.current = new AbortController();
    let cancelled = false;
    const tick = async () => {
      const h = await fetchHealth(ctrlRef.current?.signal);
      if (cancelled) return;
      setHealth(h);
      setLoading(false);
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      ctrlRef.current?.abort();
    };
  }, []);

  return { health, loading };
}

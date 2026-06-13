"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_AGENT_SERVER_URL || "https://trade-agent.yeyaxin.com";

// Tab-scoped — evaporates when the tab closes. Friends share a password but
// each tab re-prompts on first need or on any 401.
const PASSWORD_KEY = "yeyaxin.tradeAgentPassword.v1";

// Bridge custom event for the global password modal. The `<PasswordPromptHost>`
// component listens; any code that needs a password dispatches this and awaits
// the resolver.
const REQUEST_PASSWORD_EVENT = "yeyaxin.requestPassword";

type RequestPasswordDetail = {
  reason: "missing" | "rejected";
  resolve: (password: string | null) => void;
};

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
  kind?: string | null;
  ticker?: string | null;
  portfolioId?: string | null;
  error: string | null;
  runId: string | null;
  decision: string | null;
  actualCostUsd: number | null;
  createdAt?: string | null;
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
    return window.sessionStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

export function setPassword(password: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (password) window.sessionStorage.setItem(PASSWORD_KEY, password);
    else window.sessionStorage.removeItem(PASSWORD_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

export function authHeaders(): Record<string, string> {
  const p = getPassword();
  return p ? { Authorization: `Bearer ${p}` } : {};
}

/**
 * Prompt the user for the password via the global modal. Returns the entered
 * value (saved to sessionStorage as a side effect) or null if they cancelled.
 *
 * The PasswordPromptHost component (mounted once at the layout root) listens
 * for the event and resolves the promise.
 */
export function requestPassword(
  reason: "missing" | "rejected" = "missing",
): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const detail: RequestPasswordDetail = { reason, resolve };
    window.dispatchEvent(new CustomEvent(REQUEST_PASSWORD_EVENT, { detail }));
  });
}

export const REQUEST_PASSWORD_EVENT_NAME = REQUEST_PASSWORD_EVENT;

/**
 * Run an authenticated fetch. If the server returns 401, clear the cached
 * password, prompt the user, and retry once with the new password. Throws
 * AgentServerError on non-OK responses (other than 401-then-retry).
 */
async function authedFetch(
  path: string,
  init: RequestInit & { skipPasswordPrompt?: boolean } = {},
): Promise<Response> {
  const { skipPasswordPrompt, ...rest } = init;
  const url = `${agentBaseUrl}${path}`;

  // First attempt — use whatever password is in sessionStorage.
  let r = await fetch(url, {
    ...rest,
    headers: { ...rest.headers, ...authHeaders() },
  });

  if (r.status !== 401 || skipPasswordPrompt) return r;

  // 401: clear stale token, ask user.
  setPassword(null);
  const fresh = await requestPassword("rejected");
  if (!fresh) {
    // User cancelled. Surface the original 401.
    return r;
  }

  // Retry with the new password.
  r = await fetch(url, {
    ...rest,
    headers: { ...rest.headers, ...authHeaders() },
  });
  return r;
}

async function maybeEnsurePassword(): Promise<boolean> {
  if (getPassword()) return true;
  const p = await requestPassword("missing");
  return Boolean(p);
}

export async function fetchHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    // /health is unauthenticated; no need to prompt.
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
  portfolioId?: string;
}): Promise<StartResp> {
  if (!(await maybeEnsurePassword())) {
    throw new AgentServerError(401, "no password");
  }
  const r = await authedFetch("/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticker: input.ticker,
      asOfDate: input.asOfDate,
      model: input.model ?? "haiku",
      depth: input.depth ?? 1,
      portfolioId: input.portfolioId,
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new AgentServerError(r.status, text || `agent-server ${r.status}`);
  }
  return (await r.json()) as StartResp;
}

export async function startSynth(input: {
  portfolio?: unknown;
  portfolioPath?: string;
  portfolioId?: string;
  model?: "haiku" | "sonnet";
}): Promise<StartResp> {
  if (!(await maybeEnsurePassword())) {
    throw new AgentServerError(401, "no password");
  }
  const r = await authedFetch("/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      portfolio: input.portfolio,
      portfolioPath: input.portfolioPath,
      portfolioId: input.portfolioId,
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
  const r = await authedFetch(`/jobs/${encodeURIComponent(jobId)}`, {
    signal,
    skipPasswordPrompt: true,
  });
  if (!r.ok) throw new AgentServerError(r.status, `job ${jobId}: ${r.status}`);
  return (await r.json()) as Job;
}

export async function listJobs(filter: {
  state?: "queued" | "running" | "done" | "error";
  portfolioId?: string;
}): Promise<Job[]> {
  const params = new URLSearchParams();
  if (filter.state) params.set("state", filter.state);
  if (filter.portfolioId) params.set("portfolioId", filter.portfolioId);
  const r = await authedFetch(`/jobs?${params}`, { skipPasswordPrompt: true });
  if (!r.ok) throw new AgentServerError(r.status, `list jobs: ${r.status}`);
  const data = (await r.json()) as { jobs: Job[] };
  return data.jobs;
}

// === Portfolios CRUD (the GET path is silent on 401 — empty list — to avoid
// repeatedly prompting on initial page load before user clicks anything) ===

export async function listPortfolios(): Promise<unknown[]> {
  if (!getPassword()) return [];
  const r = await authedFetch("/portfolios", { skipPasswordPrompt: true });
  if (r.status === 401) {
    setPassword(null);
    return [];
  }
  if (!r.ok) throw new AgentServerError(r.status, `list portfolios: ${r.status}`);
  const data = (await r.json()) as { portfolios: unknown[] };
  return data.portfolios ?? [];
}

export async function putPortfolio(
  slotId: string,
  body: unknown,
): Promise<unknown> {
  if (!(await maybeEnsurePassword())) {
    throw new AgentServerError(401, "no password");
  }
  const r = await authedFetch(`/portfolios/${slotId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new AgentServerError(r.status, msg || `put portfolio: ${r.status}`);
  }
  return r.json();
}

export async function deletePortfolio(slotId: string): Promise<void> {
  if (!(await maybeEnsurePassword())) {
    throw new AgentServerError(401, "no password");
  }
  const r = await authedFetch(`/portfolios/${slotId}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) {
    throw new AgentServerError(r.status, `delete portfolio: ${r.status}`);
  }
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

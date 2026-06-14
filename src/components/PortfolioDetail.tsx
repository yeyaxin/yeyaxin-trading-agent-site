"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  usePortfolios,
  computeWeights,
  PORTFOLIO_SLOT_IDS,
  MAX_POSITIONS_PER_PORTFOLIO,
  type PortfolioSlotId,
} from "@/lib/portfolio";
import { TickerSearch } from "@/components/TickerSearch";
import { DecisionBadge } from "@/components/DecisionBadge";
import { Disclaimer } from "@/components/Disclaimer";
import { Markdown } from "@/components/Markdown";
import {
  estimateRunCost,
  estimateSynthesisCost,
  formatUsd,
  MONTHLY_CAP_USD,
} from "@/lib/cost";
import { tickerToRunId } from "@/lib/runs";
import { useAgentHealth } from "@/lib/agentClient";
import {
  useJobTracker,
  SYNTHESIS_KEY,
  type TickerJobState,
} from "@/lib/job-tracker";
import {
  deriveTickerState,
  isStale as isStaleState,
  timeAgo,
  type TickerState,
} from "@/lib/ticker-state";
import type {
  Portfolio,
  PortfolioAction,
  PortfolioSynthesis,
  Position,
} from "@/lib/types";

const STALE_HOURS = 8;

export function PortfolioDetail({ id }: { id: string }) {
  if ((PORTFOLIO_SLOT_IDS as readonly string[]).includes(id)) {
    return <UserPortfolio slotId={id as PortfolioSlotId} />;
  }
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-muted">Unknown portfolio.</p>
      <Link href="/portfolio" className="text-accent underline">
        Back to portfolios
      </Link>
    </div>
  );
}

function UserPortfolio({ slotId }: { slotId: PortfolioSlotId }) {
  const portfolios = usePortfolios();
  const p = portfolios.get(slotId);

  if (!portfolios.hydrated) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 text-muted">Loading…</div>
    );
  }

  if (!p) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 space-y-4">
        <h1 className="text-2xl font-semibold">No portfolio in this slot</h1>
        <p className="text-muted">
          This portfolio slot ({slotId}) is empty. Create one from the index.
        </p>
        <Link
          href="/portfolio"
          className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-border hover:bg-slate-50"
        >
          ← Portfolios
        </Link>
      </div>
    );
  }

  return (
    <PortfolioView
      portfolio={p}
      synthesis={null}
      onAddPosition={async (pos) =>
        await portfolios.upsertPosition(slotId, pos)
      }
      onRemovePosition={async (ticker) => {
        await portfolios.removePosition(slotId, ticker);
      }}
      onSetCash={async (c) => {
        await portfolios.setCash(slotId, c);
      }}
      onRename={async (n) => {
        await portfolios.rename(slotId, n);
      }}
      onDelete={async () => {
        await portfolios.remove(slotId);
      }}
    />
  );
}

type ViewProps = {
  portfolio: Portfolio;
  synthesis: PortfolioSynthesis | null;
  readOnly?: boolean;
  onAddPosition?: (pos: Position) => Promise<string | null>;
  onRemovePosition?: (ticker: string) => Promise<void>;
  onSetCash?: (cashUsd: number) => Promise<void>;
  onRename?: (name: string) => Promise<void>;
  onDelete?: () => Promise<void>;
};

function PortfolioView({
  portfolio,
  synthesis,
  readOnly,
  onAddPosition,
  onRemovePosition,
  onSetCash,
  onRename,
  onDelete,
}: ViewProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { health } = useAgentHealth();
  const weights = useMemo(() => computeWeights(portfolio), [portfolio]);
  const refreshModel = "claude-haiku-4-5";
  const monthSpent = health?.monthSpentUsd ?? 0;
  const monthlyCap = health?.monthlyCapUsd ?? MONTHLY_CAP_USD;
  const agentReady = Boolean(health?.ok && health?.anthropicConfigured);

  const { byTicker, startTickerRun, startSynthesisRun, clearTickerStatus } =
    useJobTracker(portfolio.id, agentReady);

  // Server-side authoritative state, with optimistic-from-this-tab overlay.
  const tickerStates = useMemo(() => {
    const out: Record<string, TickerState> = {};
    for (const p of portfolio.positions) {
      const base = deriveTickerState(p);
      const optimistic = byTicker[p.ticker];
      out[p.ticker] =
        optimistic?.state === "running"
          ? {
              lifecycle: "running",
              lastAnalyzedAt: base.lastAnalyzedAt,
              lastRunId: base.lastRunId,
              jobId: optimistic.jobId,
              errorMessage: null,
            }
          : base;
    }
    return out;
  }, [portfolio.positions, byTicker]);

  const lifecycles = Object.values(tickerStates).map((s) => s.lifecycle);
  const anyTickerRunning = lifecycles.includes("running");
  const anyTickerNotReady = lifecycles.some((l) => l !== "ready");
  const stalePositions = portfolio.positions.filter((p) =>
    isStaleState(tickerStates[p.ticker]) || tickerStates[p.ticker].lifecycle === "never-analyzed",
  );

  const refreshAllCost = stalePositions.length * estimateRunCost(refreshModel);
  const overCap = monthSpent + refreshAllCost > monthlyCap;

  // agentClient handles password prompts and 401 retries via the global
  // PasswordPromptHost. These callbacks just call through.
  async function runOne(ticker: string): Promise<void> {
    if (!agentReady) return;
    await startTickerRun(ticker, "haiku");
  }

  async function refreshAllStale(): Promise<void> {
    for (const p of stalePositions) {
      await runOne(p.ticker);
      const st = byTicker[p.ticker];
      if (st && st.state === "error") return;
    }
  }

  async function synthesizeNow(): Promise<void> {
    if (!agentReady) return;
    if (portfolio.positions.length === 0) return;
    await startSynthesisRun(portfolio, "haiku");
  }

  // Aggregate banner state from all tickers
  const anyRunning = Object.values(byTicker).some((s) => s.state === "running");
  const lastError = Object.entries(byTicker).find(
    ([, s]) => s.state === "error",
  );
  const lastDone = Object.entries(byTicker).find(([, s]) => s.state === "done");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <Header
        portfolio={portfolio}
        readOnly={readOnly}
        onRename={onRename}
        onDelete={() => {
          if (confirmingDelete) {
            onDelete?.();
          } else {
            setConfirmingDelete(true);
            setTimeout(() => setConfirmingDelete(false), 4000);
          }
        }}
        confirmingDelete={confirmingDelete}
      />

      <Disclaimer />

      <AgentStatusBanner
        agentReady={agentReady}
        anyRunning={anyRunning}
        runningTickers={Object.entries(byTicker)
          .filter(([, s]) => s.state === "running")
          .map(([t]) => t)}
        errorMessage={lastError ? (lastError[1] as Extract<TickerJobState, { state: "error" }>).message : null}
        doneTicker={lastDone ? lastDone[0] : null}
        doneCost={
          lastDone
            ? (lastDone[1] as Extract<TickerJobState, { state: "done" }>).cost ?? null
            : null
        }
        onDismissError={() => {
          if (lastError) clearTickerStatus(lastError[0]);
        }}
        onDismissDone={() => {
          if (lastDone) clearTickerStatus(lastDone[0]);
        }}
      />

      {!readOnly ? (
        <SynthesizeActionPanel
          portfolio={portfolio}
          synthesis={synthesis}
          synthState={byTicker[SYNTHESIS_KEY]}
          monthSpent={monthSpent}
          monthlyCap={monthlyCap}
          agentReady={agentReady}
          anyTickerRunning={anyTickerRunning}
          anyTickerNotReady={anyTickerNotReady}
          tickerStates={tickerStates}
          onSynthesize={synthesizeNow}
          onDismiss={() => clearTickerStatus(SYNTHESIS_KEY)}
        />
      ) : null}

      <SummaryStrip
        weights={weights}
        cashUsd={portfolio.cashUsd}
        positionCount={portfolio.positions.length}
        synthesizedAt={synthesis?.createdAt}
      />

      {!readOnly ? (
        <CashCard
          cashUsd={portfolio.cashUsd}
          onSave={onSetCash}
        />
      ) : null}

      {synthesis ? <SynthesisPanels synthesis={synthesis} /> : null}

      <PositionsTable
        portfolio={portfolio}
        weights={weights}
        synthesis={synthesis}
        readOnly={readOnly}
        onRemovePosition={onRemovePosition}
        refreshModel={refreshModel}
        agentReady={agentReady}
        runOne={runOne}
        byTicker={byTicker}
      />

      {!readOnly && stalePositions.length > 0 ? (
        <ForceRefresh
          stale={stalePositions.length}
          totalCost={refreshAllCost}
          monthSpent={monthSpent}
          monthlyCap={monthlyCap}
          overCap={overCap}
          agentReady={agentReady}
          onRefreshAll={refreshAllStale}
          anyTickerRunning={anyTickerRunning}
        />
      ) : null}

      {!readOnly ? (
        <AddPosition
          portfolio={portfolio}
          onAddPosition={onAddPosition}
        />
      ) : null}
    </div>
  );
}

function Header({
  portfolio,
  readOnly,
  onRename,
  onDelete,
  confirmingDelete,
}: {
  portfolio: Portfolio;
  readOnly?: boolean;
  onRename?: (n: string) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  confirmingDelete?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(portfolio.name);

  return (
    <header className="flex items-start justify-between gap-4 flex-wrap">
      <div className="space-y-1">
        {editing && !readOnly ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded-md border border-border px-2 py-1 text-2xl font-semibold"
            />
            <button
              onClick={() => {
                onRename?.(draft);
                setEditing(false);
              }}
              className="text-sm text-accent hover:underline"
            >
              Save
            </button>
          </div>
        ) : (
          <h1
            className={`text-3xl font-semibold tracking-tight ${
              readOnly ? "" : "cursor-pointer hover:opacity-70"
            }`}
            onClick={() => !readOnly && setEditing(true)}
            title={readOnly ? "" : "Click to rename"}
          >
            {portfolio.name}
          </h1>
        )}
        <p className="text-xs font-mono text-muted">
          updated {new Date(portfolio.updatedAt).toLocaleString()}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/portfolio"
          className="text-sm text-muted hover:text-foreground"
        >
          ← All portfolios
        </Link>
        {!readOnly ? (
          <button
            onClick={onDelete}
            className={`text-sm px-3 py-1 rounded-md border ${
              confirmingDelete
                ? "border-sell text-sell hover:bg-sell/5"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {confirmingDelete ? "Click again to delete" : "Delete portfolio"}
          </button>
        ) : null}
      </div>
    </header>
  );
}

function SummaryStrip({
  weights,
  cashUsd,
  positionCount,
  synthesizedAt,
}: {
  weights: ReturnType<typeof computeWeights>;
  cashUsd: number;
  positionCount: number;
  synthesizedAt?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-4 rounded-xl border border-border bg-white p-5">
      <Stat label="NAV" value={`$${weights.totalNav.toLocaleString()}`} mono />
      <Stat label="Positions" value={`${positionCount} / ${MAX_POSITIONS_PER_PORTFOLIO}`} mono />
      <Stat label="Cash" value={`$${cashUsd.toLocaleString()} (${weights.cashWeight.toFixed(1)}%)`} mono />
      <Stat
        label="Last synthesized"
        value={synthesizedAt ? new Date(synthesizedAt).toLocaleString() : "—"}
        mono
      />
    </div>
  );
}

function SynthesisPanels({ synthesis }: { synthesis: PortfolioSynthesis }) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-xl border border-border bg-white p-5 lg:col-span-2 space-y-3">
        <h2 className="text-sm uppercase tracking-wider font-medium text-muted">
          Book commentary
        </h2>
        <Markdown>{synthesis.bookCommentary}</Markdown>
        <p className="text-xs text-muted font-mono">
          synth {formatUsd(synthesis.usage.costUsd)} ·{" "}
          {new Date(synthesis.createdAt).toLocaleString()}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-white p-5 space-y-3">
        <h2 className="text-sm uppercase tracking-wider font-medium text-muted">
          Factor exposure
        </h2>
        <ul className="space-y-2">
          {synthesis.factorExposure.map((f) => (
            <li key={f.label}>
              <div className="flex items-baseline justify-between text-sm">
                <span>{f.label}</span>
                <span className="font-mono">{f.weightPct.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 mt-1 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, f.weightPct)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted mt-4">
            Top risks
          </h3>
          <ul className="mt-2 space-y-1 text-sm">
            {synthesis.topRisks.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function CashCard({
  cashUsd,
  onSave,
}: {
  cashUsd: number;
  onSave?: (cashUsd: number) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(String(cashUsd));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync external updates (e.g., from another tab) into the input.
  useEffect(() => {
    setDraft(String(cashUsd));
  }, [cashUsd]);

  const dirty = draft.trim() !== String(cashUsd);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter a non-negative number");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave?.(n);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-white p-5">
      <form onSubmit={save} className="space-y-2">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="block flex-1 min-w-[200px] space-y-1">
            <span className="text-sm font-medium">Cash on hand (USD)</span>
            <span className="block text-xs text-muted">
              Un-invested cash you have available in this account. Counts toward
              NAV and weights.
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full font-mono rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!dirty || saving}
            className="h-10 px-4 rounded-md border border-accent text-accent text-sm font-medium hover:bg-accent hover:text-accent-fg disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
        {error ? <p className="text-sm text-sell">{error}</p> : null}
      </form>
    </section>
  );
}

function SynthesizeActionPanel({
  portfolio,
  synthesis,
  synthState,
  monthSpent,
  monthlyCap,
  agentReady,
  anyTickerRunning,
  anyTickerNotReady,
  tickerStates,
  onSynthesize,
  onDismiss,
}: {
  portfolio: Portfolio;
  synthesis: PortfolioSynthesis | null;
  synthState: TickerJobState | undefined;
  monthSpent: number;
  monthlyCap: number;
  agentReady: boolean;
  anyTickerRunning: boolean;
  anyTickerNotReady: boolean;
  tickerStates: Record<string, TickerState>;
  onSynthesize: () => void;
  onDismiss: () => void;
}) {
  const cost = estimateSynthesisCost("claude-haiku-4-5");
  const overCap = monthSpent + cost > monthlyCap;
  const noPositions = portfolio.positions.length === 0;
  const isRunning = synthState?.state === "running";
  const isDone = synthState?.state === "done";
  const isError = synthState?.state === "error";

  // Tickers that aren't ready, with their state — used in the disabled tooltip.
  const blockingTickers: { ticker: string; lifecycle: string }[] = [];
  for (const [t, st] of Object.entries(tickerStates)) {
    if (st.lifecycle !== "ready") {
      blockingTickers.push({ ticker: t, lifecycle: st.lifecycle });
    }
  }

  let buttonLabel: string;
  let buttonTitle = "";
  let disabled = false;
  if (!agentReady) {
    buttonLabel = "Agent server offline";
    disabled = true;
  } else if (noPositions) {
    buttonLabel = "Add a position first";
    disabled = true;
  } else if (overCap) {
    buttonLabel = "Over monthly cap";
    disabled = true;
  } else if (isRunning) {
    buttonLabel = "Synthesizing…";
    disabled = true;
  } else if (anyTickerNotReady) {
    buttonLabel = "Analyze all tickers first";
    disabled = true;
    const summary = blockingTickers
      .map((b) => `${b.ticker} (${b.lifecycle})`)
      .join(", ");
    buttonTitle =
      `Synthesis requires every position to have a completed analysis. ` +
      `Blocking: ${summary}.`;
  } else {
    buttonLabel = synthesis
      ? `Re-synthesize · est. ${formatUsd(cost)}`
      : `Synthesize portfolio · est. ${formatUsd(cost)}`;
  }

  return (
    <section className="rounded-xl border-2 border-accent/30 bg-accent/5 p-6 space-y-4">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-xl font-semibold tracking-tight">
            Portfolio synthesis
          </h2>
          <p className="text-sm text-muted mt-1.5">
            Reads the latest analysis for each position and produces
            book-level commentary, factor exposure, and sizing-aware actions
            (BUY MORE / HOLD / TRIM / EXIT). Re-analyze positions first if
            any are stale.
          </p>
        </div>
        <button
          type="button"
          onClick={onSynthesize}
          disabled={disabled}
          title={buttonTitle}
          className="h-12 px-6 rounded-lg bg-accent text-accent-fg text-base font-semibold shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {buttonLabel}
        </button>
      </div>

      {isRunning ? (
        <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse"
            aria-hidden
          />
          Running synthesis · safe to navigate away
        </div>
      ) : null}

      {isDone ? (
        <div className="rounded-md border border-buy/30 bg-buy/5 px-3 py-2 text-sm flex items-center justify-between gap-3">
          <span>
            Synthesis done. Site rebuild in flight — reload in ~2 min to see
            updated commentary.
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}

      {isError ? (
        <div className="rounded-md border border-sell/30 bg-sell/5 px-3 py-2 text-sm text-sell flex items-center justify-between gap-3">
          <span>
            {(synthState as Extract<TickerJobState, { state: "error" }>).message}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PositionsTable({
  portfolio,
  weights,
  synthesis,
  readOnly,
  onRemovePosition,
  refreshModel,
  agentReady,
  runOne,
  byTicker,
}: {
  portfolio: Portfolio;
  weights: ReturnType<typeof computeWeights>;
  synthesis: PortfolioSynthesis | null;
  readOnly?: boolean;
  onRemovePosition?: (ticker: string) => Promise<void> | void;
  refreshModel: string;
  agentReady: boolean;
  runOne: (ticker: string) => Promise<void>;
  byTicker: Record<string, TickerJobState>;
}) {
  if (portfolio.positions.length === 0) return null;
  const decisionByTicker = new Map(
    (synthesis?.decisions ?? []).map((d) => [d.ticker, d]),
  );

  return (
    <section className="rounded-xl border border-border bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-muted">
          <tr>
            <Th>Ticker</Th>
            <Th align="right">Shares</Th>
            <Th align="right">Avg cost</Th>
            <Th align="right">Last px</Th>
            <Th align="right">Mkt value</Th>
            <Th align="right">Weight</Th>
            <Th>Action</Th>
            <Th>Last analyzed</Th>
            <Th>{!readOnly ? "" : null}</Th>
          </tr>
        </thead>
        <tbody>
          {portfolio.positions.map((p) => {
            const w = weights.positionWeights.find((x) => x.ticker === p.ticker);
            const d = decisionByTicker.get(p.ticker);
            // Authoritative ticker state from server-persisted Position.
            // The job-tracker (in-memory, this tab only) is layered on top
            // for instant feedback after a click; until the server confirms,
            // we trust whichever says "running".
            const baseState = deriveTickerState(p);
            const optimistic = byTicker[p.ticker];
            const state: TickerState =
              optimistic?.state === "running"
                ? {
                    lifecycle: "running",
                    lastAnalyzedAt: baseState.lastAnalyzedAt,
                    lastRunId: baseState.lastRunId,
                    jobId: optimistic.jobId,
                    errorMessage: null,
                  }
                : baseState;
            const stale = isStaleState(state);
            // Prefer the position's own lastRunId; fall back to the synthesis
            // decision's perTickerRunId (legacy demo path) or the bundled fixtures.
            const runId =
              state.lastRunId ?? d?.perTickerRunId ?? tickerToRunId[p.ticker];
            return (
              <tr
                key={p.ticker}
                className="border-t border-border hover:bg-slate-50/40"
              >
                <Td>
                  <span className="font-mono font-semibold">{p.ticker}</span>
                </Td>
                <Td align="right" mono>
                  {p.shares}
                </Td>
                <Td align="right" mono>
                  {p.avgCost ? `$${p.avgCost.toFixed(2)}` : "—"}
                </Td>
                <Td align="right" mono>
                  {p.lastPrice ? `$${p.lastPrice.toFixed(2)}` : "—"}
                </Td>
                <Td align="right" mono>
                  ${(w?.marketValue ?? 0).toLocaleString()}
                </Td>
                <Td align="right" mono>
                  {(w?.weightPct ?? 0).toFixed(1)}%
                </Td>
                <Td>
                  {d ? <PortfolioActionBadge action={d.action} /> : <span className="text-muted">—</span>}
                </Td>
                <Td mono>
                  {state.lifecycle === "running" ? (
                    <span className="text-accent">running…</span>
                  ) : state.lifecycle === "ready" ? (
                    <span className={stale ? "text-hold" : ""}>
                      {timeAgo(state.lastAnalyzedAt)}
                      {stale ? " (stale)" : ""}
                    </span>
                  ) : state.lifecycle === "error" ? (
                    <span
                      className="text-sell"
                      title={state.errorMessage ?? "error"}
                    >
                      error
                    </span>
                  ) : (
                    <span className="text-muted">never</span>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-2">
                    {runId && state.lifecycle !== "never-analyzed" ? (
                      <Link
                        href={`/runs/${runId}`}
                        className="text-xs text-accent hover:underline"
                      >
                        View
                      </Link>
                    ) : null}
                    <RowAnalyzeButton
                      ticker={p.ticker}
                      state={state}
                      agentReady={agentReady}
                      refreshModel={refreshModel}
                      onClick={() => runOne(p.ticker)}
                    />
                    {!readOnly && onRemovePosition ? (
                      <button
                        type="button"
                        onClick={() => onRemovePosition(p.ticker)}
                        className="text-xs text-muted hover:text-sell"
                        title="Remove position"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ForceRefresh({
  stale,
  totalCost,
  monthSpent,
  monthlyCap,
  overCap,
  agentReady,
  onRefreshAll,
  anyTickerRunning,
}: {
  stale: number;
  totalCost: number;
  monthSpent: number;
  monthlyCap: number;
  overCap: boolean;
  agentReady: boolean;
  onRefreshAll: () => Promise<void>;
  anyTickerRunning: boolean;
}) {
  const blocked = overCap || !agentReady || anyTickerRunning;
  const reason = !agentReady
    ? "Agent server offline"
    : overCap
      ? "Over monthly cap"
      : anyTickerRunning
        ? "A ticker is already running"
        : null;
  const blockedTitle = anyTickerRunning
    ? "Another ticker is currently being analyzed. Force refresh runs every stale ticker through the same pipeline; wait for the in-flight one to finish first."
    : "";
  return (
    <section className="rounded-xl border border-border bg-white p-5 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h2 className="font-medium">Force refresh stale positions</h2>
        <p className="text-sm text-muted">
          {stale} position{stale === 1 ? "" : "s"} need analysis (never
          analyzed or older than {STALE_HOURS}h). Each one runs through the
          same TradingAgents pipeline as the per-row Re-analyze button.
          Refresh would cost approximately{" "}
          <span className="font-mono">{formatUsd(totalCost)}</span> on Haiku.
        </p>
        <p className="text-xs font-mono text-muted mt-1">
          month: {formatUsd(monthSpent)} / {formatUsd(monthlyCap)} cap
        </p>
      </div>
      <button
        type="button"
        disabled={blocked}
        title={blockedTitle}
        onClick={() => {
          void onRefreshAll();
        }}
        className="h-11 px-5 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {reason ?? `Force refresh · ${formatUsd(totalCost)}`}
      </button>
    </section>
  );
}

function AgentStatusBanner({
  agentReady,
  anyRunning,
  runningTickers,
  errorMessage,
  doneTicker,
  doneCost,
  onDismissError,
  onDismissDone,
}: {
  agentReady: boolean;
  anyRunning: boolean;
  runningTickers: string[];
  errorMessage: string | null;
  doneTicker: string | null;
  doneCost: number | null;
  onDismissError: () => void;
  onDismissDone: () => void;
}) {
  if (!agentReady) {
    return (
      <div className="rounded-lg border border-border bg-slate-50 px-4 py-2 text-xs text-muted">
        Agent server unreachable. Re-analyze and force-refresh are disabled.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {anyRunning ? (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-2 text-sm flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" aria-hidden />
          Running {runningTickers.length === 1 ? runningTickers[0] : `${runningTickers.length} tickers`}
          {runningTickers.length > 1 ? ` (${runningTickers.join(", ")})` : null} ·
          {" "}stays running if you navigate away
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-lg border border-sell/30 bg-sell/5 px-4 py-2 text-sm text-sell flex items-center justify-between gap-3">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="text-xs text-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      {doneTicker && !anyRunning ? (
        <div className="rounded-lg border border-buy/30 bg-buy/5 px-4 py-2 text-sm flex items-center justify-between gap-3">
          <span>
            {doneTicker} re-analyzed
            {doneCost !== null ? ` · cost ${formatUsd(doneCost)}` : null}.
            Reload the page or click again to pick up the new run.
          </span>
          <button
            type="button"
            onClick={onDismissDone}
            className="text-xs text-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RowAnalyzeButton({
  ticker,
  state,
  agentReady,
  refreshModel,
  onClick,
}: {
  ticker: string;
  state: TickerState;
  agentReady: boolean;
  refreshModel: string;
  onClick: () => void;
}) {
  const cost = formatUsd(estimateRunCost(refreshModel));

  let label: string;
  let title: string;
  let style: string;
  let disabled = false;

  if (!agentReady) {
    label = "Analyze";
    title = "Agent server offline";
    style = "border-border";
    disabled = true;
  } else if (state.lifecycle === "running") {
    label = "Running…";
    title = "Agent run in progress · safe to navigate away";
    style = "border-accent/40 bg-accent/5 text-accent cursor-not-allowed";
    disabled = true;
  } else if (state.lifecycle === "error") {
    label = "Retry";
    title = `Last run failed: ${state.errorMessage ?? "unknown error"}. Click to try again (~${cost}).`;
    style = "border-sell/40 bg-sell/5 text-sell hover:bg-sell/10";
  } else if (state.lifecycle === "ready") {
    label = "Re-analyze";
    title = `Last analyzed ${timeAgo(state.lastAnalyzedAt)}. Re-analyze ${ticker} (~${cost}).`;
    style = "border-border hover:bg-slate-50";
  } else {
    // never-analyzed
    label = "Analyze";
    title = `${ticker} has never been analyzed. Click to run the agent panel (~${cost}).`;
    style = "border-accent/60 bg-accent/5 text-accent hover:bg-accent/10";
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`text-xs px-2 py-1 rounded-md border ${style} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}

function AddPosition({
  portfolio,
  onAddPosition,
}: {
  portfolio: Portfolio;
  onAddPosition?: (pos: Position) => Promise<string | null> | string | null;
}) {
  const [pendingTicker, setPendingTicker] = useState<{
    symbol: string;
    description: string;
    quotePrice: number | null;
  } | null>(null);
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingTicker) {
      setError("Pick a ticker first");
      return;
    }
    const sharesNum = Number(shares);
    if (!Number.isFinite(sharesNum) || sharesNum <= 0) {
      setError("Enter a positive share count");
      return;
    }

    let costNum: number | undefined;
    if (avgCost.trim()) {
      const parsed = Number(avgCost);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError("Avg cost must be a positive number, or leave blank");
        return;
      }
      costNum = parsed;
    } else if (pendingTicker.quotePrice && pendingTicker.quotePrice > 0) {
      // Fallback: use the live market price captured when the ticker was picked.
      costNum = pendingTicker.quotePrice;
    } else {
      setError(
        "Avg cost is blank and we couldn't fetch a market price. Enter a value manually.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const err = await onAddPosition?.({
        ticker: pendingTicker.symbol,
        shares: sharesNum,
        avgCost: costNum,
      });
      if (err) {
        setError(err);
        return;
      }
      setPendingTicker(null);
      setShares("");
      setAvgCost("");
    } finally {
      setSubmitting(false);
    }
  }

  const willUseLivePrice =
    pendingTicker !== null &&
    pendingTicker.quotePrice !== null &&
    avgCost.trim().length === 0;

  return (
    <section className="rounded-xl border border-border bg-white p-5 space-y-4">
      <h2 className="font-medium">Manage positions</h2>
      <p className="text-sm text-muted">
        Search a ticker and tell the agent how many shares you own and what
        you paid. The avg cost lets later analyses compute unrealized P&amp;L.
        {portfolio.positions.length === 0
          ? " Add at least one position to enable Synthesize portfolio above."
          : null}
      </p>

      <form onSubmit={add} className="space-y-3">
        {!pendingTicker ? (
          <TickerSearch
            onSelect={(hit, quote) =>
              setPendingTicker({
                symbol: hit.symbol,
                description: hit.description,
                quotePrice: quote?.price ?? null,
              })
            }
          />
        ) : (
          <div className="flex items-center justify-between rounded-md border border-border bg-slate-50 px-3 py-2">
            <span className="flex items-center gap-3 min-w-0">
              <span className="font-mono font-semibold">
                {pendingTicker.symbol}
              </span>
              <span className="text-muted truncate">
                {pendingTicker.description}
              </span>
              {pendingTicker.quotePrice !== null ? (
                <span className="font-mono text-sm text-muted flex-shrink-0">
                  ${pendingTicker.quotePrice.toFixed(2)} live
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setPendingTicker(null)}
              className="text-sm text-muted hover:text-foreground"
            >
              Change
            </button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Shares</span>
            <input
              type="number"
              step="any"
              min="0"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="0"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Avg cost (optional)</span>
            <input
              type="number"
              step="any"
              min="0"
              value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder={
                pendingTicker?.quotePrice
                  ? `default: $${pendingTicker.quotePrice.toFixed(2)}`
                  : "—"
              }
            />
            {willUseLivePrice ? (
              <span className="block text-xs text-hold">
                Leaving this blank will record the current market price ($
                {pendingTicker!.quotePrice!.toFixed(2)}) as your avg cost.
              </span>
            ) : null}
          </label>
        </div>

        {error ? <p className="text-sm text-sell">{error}</p> : null}

        <button
          type="submit"
          disabled={!pendingTicker || submitting}
          className="w-full h-11 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting
            ? "Saving…"
            : pendingTicker
              ? `Add ${pendingTicker.symbol}`
              : "Pick a ticker to add"}
        </button>
      </form>
    </section>
  );
}

function PortfolioActionBadge({ action }: { action: PortfolioAction }) {
  const label =
    action === "BUY_MORE"
      ? "BUY MORE"
      : action === "TRIM"
        ? "TRIM"
        : action === "EXIT"
          ? "EXIT"
          : "HOLD";
  const cls =
    action === "BUY_MORE"
      ? "bg-buy/10 text-buy ring-buy/30"
      : action === "EXIT" || action === "TRIM"
        ? "bg-sell/10 text-sell ring-sell/30"
        : "bg-hold/10 text-hold ring-hold/30";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md ring-1 ring-inset font-mono font-semibold text-xs ${cls}`}
    >
      {label}
    </span>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-2 text-xs uppercase tracking-wider font-medium ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </td>
  );
}



"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  usePortfolios,
  computeWeights,
  PORTFOLIO_SLOT_IDS,
  DEMO_PORTFOLIO_ID,
  MAX_POSITIONS_PER_PORTFOLIO,
  type PortfolioSlotId,
} from "@/lib/portfolio";
import { DEMO_PORTFOLIO, DEMO_SYNTHESIS } from "@/lib/synthesis";
import { TickerSearch } from "@/components/TickerSearch";
import { DecisionBadge } from "@/components/DecisionBadge";
import { Disclaimer } from "@/components/Disclaimer";
import { Markdown } from "@/components/Markdown";
import { PasswordPrompt } from "@/components/PasswordGate";
import { estimateRunCost, formatUsd, MONTHLY_CAP_USD } from "@/lib/cost";
import { tickerToRunId } from "@/lib/runs";
import {
  startRun,
  pollJob,
  useAgentHealth,
  AgentServerError,
  getPassword,
} from "@/lib/agentClient";
import type {
  Portfolio,
  PortfolioAction,
  PortfolioSynthesis,
  Position,
} from "@/lib/types";

const STALE_HOURS = 8;

type JobStatus =
  | { state: "idle" }
  | { state: "running"; ticker: string; jobId: string; estimated: number }
  | { state: "done"; ticker: string; cost: number; runId: string }
  | { state: "error"; message: string };

export function PortfolioDetail({ id }: { id: string }) {
  if (id === DEMO_PORTFOLIO_ID) {
    return <DemoPortfolio />;
  }
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

function DemoPortfolio() {
  return (
    <PortfolioView
      portfolio={DEMO_PORTFOLIO}
      synthesis={DEMO_SYNTHESIS}
      readOnly
    />
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
      onAddPosition={(pos) => portfolios.upsertPosition(slotId, pos)}
      onRemovePosition={(ticker) => portfolios.removePosition(slotId, ticker)}
      onSetCash={(c) => portfolios.setCash(slotId, c)}
      onRename={(n) => portfolios.rename(slotId, n)}
      onDelete={() => portfolios.remove(slotId)}
    />
  );
}

type ViewProps = {
  portfolio: Portfolio;
  synthesis: PortfolioSynthesis | null;
  readOnly?: boolean;
  onAddPosition?: (pos: Position) => string | null;
  onRemovePosition?: (ticker: string) => void;
  onSetCash?: (cashUsd: number) => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
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
  const [jobStatus, setJobStatus] = useState<JobStatus>({ state: "idle" });
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);
  const { health } = useAgentHealth();
  const weights = useMemo(() => computeWeights(portfolio), [portfolio]);
  const stalePositions = portfolio.positions.filter((p) =>
    isStale(synthesis, p.ticker),
  );

  const refreshModel = "claude-haiku-4-5";
  const refreshAllCost = stalePositions.length * estimateRunCost(refreshModel);
  const monthSpent = health?.monthSpentUsd ?? 0;
  const monthlyCap = health?.monthlyCapUsd ?? MONTHLY_CAP_USD;
  const overCap = monthSpent + refreshAllCost > monthlyCap;
  const agentReady = Boolean(health?.ok && health?.anthropicConfigured);

  function ensurePassword(then: () => void): boolean {
    if (getPassword()) return true;
    setPendingAction(() => then);
    return false;
  }

  async function runOne(ticker: string): Promise<JobStatus> {
    if (!agentReady) {
      const status: JobStatus = {
        state: "error",
        message:
          "Agent server not reachable. Try again in a moment, or check the trade-agent service status.",
      };
      setJobStatus(status);
      return status;
    }
    if (!ensurePassword(() => void runOne(ticker))) {
      return { state: "idle" };
    }
    let status: JobStatus;
    try {
      const start = await startRun({ ticker, model: "haiku", depth: 1 });
      setJobStatus({
        state: "running",
        ticker,
        jobId: start.jobId,
        estimated: start.estimatedCostUsd,
      });
      const job = await pollJob(start.jobId);
      if (job.state === "error") {
        status = {
          state: "error",
          message: job.error ?? `Job ${start.jobId} failed`,
        };
      } else {
        status = {
          state: "done",
          ticker,
          cost: job.actualCostUsd ?? 0,
          runId: job.runId ?? "",
        };
      }
    } catch (e) {
      if (e instanceof AgentServerError && e.status === 401) {
        // Bad / missing password; clear and re-prompt.
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("yeyaxin.tradeAgentPassword.v1");
        }
        setPendingAction(() => () => void runOne(ticker));
        status = {
          state: "error",
          message: "Wrong password. Try again.",
        };
      } else {
        const msg =
          e instanceof AgentServerError
            ? `Agent server: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e);
        status = { state: "error", message: msg };
      }
    }
    setJobStatus(status);
    return status;
  }

  async function refreshAllStale(): Promise<void> {
    if (!ensurePassword(() => void refreshAllStale())) return;
    for (const p of stalePositions) {
      const result = await runOne(p.ticker);
      if (result.state === "error") return;
    }
  }

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

      <PasswordPrompt
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onSubmit={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) action();
        }}
      />

      <AgentStatusBanner agentReady={agentReady} jobStatus={jobStatus} />

      <SummaryStrip
        weights={weights}
        cashUsd={portfolio.cashUsd}
        positionCount={portfolio.positions.length}
        synthesizedAt={synthesis?.createdAt}
      />

      {synthesis ? (
        <SynthesisPanels synthesis={synthesis} />
      ) : (
        <EmptySynthesis hasPositions={portfolio.positions.length > 0} />
      )}

      <PositionsTable
        portfolio={portfolio}
        weights={weights}
        synthesis={synthesis}
        readOnly={readOnly}
        onRemovePosition={onRemovePosition}
        refreshModel={refreshModel}
        agentReady={agentReady}
        runOne={runOne}
        runningTicker={
          jobStatus.state === "running" ? jobStatus.ticker : null
        }
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
          running={jobStatus.state === "running"}
        />
      ) : null}

      {!readOnly ? (
        <AddPosition
          portfolio={portfolio}
          onAddPosition={onAddPosition}
          onSetCash={onSetCash}
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
  onRename?: (n: string) => void;
  onDelete?: () => void;
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

function EmptySynthesis({ hasPositions }: { hasPositions: boolean }) {
  return (
    <section className="rounded-xl border border-dashed border-border p-6 text-center">
      {hasPositions ? (
        <>
          <h2 className="font-medium">Synthesis not available yet</h2>
          <p className="text-sm text-muted mt-1">
            Phase 1 ships with one baked synthesis (the Demo Book). Live synthesis
            for user portfolios lands in Phase 2 once the Python wrapper is wired
            up.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-medium">Add positions to get started</h2>
          <p className="text-sm text-muted mt-1">
            Search a ticker below and enter share count. Synthesis runs once
            you have at least one position.
          </p>
        </>
      )}
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
  runningTicker,
}: {
  portfolio: Portfolio;
  weights: ReturnType<typeof computeWeights>;
  synthesis: PortfolioSynthesis | null;
  readOnly?: boolean;
  onRemovePosition?: (ticker: string) => void;
  refreshModel: string;
  agentReady: boolean;
  runOne: (ticker: string) => Promise<JobStatus>;
  runningTicker: string | null;
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
            const stale = isStale(synthesis, p.ticker);
            const runId = d?.perTickerRunId ?? tickerToRunId[p.ticker];
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
                  {d?.lastAnalyzedAt ? (
                    <span className={stale ? "text-hold" : ""}>
                      {timeAgo(d.lastAnalyzedAt)}
                      {stale ? " (stale)" : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-2">
                    {runId ? (
                      <Link
                        href={`/runs/${runId}`}
                        className="text-xs text-accent hover:underline"
                      >
                        View
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      title={
                        agentReady
                          ? `Re-analyze ${p.ticker} · est. ${formatUsd(estimateRunCost(refreshModel))}`
                          : "Start agent-runner to enable live re-analyze"
                      }
                      disabled={!agentReady || runningTicker !== null}
                      className="text-xs px-2 py-1 rounded-md border border-border hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => runOne(p.ticker)}
                    >
                      {runningTicker === p.ticker ? "Running…" : "Re-analyze"}
                    </button>
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
  running,
}: {
  stale: number;
  totalCost: number;
  monthSpent: number;
  monthlyCap: number;
  overCap: boolean;
  agentReady: boolean;
  onRefreshAll: () => Promise<void>;
  running: boolean;
}) {
  const blocked = overCap || !agentReady || running;
  const reason = !agentReady
    ? "Agent server offline"
    : overCap
      ? "Over monthly cap"
      : running
        ? "Running…"
        : null;
  return (
    <section className="rounded-xl border border-border bg-white p-5 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h2 className="font-medium">Force refresh stale positions</h2>
        <p className="text-sm text-muted">
          {stale} position{stale === 1 ? "" : "s"} have analyses older than{" "}
          {STALE_HOURS}h. Refresh would cost approximately{" "}
          <span className="font-mono">{formatUsd(totalCost)}</span> on Haiku.
          Synthesis runs once after refreshes complete.
        </p>
        <p className="text-xs font-mono text-muted mt-1">
          month: {formatUsd(monthSpent)} / {formatUsd(monthlyCap)} cap
        </p>
      </div>
      <button
        type="button"
        disabled={blocked}
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
  jobStatus,
}: {
  agentReady: boolean;
  jobStatus: JobStatus;
}) {
  if (!agentReady) {
    return (
      <div className="rounded-lg border border-border bg-slate-50 px-4 py-2 text-xs text-muted">
        Agent runner not detected on <code className="font-mono">localhost:8787</code>. Re-analyze and force-refresh are disabled. Start it with{" "}
        <code className="font-mono">cd agent-runner &amp;&amp; uv run agent-server</code>.
      </div>
    );
  }
  if (jobStatus.state === "running") {
    return (
      <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-2 text-sm">
        Running {jobStatus.ticker} (job {jobStatus.jobId.slice(0, 6)}) · est.{" "}
        <span className="font-mono">{formatUsd(jobStatus.estimated)}</span>
      </div>
    );
  }
  if (jobStatus.state === "done") {
    return (
      <div className="rounded-lg border border-buy/30 bg-buy/5 px-4 py-2 text-sm">
        {jobStatus.ticker} re-analyzed · cost{" "}
        <span className="font-mono">{formatUsd(jobStatus.cost)}</span>. Reload
        the page to pick up the new run.
      </div>
    );
  }
  if (jobStatus.state === "error") {
    return (
      <div className="rounded-lg border border-sell/30 bg-sell/5 px-4 py-2 text-sm text-sell">
        {jobStatus.message}
      </div>
    );
  }
  return null;
}

function AddPosition({
  portfolio,
  onAddPosition,
  onSetCash,
}: {
  portfolio: Portfolio;
  onAddPosition?: (pos: Position) => string | null;
  onSetCash?: (cashUsd: number) => void;
}) {
  const [pendingTicker, setPendingTicker] = useState<{
    symbol: string;
    description: string;
  } | null>(null);
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cashDraft, setCashDraft] = useState(String(portfolio.cashUsd));

  function add(e: React.FormEvent) {
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
    const costNum = avgCost.trim() ? Number(avgCost) : undefined;
    if (avgCost.trim() && (!Number.isFinite(costNum) || (costNum ?? 0) <= 0)) {
      setError("Avg cost must be a positive number, or leave blank");
      return;
    }
    const err = onAddPosition?.({
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
    setError(null);
  }

  return (
    <section className="rounded-xl border border-border bg-white p-5 space-y-4">
      <h2 className="font-medium">Manage positions</h2>

      <form onSubmit={add} className="space-y-3">
        {!pendingTicker ? (
          <TickerSearch
            onSelect={(hit) =>
              setPendingTicker({
                symbol: hit.symbol,
                description: hit.description,
              })
            }
          />
        ) : (
          <div className="flex items-center justify-between rounded-md border border-border bg-slate-50 px-3 py-2">
            <span>
              <span className="font-mono font-semibold">
                {pendingTicker.symbol}
              </span>
              <span className="text-muted ml-2">{pendingTicker.description}</span>
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
              placeholder="—"
            />
          </label>
        </div>

        {error ? <p className="text-sm text-sell">{error}</p> : null}

        <button
          type="submit"
          disabled={!pendingTicker}
          className="w-full h-11 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pendingTicker
            ? `Add ${pendingTicker.symbol}`
            : "Pick a ticker to add"}
        </button>
      </form>

      <div className="border-t border-border pt-4">
        <label className="block space-y-1 max-w-xs">
          <span className="text-sm font-medium">Cash (USD)</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="any"
              min="0"
              value={cashDraft}
              onChange={(e) => setCashDraft(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => {
                const n = Number(cashDraft);
                if (Number.isFinite(n) && n >= 0) onSetCash?.(n);
              }}
              className="h-10 px-3 rounded-md border border-border hover:bg-slate-50"
            >
              Save
            </button>
          </div>
        </label>
      </div>
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

function isStale(synthesis: PortfolioSynthesis | null, ticker: string): boolean {
  if (!synthesis) return true;
  const decision = synthesis.decisions.find((d) => d.ticker === ticker);
  if (!decision?.lastAnalyzedAt) return true;
  const age = Date.now() - new Date(decision.lastAnalyzedAt).getTime();
  return age > STALE_HOURS * 60 * 60 * 1000;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}


"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tickerToRunId } from "@/lib/runs";
import { estimateRunCost, formatUsd, MONTHLY_CAP_USD } from "@/lib/cost";
import { Disclaimer } from "@/components/Disclaimer";
import { useAgentHealth } from "@/lib/agentClient";

const MODELS = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — default" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — opt-in deep dive" },
];

const DEMO_TICKERS = Object.keys(tickerToRunId);

export default function AnalyzePage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [ticker, setTicker] = useState(DEMO_TICKERS[0] ?? "NVDA");
  const [date, setDate] = useState(today);
  const [depth, setDepth] = useState(1);
  const [model, setModel] = useState("claude-haiku-4-5");

  const { health } = useAgentHealth();
  const baseCost = useMemo(() => estimateRunCost(model), [model]);
  const estCost = baseCost * depth;
  const monthSpentSoFar = health?.monthSpentUsd ?? 0;
  const monthlyCap = health?.monthlyCapUsd ?? MONTHLY_CAP_USD;
  const monthRemaining = Math.max(0, monthlyCap - monthSpentSoFar);
  const overCap = estCost > monthRemaining;

  const tickerKnown = tickerToRunId[ticker.toUpperCase()] !== undefined;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (overCap) return;
    const matched = tickerToRunId[ticker.toUpperCase()];
    if (!matched) {
      alert(
        "Phase 1 only ships baked demo reports. Pick one of: " +
          DEMO_TICKERS.join(", "),
      );
      return;
    }
    startTransition(() => {
      router.push(`/runs/${matched}`);
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Run analysis</h1>
        <p className="text-muted">
          Demo mode — running this will load a pre-baked report. Live execution lands
          in Phase 3.
        </p>
      </header>

      <Disclaimer />

      <form
        onSubmit={onSubmit}
        className="space-y-6 rounded-xl border border-border bg-white p-6"
      >
        <Field label="Ticker" hint={`Demo tickers: ${DEMO_TICKERS.join(", ")}`}>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            className="w-full font-mono text-lg rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="NVDA"
          />
        </Field>

        <Field label="Analysis date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>

        <Field
          label={`Debate depth: ${depth} round${depth === 1 ? "" : "s"}`}
          hint="Each round = one bull-vs-bear exchange. More depth, more cost."
        >
          <input
            type="range"
            min={1}
            max={3}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="w-full"
          />
        </Field>

        <Field label="Model">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        <CostPanel
          estimated={estCost}
          monthlyCap={monthlyCap}
          monthSpentSoFar={monthSpentSoFar}
          overCap={overCap}
          live={Boolean(health?.ok)}
        />

        <button
          type="submit"
          disabled={pending || overCap}
          className="w-full inline-flex items-center justify-center h-11 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {overCap
            ? `Over monthly cap (${formatUsd(monthRemaining)} left)`
            : tickerKnown
              ? `Run analysis · est. ${formatUsd(estCost)}`
              : `No demo report for ${ticker}`}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function CostPanel({
  estimated,
  monthlyCap,
  monthSpentSoFar,
  overCap,
  live,
}: {
  estimated: number;
  monthlyCap: number;
  monthSpentSoFar: number;
  overCap: boolean;
  live: boolean;
}) {
  const pct = Math.min(100, (monthSpentSoFar / monthlyCap) * 100);
  return (
    <div className="rounded-lg border border-border bg-slate-50 p-4 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Estimated cost</span>
        <span className="font-mono text-lg">{formatUsd(estimated)}</span>
      </div>
      <p className="text-xs text-muted">
        Calibrated against a real Haiku run (~$0.48). Sonnet is roughly 3× that.
      </p>
      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div
          className="h-full bg-accent"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          Month spend: {formatUsd(monthSpentSoFar)} / {formatUsd(monthlyCap)} cap
          {live ? null : <span className="ml-1">(agent server offline; not live)</span>}
        </span>
        {overCap ? (
          <span className="text-sell font-medium">Would exceed cap</span>
        ) : null}
      </div>
    </div>
  );
}

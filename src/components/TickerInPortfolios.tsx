"use client";

import Link from "next/link";
import { useState } from "react";
import {
  usePortfolios,
  useTickerInPortfolios,
  type PortfolioWithTicker,
} from "@/lib/portfolio";
import type { PortfolioAction } from "@/lib/types";

export function TickerInPortfolios({ ticker }: { ticker: string }) {
  const { hydrated, holding, notHolding } = useTickerInPortfolios(ticker);
  const portfolios = usePortfolios();

  if (!hydrated) {
    return (
      <section className="rounded-xl border border-border bg-white p-5">
        <h2 className="text-sm uppercase tracking-wider font-medium text-muted">
          Held in
        </h2>
        <p className="text-sm text-muted mt-2">Loading…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-white p-5 space-y-4">
      <h2 className="text-sm uppercase tracking-wider font-medium text-muted">
        Held in
      </h2>

      {holding.length === 0 ? (
        <p className="text-sm text-muted">
          {ticker} is not in any of your portfolios.
        </p>
      ) : (
        <ul className="space-y-2">
          {holding.map((p) => (
            <HoldingRow key={p.id} p={p} />
          ))}
        </ul>
      )}

      {notHolding.filter((p) => !p.isDemo).length > 0 ? (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted">
            Add to portfolio
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {notHolding
              .filter((p) => !p.isDemo)
              .map((p) => (
                <li key={p.id}>
                  <AddToPortfolioButton
                    portfolioName={p.name}
                    onAdd={(shares, avgCost) => {
                      if (!p.slotId) return "Cannot add to demo portfolio";
                      return portfolios.upsertPosition(p.slotId, {
                        ticker,
                        shares,
                        avgCost,
                      });
                    }}
                  />
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function HoldingRow({ p }: { p: PortfolioWithTicker }) {
  const target = p.slotId ? `/portfolio/${p.slotId}` : `/portfolio/demo`;
  return (
    <li>
      <Link
        href={target}
        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:border-accent transition"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{p.name}</span>
            {p.isDemo ? (
              <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                Demo
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted font-mono mt-0.5">
            {p.position.shares} sh ·{" "}
            {p.weightPct > 0 ? `${p.weightPct.toFixed(1)}% of NAV` : "no last px"}
          </div>
        </div>
        {p.decision ? <ActionBadge action={p.decision.action} /> : null}
      </Link>
    </li>
  );
}

function AddToPortfolioButton({
  portfolioName,
  onAdd,
}: {
  portfolioName: string;
  onAdd: (shares: number, avgCost?: number) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-md border border-dashed border-border px-3 py-2 text-sm hover:bg-slate-50"
      >
        + {portfolioName}
      </button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const sn = Number(shares);
    if (!Number.isFinite(sn) || sn <= 0) {
      setError("Enter shares > 0");
      return;
    }
    const cn = avgCost.trim() ? Number(avgCost) : undefined;
    if (avgCost.trim() && (!Number.isFinite(cn) || (cn ?? 0) <= 0)) {
      setError("Avg cost must be > 0 or blank");
      return;
    }
    const err = onAdd(sn, cn);
    if (err) {
      setError(err);
      return;
    }
    setOpen(false);
    setShares("");
    setAvgCost("");
    setError(null);
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-border p-2 space-y-2 bg-slate-50"
    >
      <div className="text-xs font-medium">{portfolioName}</div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          step="any"
          min="0"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          placeholder="shares"
          className="rounded-md border border-border px-2 py-1 text-sm"
        />
        <input
          type="number"
          step="any"
          min="0"
          value={avgCost}
          onChange={(e) => setAvgCost(e.target.value)}
          placeholder="avg cost"
          className="rounded-md border border-border px-2 py-1 text-sm"
        />
      </div>
      {error ? <p className="text-xs text-sell">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="h-8 px-3 rounded-md bg-accent text-accent-fg text-xs font-medium hover:opacity-90"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="h-8 px-3 rounded-md border border-border text-xs hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ActionBadge({ action }: { action: PortfolioAction }) {
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
      className={`inline-flex items-center px-2 py-0.5 rounded-md ring-1 ring-inset font-mono font-semibold text-[10px] flex-shrink-0 ${cls}`}
    >
      {label}
    </span>
  );
}

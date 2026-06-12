"use client";

import Link from "next/link";
import { useState } from "react";
import { usePortfolios, MAX_PORTFOLIOS } from "@/lib/portfolio";
import { DEMO_PORTFOLIO, DEMO_SYNTHESIS } from "@/lib/synthesis";
import { Disclaimer } from "@/components/Disclaimer";

export default function PortfolioIndex() {
  const { hydrated, list, freeSlot, create } = usePortfolios();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const slot = create(name);
    if (slot) {
      setName("");
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Portfolios</h1>
        <p className="text-muted">
          Up to {MAX_PORTFOLIOS} portfolios. Synthesis runs on cached per-ticker
          analyses each time you open one — cheap. Refresh per-ticker to update.
        </p>
      </header>

      <Disclaimer />

      <ul className="space-y-3">
        <li>
          <Link
            href={`/portfolio/${DEMO_PORTFOLIO.id}`}
            className="block rounded-xl border border-border bg-white p-5 hover:border-accent transition"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{DEMO_PORTFOLIO.name}</h2>
                  <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                    Demo
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {DEMO_PORTFOLIO.positions.length} positions · last synthesized{" "}
                  {new Date(DEMO_SYNTHESIS.createdAt).toLocaleString()}
                </p>
              </div>
              <span className="text-muted text-sm">Open →</span>
            </div>
          </Link>
        </li>

        {hydrated &&
          list.map((p) => (
            <li key={p.slotId}>
              <Link
                href={`/portfolio/${p.slotId}`}
                className="block rounded-xl border border-border bg-white p-5 hover:border-accent transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{p.name}</h2>
                    <p className="text-sm text-muted">
                      {p.positions.length} positions · updated{" "}
                      {new Date(p.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-muted text-sm">Open →</span>
                </div>
              </Link>
            </li>
          ))}
      </ul>

      <div className="rounded-xl border border-dashed border-border p-5">
        {!hydrated ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : !freeSlot ? (
          <p className="text-muted text-sm">
            All {MAX_PORTFOLIOS} portfolio slots are in use. Open one to remove it
            before creating a new one.
          </p>
        ) : !creating ? (
          <button
            onClick={() => setCreating(true)}
            className="w-full text-center text-sm text-muted hover:text-foreground py-1"
          >
            + Add a portfolio ({MAX_PORTFOLIOS - list.length} of {MAX_PORTFOLIOS} slots
            available)
          </button>
        ) : (
          <form onSubmit={onCreate} className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Portfolio name (e.g. Taxable, IRA, Watchlist)"
              className="flex-1 rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              className="h-10 px-4 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
              className="h-10 px-4 rounded-md border border-border hover:bg-slate-50"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

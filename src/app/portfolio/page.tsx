"use client";

import Link from "next/link";
import { useState } from "react";
import { usePortfolios, MAX_PORTFOLIOS } from "@/lib/portfolio";
import { getPassword } from "@/lib/agentClient";
import { Disclaimer } from "@/components/Disclaimer";
import { PasswordPrompt } from "@/components/PasswordGate";

export default function PortfolioIndex() {
  const { hydrated, loadError, list, freeSlot, create } = usePortfolios();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function ensurePassword(then: () => void): boolean {
    if (getPassword()) return true;
    setPendingAction(() => then);
    return false;
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!ensurePassword(() => void onCreate(e))) return;
    setSubmitError(null);
    const result = await create(name);
    if (result.error) {
      setSubmitError(result.error);
      return;
    }
    setName("");
    setCreating(false);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
      <PasswordPrompt
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onSubmit={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) action();
        }}
      />

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Portfolios</h1>
        <p className="text-muted">
          Up to {MAX_PORTFOLIOS} portfolios. All viewers with the password
          share the same book — edits made anywhere persist server-side.
        </p>
      </header>

      <Disclaimer />

      {loadError ? (
        <div className="rounded-md border border-sell/30 bg-sell/5 px-4 py-2 text-sm text-sell">
          Failed to load portfolios: {loadError}
        </div>
      ) : null}

      {!hydrated ? (
        <p className="text-muted text-sm">Loading portfolios…</p>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <h2 className="font-medium">No portfolios yet</h2>
          <p className="text-sm text-muted mt-1">
            Create the first one below.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((p) => (
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
      )}

      <div className="rounded-xl border border-dashed border-border p-5">
        {!hydrated ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : !freeSlot ? (
          <p className="text-muted text-sm">
            All {MAX_PORTFOLIOS} portfolio slots are in use. Open one to remove
            it before creating a new one.
          </p>
        ) : !creating ? (
          <button
            onClick={() => setCreating(true)}
            className="w-full text-center text-sm text-muted hover:text-foreground py-1"
          >
            + Add a portfolio ({MAX_PORTFOLIOS - list.length} of {MAX_PORTFOLIOS}{" "}
            slots available)
          </button>
        ) : (
          <form onSubmit={onCreate} className="space-y-2">
            <div className="flex items-center gap-2">
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
                  setSubmitError(null);
                }}
                className="h-10 px-4 rounded-md border border-border hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
            {submitError ? (
              <p className="text-sm text-sell">{submitError}</p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  getQuote,
  hasFinnhubKey,
  searchSymbols,
  type Quote,
  type SymbolHit,
} from "@/lib/finnhub";

type Props = {
  onSelect: (hit: SymbolHit, quote: Quote | null) => void;
  placeholder?: string;
};

// Module-level cache so quotes survive remounts/re-renders within a session.
const QUOTE_CACHE = new Map<string, Quote | null>();

export function TickerSearch({ onSelect, placeholder = "Search ticker or company..." }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debouncedQ = useDebounced(q, 250);

  useEffect(() => {
    if (!debouncedQ.trim()) {
      setHits([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchSymbols(debouncedQ)
      .then((res) => {
        if (cancelled) return;
        setHits(res);
        setActiveIdx(0);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "search failed");
        setHits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ]);

  // Fetch quotes for the currently visible hits. Cap at the top 8 to avoid
  // burning rate limits on every keystroke; the dropdown is short anyway.
  useEffect(() => {
    if (!hasFinnhubKey() || hits.length === 0) return;
    let cancelled = false;
    const targets = hits.slice(0, 8).map((h) => h.symbol);
    void Promise.all(
      targets.map(async (sym) => {
        if (QUOTE_CACHE.has(sym)) {
          return [sym, QUOTE_CACHE.get(sym) ?? null] as const;
        }
        try {
          const q = await getQuote(sym);
          QUOTE_CACHE.set(sym, q);
          return [sym, q] as const;
        } catch {
          QUOTE_CACHE.set(sym, null);
          return [sym, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setQuotes((prev) => {
        const next = { ...prev };
        for (const [sym, q] of entries) next[sym] = q;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [hits]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function pick(hit: SymbolHit) {
    onSelect(hit, quotes[hit.symbol] ?? null);
    setQ("");
    setHits([]);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="w-full font-mono text-base rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
        autoComplete="off"
      />
      {!hasFinnhubKey() ? (
        <p className="mt-1 text-xs text-muted">
          Set <code className="font-mono">NEXT_PUBLIC_FINNHUB_API_KEY</code> in
          <code className="font-mono"> .env.local</code> for full ticker coverage.
          Currently using a small built-in list.
        </p>
      ) : null}
      {open && (q.trim().length > 0) ? (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-white shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-sm text-muted">Searching…</div>
          ) : error ? (
            <div className="px-3 py-2 text-sm text-sell">Error: {error}</div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted">No matches</div>
          ) : (
            <ul className="max-h-72 overflow-auto">
              {hits.map((h, i) => {
                const quote = quotes[h.symbol];
                return (
                  <li key={`${h.symbol}-${i}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => pick(h)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 ${
                        i === activeIdx ? "bg-slate-100" : "hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-semibold">{h.symbol}</span>
                        <span className="text-muted truncate">{h.description}</span>
                      </span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        {quote ? (
                          <>
                            <span className="font-mono">${quote.price.toFixed(2)}</span>
                            <span
                              className={`font-mono text-xs ${
                                quote.changePct >= 0 ? "text-buy" : "text-sell"
                              }`}
                            >
                              {quote.changePct >= 0 ? "+" : ""}
                              {quote.changePct.toFixed(2)}%
                            </span>
                          </>
                        ) : null}
                        {h.type ? (
                          <span className="text-[10px] uppercase tracking-wider text-muted">
                            {h.type}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { Portfolio, Position, PositionDecision } from "./types";
import {
  PORTFOLIO_SLOT_IDS,
  type PortfolioSlotId,
  MAX_POSITIONS_PER_PORTFOLIO,
} from "./portfolio-config";
import {
  AgentServerError,
  agentBaseUrl,
  authHeaders,
} from "./agentClient";

export {
  PORTFOLIO_SLOT_IDS,
  MAX_PORTFOLIOS,
  MAX_POSITIONS_PER_PORTFOLIO,
} from "./portfolio-config";
export type { PortfolioSlotId } from "./portfolio-config";

type Store = Record<PortfolioSlotId, Portfolio | null>;

const EMPTY_STORE: Store = { p1: null, p2: null, p3: null };

function newPortfolio(id: string, name: string): Portfolio {
  const now = new Date().toISOString();
  return {
    id,
    name,
    positions: [],
    cashUsd: 0,
    createdAt: now,
    updatedAt: now,
  };
}

async function fetchAllFromServer(): Promise<Store> {
  const headers = authHeaders();
  // Without a password set, the server returns 401. Treat that as "empty"
  // (UX decision: show empty slots + a password prompt on first write).
  if (!("Authorization" in headers)) return EMPTY_STORE;

  const r = await fetch(`${agentBaseUrl}/portfolios`, { headers });
  if (r.status === 401) return EMPTY_STORE;
  if (!r.ok) throw new AgentServerError(r.status, `list portfolios: ${r.status}`);
  const data = (await r.json()) as { portfolios: Portfolio[] };
  const out: Store = { ...EMPTY_STORE };
  for (const p of data.portfolios ?? []) {
    if (p.id === "p1" || p.id === "p2" || p.id === "p3") {
      out[p.id] = p;
    }
  }
  return out;
}

async function putPortfolio(p: Portfolio): Promise<void> {
  const r = await fetch(`${agentBaseUrl}/portfolios/${p.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(p),
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new AgentServerError(r.status, msg || `put portfolio: ${r.status}`);
  }
}

async function deletePortfolio(slotId: PortfolioSlotId): Promise<void> {
  const r = await fetch(`${agentBaseUrl}/portfolios/${slotId}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!r.ok && r.status !== 404) {
    throw new AgentServerError(r.status, `delete portfolio: ${r.status}`);
  }
}

export type PortfolioMutator = {
  store: Store;
  hydrated: boolean;
  loadError: string | null;
  list: (Portfolio & { slotId: PortfolioSlotId })[];
  freeSlot: PortfolioSlotId | null;
  get: (slotId: PortfolioSlotId) => Portfolio | null;
  create: (name: string) => Promise<{ slotId: PortfolioSlotId | null; error: string | null }>;
  rename: (slotId: PortfolioSlotId, name: string) => Promise<string | null>;
  remove: (slotId: PortfolioSlotId) => Promise<string | null>;
  setCash: (slotId: PortfolioSlotId, cashUsd: number) => Promise<string | null>;
  upsertPosition: (slotId: PortfolioSlotId, pos: Position) => Promise<string | null>;
  removePosition: (slotId: PortfolioSlotId, ticker: string) => Promise<string | null>;
  refresh: () => Promise<void>;
};

const REVALIDATE_MS = 30_000;
const REFRESH_EVENT = "yeyaxin.portfolios.refresh";

/**
 * Hook backed by the server (DynamoDB). Same interface as the prior
 * localStorage hook so existing UI components don't change.
 *
 * Behavior:
 *  - Mount: GET /portfolios, hydrate state.
 *  - Mutations: optimistic local update + PUT/DELETE to server, then refresh.
 *  - Cross-tab sync: dispatch a CustomEvent on success; other hook instances
 *    on the same page listen and refresh.
 *  - Periodic revalidation (30s) catches changes from other browsers/devices.
 */
export function usePortfolios(): PortfolioMutator {
  const [store, setStore] = useState<Store>(EMPTY_STORE);
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const next = await fetchAllFromServer();
      // Drop stale responses if a newer refresh started.
      if (seq !== refreshSeq.current) return;
      setStore(next);
      setLoadError(null);
    } catch (e) {
      if (seq !== refreshSeq.current) return;
      const msg =
        e instanceof AgentServerError
          ? `Server: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setLoadError(msg);
    } finally {
      if (seq === refreshSeq.current) setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REVALIDATE_MS);

    function onCustom() {
      void refresh();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") void refresh();
    }
    window.addEventListener(REFRESH_EVENT, onCustom);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(REFRESH_EVENT, onCustom);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  function broadcast() {
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
  }

  const list: (Portfolio & { slotId: PortfolioSlotId })[] = PORTFOLIO_SLOT_IDS.flatMap(
    (slotId) => {
      const p = store[slotId];
      return p ? [{ ...p, slotId }] : [];
    },
  );

  const freeSlot =
    PORTFOLIO_SLOT_IDS.find((id) => store[id] === null) ?? null;

  const get = useCallback(
    (slotId: PortfolioSlotId) => store[slotId],
    [store],
  );

  const persistOne = useCallback(
    async (slotId: PortfolioSlotId, next: Portfolio): Promise<string | null> => {
      // Optimistic
      const prev = store[slotId];
      setStore((s) => ({ ...s, [slotId]: next }));
      try {
        await putPortfolio(next);
        broadcast();
        return null;
      } catch (e) {
        // Rollback
        setStore((s) => ({ ...s, [slotId]: prev }));
        return e instanceof Error ? e.message : String(e);
      }
    },
    [store],
  );

  const create = useCallback(
    async (name: string) => {
      const slot = PORTFOLIO_SLOT_IDS.find((id) => store[id] === null);
      if (!slot) return { slotId: null, error: "No free slots" };
      const trimmed = name.trim() || `Portfolio ${slot.slice(1)}`;
      const p = newPortfolio(slot, trimmed);
      const err = await persistOne(slot, p);
      if (err) return { slotId: null, error: err };
      return { slotId: slot, error: null };
    },
    [store, persistOne],
  );

  const rename = useCallback(
    async (slotId: PortfolioSlotId, name: string) => {
      const current = store[slotId];
      if (!current) return "Portfolio not found";
      const next: Portfolio = {
        ...current,
        name: name.trim() || current.name,
        updatedAt: new Date().toISOString(),
      };
      return persistOne(slotId, next);
    },
    [store, persistOne],
  );

  const remove = useCallback(
    async (slotId: PortfolioSlotId) => {
      const prev = store[slotId];
      setStore((s) => ({ ...s, [slotId]: null }));
      try {
        await deletePortfolio(slotId);
        broadcast();
        return null;
      } catch (e) {
        setStore((s) => ({ ...s, [slotId]: prev }));
        return e instanceof Error ? e.message : String(e);
      }
    },
    [store],
  );

  const setCash = useCallback(
    async (slotId: PortfolioSlotId, cashUsd: number) => {
      const current = store[slotId];
      if (!current) return "Portfolio not found";
      const next: Portfolio = {
        ...current,
        cashUsd: Math.max(0, cashUsd),
        updatedAt: new Date().toISOString(),
      };
      return persistOne(slotId, next);
    },
    [store, persistOne],
  );

  const upsertPosition = useCallback(
    async (slotId: PortfolioSlotId, pos: Position) => {
      const current = store[slotId];
      if (!current) return "Portfolio not found";
      const ticker = pos.ticker.toUpperCase();
      const idx = current.positions.findIndex((p) => p.ticker === ticker);
      if (idx === -1 && current.positions.length >= MAX_POSITIONS_PER_PORTFOLIO) {
        return `Cap of ${MAX_POSITIONS_PER_PORTFOLIO} positions per portfolio`;
      }
      const positions = [...current.positions];
      const merged: Position = { ...pos, ticker };
      if (idx === -1) positions.push(merged);
      else positions[idx] = merged;
      const next: Portfolio = {
        ...current,
        positions,
        updatedAt: new Date().toISOString(),
      };
      return persistOne(slotId, next);
    },
    [store, persistOne],
  );

  const removePosition = useCallback(
    async (slotId: PortfolioSlotId, ticker: string) => {
      const current = store[slotId];
      if (!current) return "Portfolio not found";
      const next: Portfolio = {
        ...current,
        positions: current.positions.filter(
          (p) => p.ticker !== ticker.toUpperCase(),
        ),
        updatedAt: new Date().toISOString(),
      };
      return persistOne(slotId, next);
    },
    [store, persistOne],
  );

  return {
    store,
    hydrated,
    loadError,
    list,
    freeSlot,
    get,
    create,
    rename,
    remove,
    setCash,
    upsertPosition,
    removePosition,
    refresh,
  };
}

export type PortfolioWithTicker = {
  id: string;
  slotId: PortfolioSlotId | null;
  name: string;
  position: Position;
  weightPct: number;
  decision: PositionDecision | null;
};

export function useTickerInPortfolios(ticker: string): {
  hydrated: boolean;
  holding: PortfolioWithTicker[];
  notHolding: { id: string; slotId: PortfolioSlotId | null; name: string }[];
} {
  const { hydrated, list } = usePortfolios();
  const upper = ticker.toUpperCase();

  return useMemo(() => {
    const holding: PortfolioWithTicker[] = [];
    const notHolding: { id: string; slotId: PortfolioSlotId | null; name: string }[] = [];

    for (const p of list) {
      const pos = p.positions.find((x) => x.ticker === upper);
      if (!pos) {
        notHolding.push({ id: p.slotId, slotId: p.slotId, name: p.name });
        continue;
      }
      const w = computeWeights(p as Portfolio).positionWeights.find(
        (x) => x.ticker === upper,
      );
      holding.push({
        id: p.slotId,
        slotId: p.slotId,
        name: p.name,
        position: pos,
        weightPct: w?.weightPct ?? 0,
        decision: null,
      });
    }

    return { hydrated, holding, notHolding };
  }, [list, hydrated, upper]);
}

export function computeWeights(p: Portfolio): {
  marketValue: number;
  totalNav: number;
  cashWeight: number;
  positionWeights: { ticker: string; marketValue: number; weightPct: number }[];
} {
  const positions = p.positions.map((pos) => {
    const px = pos.lastPrice ?? pos.avgCost ?? 0;
    return { ticker: pos.ticker, marketValue: pos.shares * px };
  });
  const positionsValue = positions.reduce((s, x) => s + x.marketValue, 0);
  const totalNav = positionsValue + p.cashUsd;
  const cashWeight = totalNav > 0 ? (p.cashUsd / totalNav) * 100 : 0;
  const positionWeights = positions.map((x) => ({
    ...x,
    weightPct: totalNav > 0 ? (x.marketValue / totalNav) * 100 : 0,
  }));
  return { marketValue: positionsValue, totalNav, cashWeight, positionWeights };
}

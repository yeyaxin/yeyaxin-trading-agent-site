"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import type {
  Portfolio,
  PortfolioSynthesis,
  Position,
  PositionDecision,
} from "./types";
import {
  PORTFOLIO_SLOT_IDS,
  type PortfolioSlotId,
  MAX_POSITIONS_PER_PORTFOLIO,
} from "./portfolio-config";
import { DEMO_PORTFOLIO, DEMO_SYNTHESIS } from "./synthesis";

export {
  PORTFOLIO_SLOT_IDS,
  DEMO_PORTFOLIO_ID,
  MAX_PORTFOLIOS,
  MAX_POSITIONS_PER_PORTFOLIO,
} from "./portfolio-config";
export type { PortfolioSlotId } from "./portfolio-config";

const STORAGE_KEY = "yeyaxin.portfolios.v1";

type Store = Record<PortfolioSlotId, Portfolio | null>;

const EMPTY_STORE: Store = { p1: null, p2: null, p3: null };

function readStore(): Store {
  if (typeof window === "undefined") return EMPTY_STORE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      p1: parsed.p1 ?? null,
      p2: parsed.p2 ?? null,
      p3: parsed.p3 ?? null,
    };
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(store: Store) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

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

export type PortfolioMutator = {
  store: Store;
  hydrated: boolean;
  list: (Portfolio & { slotId: PortfolioSlotId })[];
  freeSlot: PortfolioSlotId | null;
  get: (slotId: PortfolioSlotId) => Portfolio | null;
  create: (name: string) => PortfolioSlotId | null;
  rename: (slotId: PortfolioSlotId, name: string) => void;
  remove: (slotId: PortfolioSlotId) => void;
  setCash: (slotId: PortfolioSlotId, cashUsd: number) => void;
  upsertPosition: (slotId: PortfolioSlotId, pos: Position) => string | null;
  removePosition: (slotId: PortfolioSlotId, ticker: string) => void;
};

export function usePortfolios(): PortfolioMutator {
  const [store, setStore] = useState<Store>(EMPTY_STORE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setStore(readStore());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Store) => {
    setStore(next);
    writeStore(next);
  }, []);

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

  const create = useCallback(
    (name: string): PortfolioSlotId | null => {
      const slot = PORTFOLIO_SLOT_IDS.find((id) => store[id] === null);
      if (!slot) return null;
      const trimmed = name.trim() || `Portfolio ${slot.slice(1)}`;
      persist({ ...store, [slot]: newPortfolio(slot, trimmed) });
      return slot;
    },
    [store, persist],
  );

  const rename = useCallback(
    (slotId: PortfolioSlotId, name: string) => {
      const current = store[slotId];
      if (!current) return;
      persist({
        ...store,
        [slotId]: { ...current, name: name.trim() || current.name, updatedAt: new Date().toISOString() },
      });
    },
    [store, persist],
  );

  const remove = useCallback(
    (slotId: PortfolioSlotId) => {
      persist({ ...store, [slotId]: null });
    },
    [store, persist],
  );

  const setCash = useCallback(
    (slotId: PortfolioSlotId, cashUsd: number) => {
      const current = store[slotId];
      if (!current) return;
      persist({
        ...store,
        [slotId]: {
          ...current,
          cashUsd: Math.max(0, cashUsd),
          updatedAt: new Date().toISOString(),
        },
      });
    },
    [store, persist],
  );

  const upsertPosition = useCallback(
    (slotId: PortfolioSlotId, pos: Position): string | null => {
      const current = store[slotId];
      if (!current) return "Portfolio not found";
      const ticker = pos.ticker.toUpperCase();
      const idx = current.positions.findIndex((p) => p.ticker === ticker);
      if (idx === -1 && current.positions.length >= MAX_POSITIONS_PER_PORTFOLIO) {
        return `Cap of ${MAX_POSITIONS_PER_PORTFOLIO} positions per portfolio`;
      }
      const next = [...current.positions];
      const merged: Position = { ...pos, ticker };
      if (idx === -1) next.push(merged);
      else next[idx] = merged;
      persist({
        ...store,
        [slotId]: { ...current, positions: next, updatedAt: new Date().toISOString() },
      });
      return null;
    },
    [store, persist],
  );

  const removePosition = useCallback(
    (slotId: PortfolioSlotId, ticker: string) => {
      const current = store[slotId];
      if (!current) return;
      persist({
        ...store,
        [slotId]: {
          ...current,
          positions: current.positions.filter((p) => p.ticker !== ticker.toUpperCase()),
          updatedAt: new Date().toISOString(),
        },
      });
    },
    [store, persist],
  );

  return {
    store,
    hydrated,
    list,
    freeSlot,
    get,
    create,
    rename,
    remove,
    setCash,
    upsertPosition,
    removePosition,
  };
}

export type PortfolioWithTicker = {
  id: string;
  slotId: PortfolioSlotId | null;
  name: string;
  position: Position;
  weightPct: number;
  decision: PositionDecision | null;
  isDemo: boolean;
};

export function useTickerInPortfolios(ticker: string): {
  hydrated: boolean;
  holding: PortfolioWithTicker[];
  notHolding: { id: string; slotId: PortfolioSlotId | null; name: string; isDemo: boolean }[];
} {
  const { hydrated, list } = usePortfolios();
  const upper = ticker.toUpperCase();

  return useMemo(() => {
    const holding: PortfolioWithTicker[] = [];
    const notHolding: { id: string; slotId: PortfolioSlotId | null; name: string; isDemo: boolean }[] = [];

    const candidates: Array<{
      id: string;
      slotId: PortfolioSlotId | null;
      name: string;
      portfolio: Portfolio;
      synthesis: PortfolioSynthesis | null;
      isDemo: boolean;
    }> = [
      {
        id: DEMO_PORTFOLIO.id,
        slotId: null,
        name: DEMO_PORTFOLIO.name,
        portfolio: DEMO_PORTFOLIO,
        synthesis: DEMO_SYNTHESIS,
        isDemo: true,
      },
      ...list.map((p) => ({
        id: p.slotId,
        slotId: p.slotId,
        name: p.name,
        portfolio: p as Portfolio,
        synthesis: null as PortfolioSynthesis | null,
        isDemo: false,
      })),
    ];

    for (const c of candidates) {
      const pos = c.portfolio.positions.find((p) => p.ticker === upper);
      if (!pos) {
        notHolding.push({ id: c.id, slotId: c.slotId, name: c.name, isDemo: c.isDemo });
        continue;
      }
      const w = computeWeights(c.portfolio).positionWeights.find(
        (x) => x.ticker === upper,
      );
      const decision =
        c.synthesis?.decisions.find((d) => d.ticker === upper) ?? null;
      holding.push({
        id: c.id,
        slotId: c.slotId,
        name: c.name,
        position: pos,
        weightPct: w?.weightPct ?? 0,
        decision,
        isDemo: c.isDemo,
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

"use client";

import { useEffect, useState } from "react";
import type { Run } from "./types";

const RUN_FETCH_BASE =
  process.env.NEXT_PUBLIC_RUN_FETCH_BASE || "https://yeyaxin.com/trade";

export type FetchState =
  | { state: "loading" }
  | { state: "ok"; run: Run }
  | { state: "missing" }
  | { state: "error"; message: string };

export function useRemoteRun(id: string | null): FetchState {
  const [s, setS] = useState<FetchState>({ state: "loading" });

  useEffect(() => {
    if (!id) {
      setS({ state: "missing" });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    setS({ state: "loading" });

    fetch(`${RUN_FETCH_BASE}/runs/${encodeURIComponent(id)}.json`, {
      signal: ctrl.signal,
      cache: "no-store",
    })
      .then((r) => {
        if (cancelled) return null;
        if (r.status === 404) {
          setS({ state: "missing" });
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data || cancelled) return;
        setS({ state: "ok", run: data as Run });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setS({
          state: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [id]);

  return s;
}

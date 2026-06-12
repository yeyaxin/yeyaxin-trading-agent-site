"use client";

export type SymbolHit = {
  symbol: string;
  description: string;
  type?: string;
  source: "finnhub" | "fallback";
};

export type Quote = {
  price: number;
  change: number;
  changePct: number;
  asOf: number;
};

const FALLBACK: SymbolHit[] = [
  { symbol: "AAPL", description: "Apple Inc", type: "Common Stock", source: "fallback" },
  { symbol: "MSFT", description: "Microsoft Corp", type: "Common Stock", source: "fallback" },
  { symbol: "NVDA", description: "NVIDIA Corp", type: "Common Stock", source: "fallback" },
  { symbol: "TSLA", description: "Tesla Inc", type: "Common Stock", source: "fallback" },
  { symbol: "AMZN", description: "Amazon.com Inc", type: "Common Stock", source: "fallback" },
  { symbol: "GOOGL", description: "Alphabet Inc Class A", type: "Common Stock", source: "fallback" },
  { symbol: "META", description: "Meta Platforms Inc", type: "Common Stock", source: "fallback" },
  { symbol: "AVGO", description: "Broadcom Inc", type: "Common Stock", source: "fallback" },
  { symbol: "BRK.B", description: "Berkshire Hathaway Inc Class B", type: "Common Stock", source: "fallback" },
  { symbol: "JPM", description: "JPMorgan Chase & Co", type: "Common Stock", source: "fallback" },
  { symbol: "V", description: "Visa Inc", type: "Common Stock", source: "fallback" },
  { symbol: "JNJ", description: "Johnson & Johnson", type: "Common Stock", source: "fallback" },
  { symbol: "WMT", description: "Walmart Inc", type: "Common Stock", source: "fallback" },
  { symbol: "XOM", description: "Exxon Mobil Corp", type: "Common Stock", source: "fallback" },
  { symbol: "UNH", description: "UnitedHealth Group Inc", type: "Common Stock", source: "fallback" },
  { symbol: "SPY", description: "SPDR S&P 500 ETF Trust", type: "ETF", source: "fallback" },
  { symbol: "QQQ", description: "Invesco QQQ Trust", type: "ETF", source: "fallback" },
];

function getKey(): string | undefined {
  return process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
}

export function hasFinnhubKey(): boolean {
  return Boolean(getKey());
}

export async function searchSymbols(query: string): Promise<SymbolHit[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const key = getKey();
  if (!key) {
    const lower = q.toLowerCase();
    return FALLBACK.filter(
      (h) =>
        h.symbol.toLowerCase().includes(lower) ||
        h.description.toLowerCase().includes(lower),
    ).slice(0, 8);
  }
  const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&exchange=US&token=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`finnhub search ${res.status}`);
  const data = (await res.json()) as {
    result?: { symbol: string; description: string; type?: string }[];
  };
  return (data.result ?? [])
    .filter((r) => !r.symbol.includes(".") || r.symbol.endsWith(".B") || r.symbol.endsWith(".A"))
    .slice(0, 12)
    .map((r) => ({
      symbol: r.symbol,
      description: r.description,
      type: r.type,
      source: "finnhub" as const,
    }));
}

export async function getQuote(symbol: string): Promise<Quote | null> {
  const key = getKey();
  if (!key) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    c?: number;
    d?: number;
    dp?: number;
    t?: number;
  };
  if (typeof data.c !== "number" || data.c === 0) return null;
  return {
    price: data.c,
    change: data.d ?? 0,
    changePct: data.dp ?? 0,
    asOf: (data.t ?? Math.floor(Date.now() / 1000)) * 1000,
  };
}

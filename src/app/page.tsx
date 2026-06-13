import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 space-y-12">
      <section className="space-y-5">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-3xl">
          A panel of AI analysts argues a stock so I don&apos;t have to.
        </h1>
        <p className="text-lg text-muted max-w-2xl">
          A personal research tool. Add tickers to a portfolio; nine
          specialized agents read the financials, news, sentiment, and chart;
          a bull and a bear debate; a trader proposes a sized trade; a risk
          team and portfolio manager approve or reject. Built on{" "}
          <a
            href="https://github.com/TauricResearch/TradingAgents"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            TradingAgents
          </a>
          .
        </p>
        <div className="flex items-center gap-3">
          <Link
            href="/portfolio"
            className="inline-flex items-center justify-center h-11 px-5 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90"
          >
            Open Portfolios
          </Link>
        </div>
      </section>

      <Disclaimer />

      <section className="space-y-5">
        <h2 className="text-2xl font-semibold tracking-tight">
          The pipeline
        </h2>
        <PipelineDiagram />
      </section>
    </div>
  );
}

function PipelineDiagram() {
  return (
    <div className="rounded-xl border border-border bg-white p-6 overflow-x-auto">
      <div className="space-y-6 min-w-[640px]">
        <Stage label="Input" tone="muted">
          <Box>You</Box>
          <Arrow />
          <Box>Ticker + date</Box>
        </Stage>

        <Stage label="Analysts" tone="accent">
          <Box>Fundamentals</Box>
          <Box>Sentiment</Box>
          <Box>News</Box>
          <Box>Technical</Box>
        </Stage>

        <Stage label="Debate" tone="accent">
          <Box tone="buy">Bull</Box>
          <span className="text-muted text-sm self-center">vs</span>
          <Box tone="sell">Bear</Box>
        </Stage>

        <Stage label="Decision" tone="accent">
          <Box>Trader</Box>
          <Arrow />
          <Box>Risk team (3 perspectives)</Box>
          <Arrow />
          <Box tone="solid">Portfolio Manager</Box>
        </Stage>

        <Stage label="Output" tone="muted">
          <Box>BUY / HOLD / SELL</Box>
          <span className="text-muted text-sm self-center">
            with confidence + entry / stop / target
          </span>
        </Stage>
      </div>
    </div>
  );
}

function Stage({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "accent" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-4">
      <div
        className={`text-xs uppercase tracking-wider font-medium ${
          tone === "accent" ? "text-accent" : "text-muted"
        }`}
      >
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Box({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "buy" | "sell" | "solid";
}) {
  const cls =
    tone === "buy"
      ? "border-buy/30 bg-buy/5 text-buy"
      : tone === "sell"
        ? "border-sell/30 bg-sell/5 text-sell"
        : tone === "solid"
          ? "border-accent bg-accent text-accent-fg"
          : "border-border bg-white";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="text-muted">
      →
    </span>
  );
}

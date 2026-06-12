import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";
import { getRuns } from "@/lib/runs";

const STEPS: { name: string; role: string }[] = [
  { name: "Fundamentals", role: "Reads the financials" },
  { name: "Sentiment", role: "Reads the crowd" },
  { name: "News", role: "Reads the headlines" },
  { name: "Technical", role: "Reads the chart" },
  { name: "Bull / Bear", role: "Argue both sides" },
  { name: "Trader", role: "Proposes a trade" },
  { name: "Risk + PM", role: "Approve or reject" },
];

export default function Home() {
  const recent = getRuns().slice(0, 3);

  return (
    <div className="mx-auto max-w-6xl px-6 py-16 space-y-16">
      <section className="space-y-6">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-3xl">
          A panel of AI analysts argues a stock so I don&apos;t have to.
        </h1>
        <p className="text-lg text-muted max-w-2xl">
          Pick a ticker. Seven specialized agents read the financials, the news, the
          chart, and the crowd; debate the trade; and produce a structured report.
          Built on{" "}
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
            href="/analyze"
            className="inline-flex items-center justify-center h-11 px-5 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90"
          >
            Try the demo
          </Link>
          <Link
            href="/history"
            className="inline-flex items-center justify-center h-11 px-5 rounded-lg border border-border hover:bg-slate-50"
          >
            See sample runs
          </Link>
        </div>
      </section>

      <section>
        <Disclaimer />
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li
              key={step.name}
              className="rounded-lg border border-border bg-white p-4"
            >
              <div className="text-xs font-mono text-muted">step {i + 1}</div>
              <div className="font-medium mt-1">{step.name}</div>
              <div className="text-sm text-muted">{step.role}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">Recent demo runs</h2>
          <Link href="/history" className="text-sm text-muted hover:text-foreground">
            View all →
          </Link>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {recent.map((r) => (
            <li key={r.id}>
              <Link
                href={`/runs/${r.id}`}
                className="block rounded-lg border border-border bg-white p-4 hover:border-accent transition"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold">{r.ticker}</span>
                  <DecisionBadge decision={r.decision} />
                </div>
                <p className="mt-2 text-sm text-muted line-clamp-2">{r.oneLine}</p>
                <p className="mt-3 text-xs font-mono text-muted">{r.asOfDate}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: "BUY" | "HOLD" | "SELL" }) {
  const cls =
    decision === "BUY"
      ? "bg-buy/10 text-buy"
      : decision === "SELL"
        ? "bg-sell/10 text-sell"
        : "bg-hold/10 text-hold";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold ${cls}`}
    >
      {decision}
    </span>
  );
}

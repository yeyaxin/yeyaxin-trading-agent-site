import Link from "next/link";
import { Disclaimer } from "@/components/Disclaimer";

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 space-y-14">
      <section className="space-y-5">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-3xl">
          A panel of AI analysts argues a stock so I don&apos;t have to.
        </h1>
        <p className="text-lg text-muted max-w-2xl">
          A personal research tool. Pick a ticker or load a portfolio; nine
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
          <Link
            href="/portfolio/demo"
            className="inline-flex items-center justify-center h-11 px-5 rounded-lg border border-border hover:bg-slate-50"
          >
            Open the Demo Book
          </Link>
        </div>
      </section>

      <Disclaimer />

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">The agent panel</h2>
        <p className="text-muted">
          Every analysis runs through these nine agents in order. They share
          state but reach independent conclusions; the Portfolio Manager
          delivers the final BUY / HOLD / SELL with confidence.
        </p>
        <ol className="grid gap-3 sm:grid-cols-2">
          <Step n={1} name="Fundamentals Analyst" role="Reads the financials — margins, FCF, valuation multiples." />
          <Step n={2} name="Sentiment Analyst" role="Reads the crowd — Reddit, StockTwits, options skew." />
          <Step n={3} name="News Analyst" role="Reads the headlines and macro context for the trading window." />
          <Step n={4} name="Technical Analyst" role="Reads the chart — MACD, RSI, moving averages, trend." />
          <Step n={5} name="Bull Researcher" role="Argues the long thesis from the analyst inputs." />
          <Step n={6} name="Bear Researcher" role="Argues the short thesis. Bull and bear debate as many rounds as the depth setting allows." />
          <Step n={7} name="Trader" role="Synthesizes the debate and proposes a concrete trade — entry, stop, target, size." />
          <Step n={8} name="Risk Manager" role="Three risk perspectives (aggressive, conservative, neutral) stress-test the trader's plan." />
          <Step n={9} name="Portfolio Manager" role="Final decision: approve, modify, or reject. Output is a structured BUY / HOLD / SELL with confidence." />
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Two flows</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Flow
            title="Single-ticker analysis"
            steps={[
              "Open a portfolio (any of yours, or the Demo Book).",
              "Add a position by ticker (Finnhub-powered search) and shares.",
              "Click Re-analyze on that row.",
              "Wait 5–8 min. Decision + full agent transcripts appear at /runs/{ticker}-{date}/.",
            ]}
            cta={{ href: "/portfolio", label: "Go to Portfolios" }}
            costNote="~$0.48 per analysis on Haiku 4.5."
          />
          <Flow
            title="Portfolio-level synthesis"
            steps={[
              "Add 1–20 positions to a portfolio + cash.",
              "Make sure each position has a recent analysis (use Re-analyze if stale).",
              "Click Synthesize portfolio at the top.",
              "Get book-level commentary, factor exposure, and sizing-aware actions (BUY MORE / HOLD / TRIM / EXIT).",
            ]}
            cta={{ href: "/portfolio", label: "Go to Portfolios" }}
            costNote="~$0.01 per synthesis. Cheap because it reasons over summaries, not raw data."
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">What you need to know</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <FactCard title="Password gate">
            Live Re-analyze and Synthesize calls are gated by a shared
            password. Browsing reports, the Demo Book, and history needs no
            password. If you don&apos;t have the password, ask the site
            owner.
          </FactCard>
          <FactCard title="Cost cap">
            Every Anthropic call counts against a $20/month cap enforced at
            the Anthropic console. The site shows live spend so you always
            know where you stand. Per-run cost is calibrated against a real
            Haiku run (~$0.48).
          </FactCard>
          <FactCard title="Portfolios are private">
            Your three portfolio slots live in your browser&apos;s
            localStorage. Other people&apos;s portfolios are not visible to
            you, and yours aren&apos;t visible to them. The Demo Book is the
            only shared example.
          </FactCard>
          <FactCard title="Reports are public">
            Once an analysis runs, the resulting report is visible at
            yeyaxin.com/trade/runs/{"{id}"}/ to anyone with the URL. The
            password gates running new analyses, not viewing finished ones.
          </FactCard>
          <FactCard title="Updates land in ~10 min">
            After Re-analyze finishes (5–8 min), the site rebuilds in CI and
            the new report page goes live (another ~2 min). Reload to see
            it.
          </FactCard>
          <FactCard title="Not investment advice">
            This is a research tool. Outputs are AI-generated, can be wrong,
            and aren&apos;t a substitute for due diligence. Don&apos;t put
            real money on a single agent run.
          </FactCard>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">Pages</h2>
        <ul className="grid gap-2 text-sm">
          <PageRow href="/portfolio" label="Portfolios" desc="List of your portfolio slots + the Demo Book. Entry point for new analyses." />
          <PageRow href="/portfolio/demo" label="Demo Book" desc="Read-only example. NVDA / AAPL / TSLA + cash. Pre-baked synthesis." />
          <PageRow href="/history" label="History" desc="Every per-ticker analysis, sorted newest-first. Click any row for the full report." />
        </ul>
      </section>
    </div>
  );
}

function Step({ n, name, role }: { n: number; name: string; role: string }) {
  return (
    <li className="rounded-lg border border-border bg-white p-4">
      <div className="text-xs font-mono text-muted">step {n}</div>
      <div className="font-medium mt-1">{name}</div>
      <div className="text-sm text-muted mt-0.5">{role}</div>
    </li>
  );
}

function Flow({
  title,
  steps,
  cta,
  costNote,
}: {
  title: string;
  steps: string[];
  cta: { href: string; label: string };
  costNote: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-5 flex flex-col">
      <h3 className="font-semibold">{title}</h3>
      <ol className="list-decimal pl-5 mt-3 space-y-1.5 text-sm">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="text-xs text-muted mt-3 mb-3">{costNote}</p>
      <Link
        href={cta.href}
        className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-accent text-accent text-sm font-medium hover:bg-accent hover:text-accent-fg transition mt-auto"
      >
        {cta.label}
      </Link>
    </div>
  );
}

function FactCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="font-medium">{title}</div>
      <p className="text-sm text-muted mt-1.5">{children}</p>
    </div>
  );
}

function PageRow({
  href,
  label,
  desc,
}: {
  href: string;
  label: string;
  desc: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-md border border-border bg-white px-4 py-3 hover:border-accent transition"
      >
        <div>
          <div className="font-mono font-semibold text-sm">{href}</div>
          <div className="text-sm">
            <span className="font-medium">{label}</span>{" "}
            <span className="text-muted">— {desc}</span>
          </div>
        </div>
        <span className="text-muted text-sm">→</span>
      </Link>
    </li>
  );
}

"use client";

import { useState } from "react";
import type { Run, AgentKind } from "@/lib/types";
import { DecisionBadge } from "./DecisionBadge";
import { TickerInPortfolios } from "./TickerInPortfolios";
import { Markdown } from "./Markdown";
import { formatUsd } from "@/lib/cost";

const ORDER: AgentKind[] = [
  "fundamentals",
  "sentiment",
  "news",
  "technical",
  "bull",
  "bear",
  "trader",
  "risk",
  "portfolio",
];

const STAGE_LABEL: Record<AgentKind, string> = {
  fundamentals: "Analysts",
  sentiment: "Analysts",
  news: "Analysts",
  technical: "Analysts",
  bull: "Debate",
  bear: "Debate",
  trader: "Trade",
  risk: "Approval",
  portfolio: "Approval",
};

export function RunReport({ run }: { run: Run }) {
  const orderedAgents = [...run.agents].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );
  const [activeKind, setActiveKind] = useState<AgentKind>(orderedAgents[0].kind);
  const active = orderedAgents.find((a) => a.kind === activeKind) ?? orderedAgents[0];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-3xl font-semibold">{run.ticker}</h1>
            <DecisionBadge decision={run.decision} size="lg" />
            <span className="text-sm text-muted">
              confidence {(run.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-lg text-foreground max-w-2xl">{run.oneLine}</p>
          <p className="text-xs font-mono text-muted">
            as of {run.asOfDate} · run {new Date(run.createdAt).toLocaleString()} ·{" "}
            {run.model.deep} / {run.model.quick} · {run.debateRounds} debate round
            {run.debateRounds === 1 ? "" : "s"} · {formatUsd(run.usage.costUsd)}
          </p>
        </div>
        {run.demo ? (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
            Demo run · pre-baked
          </span>
        ) : null}
      </header>

      <TickerInPortfolios ticker={run.ticker} />

      <section className="grid gap-4 md:grid-cols-3">
        <Card title="Bull case" tone="buy" items={run.bullCase} />
        <Card title="Bear case" tone="sell" items={run.bearCase} />
        <Card title="Risks" tone="hold" items={run.risks} />
      </section>

      <section className="rounded-xl border border-border bg-white p-5">
        <h2 className="text-sm uppercase tracking-wider text-muted font-medium">
          Trade plan
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-5">
          <Stat label="Action" value={run.tradePlan.action} mono />
          <Stat label="Size" value={run.tradePlan.size} />
          <Stat label="Entry" value={run.tradePlan.entry} />
          <Stat label="Stop" value={run.tradePlan.stop} />
          <Stat label="Target" value={run.tradePlan.target} />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-1">
          <h2 className="text-sm uppercase tracking-wider text-muted font-medium px-2 mb-2">
            Agents
          </h2>
          {orderedAgents.map((a) => {
            const isActive = a.kind === activeKind;
            return (
              <button
                key={a.kind}
                onClick={() => setActiveKind(a.kind)}
                className={`w-full text-left rounded-md px-3 py-2 transition border ${
                  isActive
                    ? "border-accent bg-accent/5"
                    : "border-transparent hover:bg-slate-50"
                }`}
              >
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted">
                  {STAGE_LABEL[a.kind]}
                </div>
                <div className="font-medium">{a.title}</div>
                <div className="text-xs text-muted line-clamp-1">{a.summary}</div>
              </button>
            );
          })}
        </aside>

        <article className="rounded-xl border border-border bg-white p-6 space-y-4">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted">
              {STAGE_LABEL[active.kind]}
            </div>
            <h3 className="text-xl font-semibold">{active.title}</h3>
            <p className="text-muted">{active.summary}</p>
          </div>
          {active.highlights && active.highlights.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {active.highlights.map((h, i) => (
                <li
                  key={i}
                  className="rounded-md bg-slate-50 px-3 py-2 text-sm font-mono"
                >
                  {h}
                </li>
              ))}
            </ul>
          ) : null}
          <Markdown>{active.body}</Markdown>
        </article>
      </section>
    </div>
  );
}

function Card({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "buy" | "sell" | "hold";
  items: string[];
}) {
  const accent =
    tone === "buy" ? "text-buy" : tone === "sell" ? "text-sell" : "text-hold";
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <h3 className={`text-sm uppercase tracking-wider font-medium ${accent}`}>
        {title}
      </h3>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((it, i) => (
          <li key={i} className="leading-relaxed flex gap-2">
            <span className="text-muted flex-shrink-0">•</span>
            <span className="flex-1">
              <Markdown>{stripBoldHeader(it)}</Markdown>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Strip a leading "**Heading**:" or "**Heading**" prefix the bullet extractor
// sometimes carries through, since the markdown renderer would turn it into a
// big bold span.
function stripBoldHeader(s: string): string {
  return s.replace(/^\*\*[^*]+\*\*\s*[:\-—]?\s*/, "").trim() || s;
}

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 ${mono ? "font-mono font-semibold" : ""}`}>{value}</div>
    </div>
  );
}

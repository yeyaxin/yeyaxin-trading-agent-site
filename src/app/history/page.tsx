import Link from "next/link";
import { getRuns, summarize } from "@/lib/runs";
import { DecisionBadge } from "@/components/DecisionBadge";
import { formatUsd } from "@/lib/cost";

export default function HistoryPage() {
  const summaries = getRuns().map(summarize);
  const totalCost = summaries.reduce((s, r) => s + r.costUsd, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="text-muted">
          {summaries.length} runs · total spend {formatUsd(totalCost)}
        </p>
      </header>

      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-muted">
            <tr>
              <Th>Ticker</Th>
              <Th>As of</Th>
              <Th>Run</Th>
              <Th>Decision</Th>
              <Th>Confidence</Th>
              <Th>Summary</Th>
              <Th align="right">Cost</Th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((r) => (
              <tr
                key={r.id}
                className="border-t border-border hover:bg-slate-50/60"
              >
                <Td>
                  <Link
                    href={`/runs/${r.id}`}
                    className="font-mono font-semibold hover:underline"
                  >
                    {r.ticker}
                  </Link>
                </Td>
                <Td mono>{r.asOfDate}</Td>
                <Td mono>{new Date(r.createdAt).toLocaleString()}</Td>
                <Td>
                  <DecisionBadge decision={r.decision} size="sm" />
                </Td>
                <Td mono>{(r.confidence * 100).toFixed(0)}%</Td>
                <Td>
                  <span className="text-muted line-clamp-1">{r.oneLine}</span>
                </Td>
                <Td align="right" mono>
                  {formatUsd(r.costUsd)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-2 text-xs uppercase tracking-wider font-medium ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </td>
  );
}

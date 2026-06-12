export function Disclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-xs text-muted">
        Research tool only. Not investment advice. Outputs are AI-generated and may be wrong.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong className="font-semibold">Not investment advice.</strong> This is a personal
      research tool that runs LLM-based analyses on public market data. Outputs are
      AI-generated, may be wrong, and should not be the basis for any actual trade.
    </div>
  );
}

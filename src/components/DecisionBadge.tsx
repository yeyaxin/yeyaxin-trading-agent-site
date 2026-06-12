import type { Decision } from "@/lib/types";

export function DecisionBadge({
  decision,
  size = "md",
}: {
  decision: Decision;
  size?: "sm" | "md" | "lg";
}) {
  const tone =
    decision === "BUY"
      ? "bg-buy/10 text-buy ring-buy/30"
      : decision === "SELL"
        ? "bg-sell/10 text-sell ring-sell/30"
        : "bg-hold/10 text-hold ring-hold/30";
  const dim =
    size === "lg"
      ? "px-3 py-1.5 text-base"
      : size === "sm"
        ? "px-1.5 py-0.5 text-xs"
        : "px-2 py-0.5 text-sm";
  return (
    <span
      className={`inline-flex items-center rounded-md ring-1 ring-inset font-mono font-semibold ${tone} ${dim}`}
    >
      {decision}
    </span>
  );
}

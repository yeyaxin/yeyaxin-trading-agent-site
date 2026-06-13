import { notFound } from "next/navigation";
import { getRun, getRuns } from "@/lib/runs";
import { RunReport } from "@/components/RunReport";

export function generateStaticParams() {
  const ids = getRuns().map((r) => ({ id: r.id }));
  // Static export refuses to build a dynamic route with zero params. Until at
  // least one real run exists in S3, emit a placeholder that 404s at runtime.
  if (ids.length === 0) return [{ id: "__placeholder" }];
  return ids;
}

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  return <RunReport run={run} />;
}

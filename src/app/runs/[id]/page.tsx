import { notFound } from "next/navigation";
import { getRun, getRuns } from "@/lib/runs";
import { RunReport } from "@/components/RunReport";

export async function generateStaticParams() {
  return getRuns().map((r) => ({ id: r.id }));
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

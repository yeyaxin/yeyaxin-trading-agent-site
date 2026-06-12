import { PortfolioDetail } from "@/components/PortfolioDetail";
import { PORTFOLIO_SLOT_IDS, DEMO_PORTFOLIO_ID } from "@/lib/portfolio-config";

export function generateStaticParams() {
  return [{ id: DEMO_PORTFOLIO_ID }, ...PORTFOLIO_SLOT_IDS.map((id) => ({ id }))];
}

export default async function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PortfolioDetail id={id} />;
}

import type { Portfolio, PortfolioSynthesis } from "./types";
import demoPortfolio from "@/data/portfolios/demo.json";
import demoSynthesis from "@/data/portfolios/demo-synthesis.json";

export const DEMO_PORTFOLIO: Portfolio = demoPortfolio as Portfolio;
export const DEMO_SYNTHESIS: PortfolioSynthesis = demoSynthesis as PortfolioSynthesis;

export function getDemoSynthesisFor(portfolioId: string): PortfolioSynthesis | null {
  return portfolioId === DEMO_PORTFOLIO.id ? DEMO_SYNTHESIS : null;
}

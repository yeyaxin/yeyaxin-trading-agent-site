export const PORTFOLIO_SLOT_IDS = ["p1", "p2", "p3"] as const;
export type PortfolioSlotId = (typeof PORTFOLIO_SLOT_IDS)[number];
export const MAX_PORTFOLIOS = 3;
export const MAX_POSITIONS_PER_PORTFOLIO = 20;

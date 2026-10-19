/** Harga terbaru satu posisi open, dikirim ke app lewat SSE. */
export interface PriceTick {
  id: number;
  mint: string;
  currentPrice: number;
  highPrice: number;
  lowPrice: number;
  pnlPct: number;
  currentMc: number | null;
  highMc: number | null;
  lowMc: number | null;
  /** ms epoch saat harga diterapkan monitor. */
  at: number;
}

export type PriceEvent =
  | { type: 'price'; tick: PriceTick }
  | { type: 'closed'; id: number };

export type PriceEventListener = (event: PriceEvent) => void;

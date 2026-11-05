export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * auto = pool terbesar apa pun quote-nya (pasangan non-SOL dibeli lewat SOL -> quote -> token dalam satu tx).
 * sol = hanya pool yang dipasangkan dengan SOL.
 */
export type QuoteRoute = 'auto' | 'sol';

export const QUOTE_ROUTES: readonly QuoteRoute[] = ['auto', 'sol'];

export interface TradeOptions {
  slippagePct: number;
  priorityFeeSol: number;
  quoteRoute: QuoteRoute;
}

export interface TradeAction {
  action: 'buy' | 'sell';
  mint: string;
  quoteMint?: string;
  amount: number | string;
  denominatedInQuote: 'true' | 'false';
  slippage: number;
}

export interface TradeResult {
  signature: string;
  /** Quote token pool yang dipakai action terakhir (dari field trades di response). */
  quoteMint: string | null;
}

export interface TradeResponse {
  signature?: string;
  err?: string;
  trades?: { poolId?: string; mint?: string; quoteMint?: string; pool?: string }[];
}

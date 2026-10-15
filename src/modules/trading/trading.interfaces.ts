import type { TradeOptions } from '../../integrations/pumpportal/pumpportal.types.ts';
import type { TradeMode } from '../positions/positions.interfaces.ts';

/** Eksekusi order. Return signature tx, atau null untuk paper trading. */
export interface TradeExecutor {
  readonly mode: TradeMode;
  buy(mint: string, amountSol: number, opts: TradeOptions): Promise<string | null>;
  sellAll(mint: string, opts: TradeOptions): Promise<string | null>;
}

export interface BuyCandidate {
  mint: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  price: number | null;
  mc: number | null;
}

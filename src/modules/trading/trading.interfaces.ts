import type { TradeOptions } from '../../integrations/pumpportal/pumpportal.types.ts';
import type { TradeMode } from '../positions/positions.interfaces.ts';

/** Eksekusi order. Return signature tx, atau null untuk paper trading. */
export interface TradeExecutor {
  readonly mode: TradeMode;
  /** Buy terbesar yang masih bisa dibayar wallet setelah fee; null kalau saldo dihitung di luar executor (paper). */
  maxBuySol(opts: TradeOptions): Promise<number | null>;
  buy(mint: string, amountSol: number, opts: TradeOptions): Promise<string | null>;
  /** Melempar NoTokensError kalau wallet tidak memegang token itu sama sekali. */
  sellAll(mint: string, opts: TradeOptions): Promise<string | null>;
}

/** Tidak ada yang bisa dijual: buy-nya dulu tidak pernah masuk ke wallet. */
export class NoTokensError extends Error {
  constructor() {
    super('token tidak ada di wallet (buy tidak pernah masuk on-chain)');
  }
}

export interface BuyCandidate {
  mint: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  price: number | null;
  mc: number | null;
}

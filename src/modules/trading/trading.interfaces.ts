import type { TradeOptions } from '../../integrations/pumpportal/pumpportal.types.ts';
import type { TradeMode } from '../positions/positions.interfaces.ts';
import type { WalletCredentials } from '../accounts/accounts.interfaces.ts';
import type { TokenInfo } from '../../integrations/gmgn/gmgn.types.ts';

/** Opsi order plus kredensial akun yang sedang trading. */
export type TradeContext = TradeOptions & WalletCredentials;

/** Eksekusi order. Return signature tx, atau null untuk paper trading. */
export interface TradeExecutor {
  readonly mode: TradeMode;
  /** Buy terbesar yang masih bisa dibayar wallet setelah fee; null kalau saldo dihitung di luar executor (paper). */
  maxBuySol(ctx: TradeContext): Promise<number | null>;
  buy(mint: string, amountSol: number, ctx: TradeContext): Promise<string | null>;
  /** Melempar NoTokensError kalau wallet tidak memegang token itu sama sekali. */
  sellAll(mint: string, ctx: TradeContext): Promise<string | null>;
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
  /** Kolom Token Info GMGN saat dibeli, disimpan di posisi. */
  info: TokenInfo | null;
}

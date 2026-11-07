import type { TradeOptions } from '../../integrations/pumpapi/pumpapi.types.ts';
import type { TradeMode } from '../positions/positions.interfaces.ts';
import type { WalletCredentials } from '../accounts/accounts.interfaces.ts';
import type { TokenInfo } from '../../integrations/gmgn/gmgn.types.ts';
import type { PriceSource } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { SwapFill } from './fills.ts';

/** Opsi order plus kredensial akun yang sedang trading. */
export type TradeContext = TradeOptions & WalletCredentials;

/** Order yang masuk on-chain. fill null kalau tx tidak bisa dibaca dari chain. */
export interface TradeTx {
  signature: string;
  fill: SwapFill | null;
}

/** Eksekusi order. null untuk paper trading. */
export interface TradeExecutor {
  readonly mode: TradeMode;
  /** Buy terbesar yang masih bisa dibayar wallet setelah fee; null kalau saldo dihitung di luar executor (paper). */
  maxBuySol(ctx: TradeContext): Promise<number | null>;
  buy(mint: string, amountSol: number, ctx: TradeContext): Promise<TradeTx | null>;
  /** Melempar NoTokensError kalau wallet tidak memegang token itu sama sekali. */
  sellAll(mint: string, ctx: TradeContext): Promise<TradeTx | null>;
  /** Hasil swap tx lama (mis. buy real saat posisi ditutup). */
  readFill(signature: string, mint: string, ctx: TradeContext): Promise<SwapFill | null>;
}

/** Harga SOL dibutuhkan untuk mengubah harga fill (SOL per token) ke USD. */
export interface TradingPriceSource extends PriceSource {
  getSolUsd(): Promise<number | null>;
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

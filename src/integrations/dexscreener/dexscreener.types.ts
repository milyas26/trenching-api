export interface DexPair {
  baseToken?: { address: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
}

export interface TokenQuote {
  priceUsd: number;
  marketCap: number | null;
  /** Asal harga: akun on-chain (pump, pumpswap) atau API Dexscreener. */
  source: 'pump' | 'pumpswap' | 'dexscreener';
}

/** Sumber harga yang dipakai monitor dan trading. Mint tanpa harga tidak muncul di Map hasil. */
export interface PriceSource {
  getQuotes(mints: string[]): Promise<Map<string, TokenQuote>>;
  getPrice(mint: string): Promise<number | null>;
}

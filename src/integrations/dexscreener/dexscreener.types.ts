type Windows<T> = Partial<Record<'m5' | 'h1' | 'h6' | 'h24', T>>;

export interface DexPair {
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  txns?: Windows<{ buys: number; sells: number }>;
  volume?: Windows<number>;
  priceChange?: Windows<number>;
  /** unix ms */
  pairCreatedAt?: number;
  info?: { websites?: { url: string }[]; socials?: { type: string; url: string }[] };
  boosts?: { active?: number };
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

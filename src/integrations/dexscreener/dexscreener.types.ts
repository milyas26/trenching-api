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
}

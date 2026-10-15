export type HotInterval = '1m' | '5m' | '1h' | '6h' | '24h';

export interface HotSearchFilter {
  chain: string;
  interval: HotInterval;
  limit: number;
  /** ribu USD, mis. 100 = $100K */
  minMc: number | null;
  maxMc: number | null;
  /** menit */
  minAge: number | null;
  maxAge: number | null;
}

/** Field mentah dari GMGN hot_searches (nama field disingkat oleh API-nya). */
export interface RawHotToken {
  a: string;
  s?: string;
  nm?: string;
  l?: string;
  p?: number;
  mc?: number;
  lq?: number;
  v?: number;
  pcp1h?: number;
  ct?: number;
  lpp?: string;
}

export interface HotToken {
  mint: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  price: number | null;
  mc: number | null;
  liquidity: number | null;
  volume: number | null;
  change1h: number | null;
  /** unix detik */
  createdAt: number | null;
  launchpad: string | null;
}

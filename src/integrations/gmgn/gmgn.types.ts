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
  /** rasio supply di 10 holder teratas, 0-1 */
  t10?: number;
  /** jumlah holder */
  hd?: number;
  /** 1 = mint authority sudah di-renounce */
  s_nm?: number;
  /** 1 = freeze authority sudah di-renounce */
  s_blk?: number;
  /** creator_hold | creator_close (dev sudah keluar) */
  d_ts?: string;
  /** rug ratio versi GMGN, 0-1 */
  rug?: number;
  snp?: number;
  smt?: number;
  kol?: number;
  iwt?: boolean;
  cto?: number;
}

/** Data holder dan keamanan dari GMGN; dipakai agent saat RPC tidak bisa membaca holder. */
export interface TokenSafety {
  top10HolderPct: number | null;
  holderCount: number | null;
  mintRenounced: boolean | null;
  freezeRenounced: boolean | null;
  creatorStatus: string | null;
  rugRatio: number | null;
  sniperCount: number | null;
  smartMoneyCount: number | null;
  kolCount: number | null;
  washTrading: boolean | null;
  communityTakeover: boolean | null;
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
  safety: TokenSafety;
}

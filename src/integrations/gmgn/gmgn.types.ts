export type HotInterval = '1m' | '5m' | '1h' | '6h' | '24h';

/** Endpoint GMGN yang dipakai sebagai sumber token. */
export const TOKEN_SOURCES = ['hot_searches', 'trending'] as const;
export type TokenSource = (typeof TOKEN_SOURCES)[number];
/** Nama sumber di log aktivitas, sama dengan label di app. */
export const TOKEN_SOURCE_LABEL: Record<TokenSource, string> = { hot_searches: 'Hot searches', trending: 'Trending' };

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
  pcp1m?: number;
  pcp5m?: number;
  bu?: number;
  se?: number;
  /** market cap tertinggi sepanjang sejarah */
  hhmc?: number;
  /** rasio bundler, 0-1 */
  bdrr?: number;
  /** rasio bot degen, 0-1 */
  bdr?: number;
  /** rasio trader yang terjebak (entrapment), 0-1 */
  etpr?: number;
  /** rasio yang masih dipegang 70 sniper pertama, 0-1 */
  t70_shr?: number;
  /** rasio rat trader (insider), 0-1 */
  rat?: number;
  /**
   * Bukan dev hold: nilainya hampir selalu sama dengan t70_shr dan tetap besar walau dev sudah jual.
   * Arti pastinya belum diketahui, jadi tidak dipakai.
   */
  dhr?: number;
  /** rasio supply yang masih dipegang dev, 0-1 (kolom DEV di GMGN; 0 setelah dev jual) */
  d_br?: number;
  /** jumlah wallet bot degen */
  bdc?: number;
  /** jumlah token lain dengan logo sama */
  img_dup?: string;
  /** jumlah boost DexScreener */
  dx_bf?: number;
  /** 1 = profil DexScreener sudah dibayar/di-update */
  dx_ul?: number;
  dx_ad?: number;
  /** berapa kali akun X ganti nama */
  xcc?: number;
}

/** Indikator tambahan GMGN untuk analisa AI: momentum, jarak dari ATH, risiko dump, copycat, promosi. Rasio sudah dalam persen. */
export interface TokenSignals {
  change1mPct: number | null;
  change5mPct: number | null;
  buys: number | null;
  sells: number | null;
  athMc: number | null;
  belowAthPct: number | null;
  bundlerPct: number | null;
  botDegenPct: number | null;
  entrapmentPct: number | null;
  top70SniperHoldPct: number | null;
  ratTraderPct: number | null;
  devTeamHoldPct: number | null;
  duplicateLogoCount: number | null;
  dexscreenerBoosts: number | null;
  dexscreenerPaidProfile: boolean | null;
  dexscreenerAd: boolean | null;
  xRenameCount: number | null;
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

/**
 * Kolom "Token Info" di tabel GMGN, dalam persen. GMGN tidak menyediakan filter untuk ini,
 * jadi disaring setelah fetch (lihat token-filter.ts).
 */
export interface TokenInfo {
  top10Pct: number | null;
  devHoldPct: number | null;
  /** Dev sudah menjual semua (label "DS" di GMGN). */
  devSold: boolean | null;
  insiderPct: number | null;
  bundlerPct: number | null;
  phishingPct: number | null;
  sniperPct: number | null;
  dexPaid: boolean | null;
  communityTakeover: boolean | null;
  botDegenCount: number | null;
  botDegenPct: number | null;
  /** Perkiraan GMGN peluang token di-rug ("Rug %" di halaman token). */
  rugPct: number | null;
}

/** Hasil satu panggilan hot_searches: response apa adanya (tanpa list token) dan token yang sudah dipetakan. */
export interface HotScan {
  response: Record<string, unknown>;
  tokens: HotToken[];
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
  signals: TokenSignals;
  info: TokenInfo;
  /** Objek GMGN apa adanya, termasuk field yang tidak dipetakan di atas; disimpan ke token_snapshots. */
  raw: Record<string, unknown>;
}

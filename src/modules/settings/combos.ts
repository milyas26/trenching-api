import type { HotToken } from '../../integrations/gmgn/gmgn.types.ts';

/**
 * Win cluster dari analysis-4 (REPORT-AI-VS-NONAI.md), dipisah per grup akun asal: `ai` ditemukan di akun dengan
 * cek AI aktif, `nonAi` di akun tanpa AI. Batas bawah inklusif, batas atas eksklusif, sama dengan bin analisa.
 * Data yang tidak ada (null) selalu dianggap tidak cocok.
 */
export type ComboGroup = 'ai' | 'nonAi';

interface ComboDef {
  id: string;
  group: ComboGroup;
  label: string;
  /** Hasil di data analisa (trade profit / semua trade), ditampilkan di app sebagai konteks. */
  win: number;
  trades: number;
  match: (t: HotToken) => boolean;
}

const inRange = (v: number | null | undefined, min: number, max = Infinity) => v != null && v >= min && v < max;
/** Transaksi 1 jam dari DexScreener; di analisa ini kolom buys1h / sells1h_dex. */
const dexBuys = (t: HotToken) => t.info.dexTxns1h?.buys ?? null;
const dexSells = (t: HotToken) => t.info.dexTxns1h?.sells ?? null;
const dexRatio = (t: HotToken) => {
  const tx = t.info.dexTxns1h;
  return tx && tx.sells > 0 ? tx.buys / tx.sells : null;
};
const top10CtoNo = (t: HotToken) => inRange(t.info.top10Pct, 30) && t.info.communityTakeover === false;
const devsoldNoPhishing2 = (t: HotToken) => t.info.devSold === false && inRange(t.info.phishingPct, 0, 2);

export const COMBOS: ComboDef[] = [
  { id: 'ai-mc-180-250', group: 'ai', label: 'MC 180–250K', win: 13, trades: 17,
    match: (t) => inRange(t.mc, 180_000, 250_000) },
  { id: 'ai-sniper0-devsold-no', group: 'ai', label: 'Sniper 0% + dev belum jual', win: 16, trades: 22,
    match: (t) => inRange(t.info.sniperPct, 0, 0.1) && t.info.devSold === false },
  { id: 'ai-pc1h3k-buys1-2.5k', group: 'ai', label: 'Naik 1 jam ≥3.000% + buys 1–2,5K', win: 12, trades: 17,
    match: (t) => inRange(t.info.change1hPct, 3000) && inRange(dexBuys(t), 1000, 2500) },
  { id: 'ai-kol3-buys2.5k', group: 'ai', label: 'KOL ≥3 + buys ≥2,5K', win: 18, trades: 26,
    match: (t) => inRange(t.info.kolCount, 3) && inRange(dexBuys(t), 2500) },
  { id: 'ai-pc1h3k-smart5-15', group: 'ai', label: 'Naik 1 jam ≥3.000% + smart money 5–14', win: 13, trades: 19,
    match: (t) => inRange(t.info.change1hPct, 3000) && inRange(t.info.smartMoneyCount, 5, 15) },
  { id: 'ai-top10-15-22-cto', group: 'ai', label: 'Top 10 15–22% + CTO', win: 16, trades: 25,
    match: (t) => inRange(t.info.top10Pct, 15, 22) && t.info.communityTakeover === true },

  { id: 'nonai-smart5-15-devsold-no', group: 'nonAi', label: 'Smart money 5–14 + dev belum jual', win: 25, trades: 34,
    match: (t) => inRange(t.info.smartMoneyCount, 5, 15) && t.info.devSold === false },
  /**
   * Versi ketat dari kombo di atas: bundler <10%. Statistik katalog dari database micin-agent
   * (semua akun, semua trade closed): 49 dari 96 trade profit, net -1,43 SOL. Di thearc subset
   * ini 8 dari 9 trade profit (+3,97 SOL), tapi data micin-agent belum menunjukkan profit bersih.
   */
  { id: 'nonai-smart5-15-devsold-no-bundler10', group: 'nonAi', label: 'Smart money 5–14 + dev belum jual + bundler <10%', win: 49, trades: 96,
    match: (t) => inRange(t.info.smartMoneyCount, 5, 15) && t.info.devSold === false && inRange(t.info.bundlerPct, 0, 10) },
  { id: 'nonai-top10-30-devsold-no', group: 'nonAi', label: 'Top 10 ≥30% + dev belum jual', win: 16, trades: 22,
    match: (t) => inRange(t.info.top10Pct, 30) && t.info.devSold === false },
  { id: 'nonai-top10-30-buys300-1k', group: 'nonAi', label: 'Top 10 ≥30% + buys 300–999', win: 13, trades: 18,
    match: (t) => inRange(t.info.top10Pct, 30) && inRange(dexBuys(t), 300, 1000) },
  /**
   * Pola A/B dari analisa 442 trade: A = 29/44, B = 34/59, gabungan A atau B = 59/95 (+7,22 SOL).
   * Statistik memakai basis analisa yang sama dengan kombo lama. Uji holdout 761 trade belum
   * mengonfirmasi hasil ini, jadi anggap hipotesis. Pilih kombo gabungan kalau mau A dan B sekaligus:
   * kalau A dan B dicentang bersamaan, token yang cocok keduanya dilewati sebagai ambigu.
   */
  { id: 'nonai-top10-30-cto-no', group: 'nonAi', label: 'Top 10 ≥30% + bukan CTO', win: 29, trades: 44,
    match: top10CtoNo },
  { id: 'nonai-devsold-no-phishing2', group: 'nonAi', label: 'Dev belum jual + phishing <2%', win: 34, trades: 59,
    match: devsoldNoPhishing2 },
  { id: 'nonai-top10-30-cto-no-or-devsold-no-phishing2', group: 'nonAi', label: 'Top 10 ≥30% + bukan CTO, atau dev belum jual + phishing <2%', win: 59, trades: 95,
    match: (t) => top10CtoNo(t) || devsoldNoPhishing2(t) },
  { id: 'nonai-swaps300-ratio1.2', group: 'nonAi', label: 'Swaps <300 + rasio buy/sell <1,2', win: 20, trades: 31,
    match: (t) => inRange(t.info.swaps1h, 0, 300) && inRange(dexRatio(t), 0, 1.2) },
  { id: 'nonai-sells300-devsold-no', group: 'nonAi', label: 'Sells <300 + dev belum jual', win: 27, trades: 42,
    match: (t) => inRange(dexSells(t), 0, 300) && t.info.devSold === false },
  { id: 'nonai-devsold-no-cto-no', group: 'nonAi', label: 'Dev belum jual + bukan CTO', win: 45, trades: 75,
    match: (t) => t.info.devSold === false && t.info.communityTakeover === false },
  /**
   * Kombo momentum dari data live 233 trade (26-28 Okt): seluruh rugi datang dari kuartil change1h terendah
   * (WR 26%, avg -29%, -16,8 SOL), sementara sisanya (n=175) WR 50,9% dan +2,5 SOL. Token sepi (swaps1h <330,
   * -19% avg) juga di bawah ambang ini, jadi gate aktivitas terpisah tidak menambah apa-apa.
   */
  { id: 'nonai-hot-momentum', group: 'nonAi', label: 'Naik 1 jam ≥1.250%', win: 89, trades: 175,
    match: (t) => inRange(t.info.change1hPct, 1250) },
  /** Versi lebih ketat: momentum sama tapi bot degen dibatasi (WR 57% di 99 trade pada data yang sama). */
  { id: 'nonai-hot-clean', group: 'nonAi', label: 'Naik 1 jam ≥1.250% + bot degen <40%', win: 56, trades: 99,
    match: (t) => inRange(t.info.change1hPct, 1250) && inRange(t.info.botDegenPct, 0, 40) },
  /**
   * "Sweet spot" pump dari 134 trade akun ab-hot: hampir semua fitur berbentuk U terbalik, dua ujungnya rugi.
   * - change1h 1.700-3.000%: di bawahnya belum ada permintaan, di atasnya sudah blow-off (avg -4.8% di >2.600%).
   * - sells1h ≤1.150: sisi jual belum padat; >1.150 avg -13.3%.
   * - smart money 3-27: kosong = tidak ada yang minat, >27 = sudah rame/terlambat (avg -13.8%).
   * Hasil di data itu: 49 dari 134 trade (37%), WR 77,6%, avg +15,0%/trade, net +6,35 SOL sesudah fee 2%.
   */
  { id: 'nonai-hot-quality', group: 'nonAi', label: 'Sweet spot: naik 1 jam 1.700–3.000% + sells ≤1.150 + SM 3–27', win: 38, trades: 49,
    match: (t) => inRange(t.info.change1hPct, 1700, 3000) && inRange(t.info.sells1h, 0, 1151) && inRange(t.info.smartMoneyCount, 3, 28) },
];

const idsOf = (group: ComboGroup) => COMBOS.filter((c) => c.group === group).map((c) => c.id) as [string, ...string[]];
export const AI_COMBO_IDS = idsOf('ai');
export const NON_AI_COMBO_IDS = idsOf('nonAi');

/** Katalog untuk app (tanpa fungsi match). */
export const comboCatalog = () => COMBOS.map(({ id, group, label, win, trades }) => ({ id, group, label, win, trades }));

/** Semua trade di data analisa punya smart money >= 2 (gate lama), jadi token di bawahnya tidak pernah diuji. */
const MIN_SMART_MONEY = 2;

/** Kombo terpilih yang cocok dengan token, urut sesuai katalog. */
export function matchCombos(token: HotToken, selected: readonly string[]): ComboDef[] {
  if (!inRange(token.info.smartMoneyCount, MIN_SMART_MONEY)) return [];
  return COMBOS.filter((c) => selected.includes(c.id) && c.match(token));
}

/** Label kombo untuk log, dari id yang tersimpan di token.info. */
export const comboLabels = (ids: readonly string[] = []) =>
  ids.map((id) => COMBOS.find((c) => c.id === id)?.label ?? id).join(', ');

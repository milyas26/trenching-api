import type { DexPair } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { Candle } from '../../integrations/geckoterminal/geckoterminal.types.ts';

/** Candle 1 menit yang dinilai. */
export const CHART_WINDOW = 30;
/**
 * Chart tangga buatan bot: candle hijau beruntun tanpa satu pun koreksi, tiap body kecil dan rata.
 * Contoh ELON (DbeQ…i655): 24 candle hijau dengan body +0,3% s/d +4%, lalu rug -99% dalam satu menit.
 */
const STAIRCASE_MIN_STREAK = 8;
const STAIRCASE_MAX_BODY_PCT = 6;
/** Volume dari micro-trade bot: ELON rata-rata $2,7 per trade dari 23 ribu transaksi. */
const MIN_AVG_TRADE_USD = 5;
const MIN_TXNS_FOR_TRADE_SIZE = 300;

export interface ChartStats {
  /** Candle 1 menit yang sudah selesai di window. null kalau candle tidak tersedia. */
  candles: number | null;
  /** Candle hijau beruntun dihitung mundur dari candle terakhir yang selesai. */
  greenStreak: number | null;
  /** Body terbesar (%) di dalam streak hijau itu. */
  streakMaxBodyPct: number | null;
  redCandles: number | null;
  windowChangePct: number | null;
  /** Koefisien variasi volume per menit; rendah = volume terlalu rata. */
  volumeCv: number | null;
  /** Body (%) dan volume USD 10 candle terakhir, lama ke baru. */
  recent: { bodyPct: number; volumeUsd: number }[];
  avgTradeUsd: number | null;
  tradeSizeWindow: 'h1' | 'h6' | null;
  txns: number | null;
  /** Kosong = tidak ada pola bot. Isinya alasan untuk log dan agent. */
  botFlags: string[];
  candleError?: string;
}

const round = (n: number, digits = 2) => Number(n.toFixed(digits));
const bodyPct = (c: Candle) => (c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0);

export function analyzeChart(candles: Candle[] | null, pair: DexPair, nowSec: number): ChartStats {
  const flags: string[] = [];
  const stats: ChartStats = {
    candles: null, greenStreak: null, streakMaxBodyPct: null, redCandles: null, windowChangePct: null,
    volumeCv: null, recent: [], avgTradeUsd: null, tradeSizeWindow: null, txns: null, botFlags: flags,
  };

  // Candle menit berjalan belum selesai, warnanya masih bisa berubah.
  const closed = (candles ?? []).filter((c) => c.at + 60 <= nowSec).slice(-CHART_WINDOW);
  if (closed.length > 0) {
    let streak = 0;
    let streakMax = 0;
    for (let i = closed.length - 1; i >= 0; i--) {
      const body = bodyPct(closed[i]!);
      if (body < 0) break;
      streak++;
      streakMax = Math.max(streakMax, body);
    }
    const volumes = closed.map((c) => c.volumeUsd);
    const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const sd = Math.sqrt(volumes.reduce((a, v) => a + (v - mean) ** 2, 0) / volumes.length);

    Object.assign(stats, {
      candles: closed.length,
      greenStreak: streak,
      streakMaxBodyPct: round(streakMax),
      redCandles: closed.filter((c) => bodyPct(c) < 0).length,
      windowChangePct: closed[0]!.open > 0 ? round((closed.at(-1)!.close / closed[0]!.open - 1) * 100) : null,
      volumeCv: mean > 0 ? round(sd / mean) : null,
      recent: closed.slice(-10).map((c) => ({ bodyPct: round(bodyPct(c)), volumeUsd: Math.round(c.volumeUsd) })),
    });
    if (streak >= STAIRCASE_MIN_STREAK && streakMax <= STAIRCASE_MAX_BODY_PCT) {
      flags.push(`${streak} candle 1m hijau beruntun tanpa koreksi, body maks +${round(streakMax, 1)}% (pola tangga bot)`);
    }
  }

  // Token di bawah 1 jam: h1 dan h6 isinya sama. Pakai h6 kalau h1 terlalu sepi untuk dirata-rata.
  const windowOf = (w: 'h1' | 'h6') => {
    const t = pair.txns?.[w];
    return { w, txns: t ? t.buys + t.sells : 0, volume: pair.volume?.[w] ?? 0 };
  };
  const h1 = windowOf('h1');
  const trade = h1.txns >= MIN_TXNS_FOR_TRADE_SIZE ? h1 : windowOf('h6');
  if (trade.txns > 0) {
    const avg = trade.volume / trade.txns;
    Object.assign(stats, { avgTradeUsd: round(avg), tradeSizeWindow: trade.w, txns: trade.txns });
    if (trade.txns >= MIN_TXNS_FOR_TRADE_SIZE && avg < MIN_AVG_TRADE_USD) {
      flags.push(`rata-rata trade $${round(avg)} dari ${trade.txns} transaksi ${trade.w} (volume dari micro-trade bot)`);
    }
  }
  return stats;
}

import { z } from 'zod';
import { PUMP_POOLS } from '../../integrations/pumpportal/pumpportal.types.ts';
import { TOKEN_SOURCES } from '../../integrations/gmgn/gmgn.types.ts';

const nullableNumber = z.coerce.number().min(0).nullable();
const nullablePct = z.coerce.number().min(0).max(100).nullable();

export const hotSearchFilterSchema = z.object({
  chain: z.string().min(1).default('sol'),
  interval: z.enum(['1m', '5m', '1h', '6h', '24h']).default('1h'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  minMc: nullableNumber.default(null),
  maxMc: nullableNumber.default(null),
  minAge: nullableNumber.default(null),
  maxAge: nullableNumber.default(null),
});

/**
 * Filter kolom "Token Info" GMGN, diterapkan setelah fetch karena API GMGN tidak punya filternya.
 * null / false = tidak disaring. Token tanpa data untuk filter yang aktif ikut ditolak.
 */
export const tokenFilterSchema = z.object({
  maxTop10Pct: nullablePct.default(null),
  maxDevHoldPct: nullablePct.default(null),
  devSoldOnly: z.boolean().default(false),
  maxInsiderPct: nullablePct.default(null),
  maxBundlerPct: nullablePct.default(null),
  maxPhishingPct: nullablePct.default(null),
  maxSniperPct: nullablePct.default(null),
  dexPaidOnly: z.boolean().default(false),
  maxBotDegenCount: z.coerce.number().int().min(0).nullable().default(null),
  maxBotDegenPct: nullablePct.default(null),
  /** "Rug %" GMGN: perkiraan peluang token di-rug. */
  maxRugPct: nullablePct.default(null),
  /**
   * Batas atas perubahan harga 1 jam terakhir (`pcp1h` GMGN). Analisa 7 hari: <= 500% menaikkan win rate
   * di dua akun (trending-ai 68% -> 83%, set-final 50% -> 75%). Bisa ribuan persen, jadi bukan nullablePct.
   */
  maxPc1hPct: nullableNumber.default(null),
  maxSmartMoney: z.coerce.number().int().min(0).nullable().default(null),
  /** Hanya token bertag OG di GMGN. */
  ogOnly: z.boolean().default(false),
  /** Batas bawah aktivitas 1 jam terakhir dan jumlah wallet KOL / smart money. */
  minSells1h: z.coerce.number().int().min(0).nullable().default(null),
  minSwaps1h: z.coerce.number().int().min(0).nullable().default(null),
  minKol: z.coerce.number().int().min(0).nullable().default(null),
  minSmartMoney: z.coerce.number().int().min(0).nullable().default(null),
  /**
   * Filter dari pair DexScreener (likuiditas terbesar), dicek setelah filter GMGN di atas.
   * Rasio = jumlah transaksi buy / sell 1 jam terakhir; liq/MC = likuiditas USD / market cap.
   */
  maxBuySellRatio1h: z.coerce.number().positive().nullable().default(null),
  minSocials: z.coerce.number().int().min(0).nullable().default(null),
  minLiqMcRatio: z.coerce.number().min(0).nullable().default(null),
});

/**
 * Take profit khusus token OG yang dibeli di market cap <= maxMc (ribu USD, null = berapa pun).
 * takeProfitPct null = aturan mati, token OG memakai take profit biasa.
 */
export const ogRuleSchema = z.object({
  maxMc: nullableNumber.default(null),
  takeProfitPct: z.coerce.number().positive().nullable().default(null),
});

export const botSettingsSchema = z.object({
  botEnabled: z.boolean().default(false),
  mode: z.enum(['paper', 'real']).default('paper'),

  buyAmountSol: z.coerce.number().positive().default(0.05),
  takeProfitPct: z.coerce.number().positive().default(50),
  stopLossPct: z.coerce.number().gt(0).lt(100).default(20),
  /** 0 = mati. Close paksa saat market cap turun ke X ribu USD, walau stop loss % belum kena. */
  stopLossMc: z.coerce.number().min(0).default(0),
  /** 0 = mati. Jual kalau harga turun X% dari harga tertinggi. */
  trailingStopPct: z.coerce.number().min(0).lt(100).default(0),
  /** 0 = mati. Close paksa setelah X menit. */
  maxHoldMinutes: z.coerce.number().min(0).default(0),

  maxOpenPositions: z.coerce.number().int().min(1).default(5),
  maxBuysPerScan: z.coerce.number().int().min(1).default(3),

  scanIntervalSec: z.coerce.number().int().min(10).default(60),
  priceIntervalSec: z.coerce.number().int().min(3).default(10),

  slippagePct: z.coerce.number().min(0).max(100).default(15),
  priorityFeeSol: z.coerce.number().min(0).default(0.0005),
  pool: z.enum(PUMP_POOLS as [string, ...string[]]).default('auto'),

  /** Token dicek AI agent (DeepSeek) sebelum buy; false = langsung buy semua yang lolos filter. */
  aiAgentEnabled: z.boolean().default(true),
  /** 0 = mati. Buy dari AI ditolak kalau harga naik kurang dari X% antara sampel pertama dan recheck terakhir. */
  minRecheckGainPct: z.coerce.number().min(0).default(10),
  /**
   * Token yang di-BUY AI untuk akun lain kurang dari reuseMaxAgeMinutes lalu langsung dibeli dengan analisa itu,
   * selama harganya sekarang tidak turun lebih dari reuseMaxDropPct atau naik lebih dari reuseMaxRisePct
   * dari harga saat analisa. false = selalu review sendiri.
   */
  reuseRecentReview: z.boolean().default(false),
  reuseMaxAgeMinutes: z.coerce.number().positive().max(24 * 60).default(5),
  reuseMaxDropPct: z.coerce.number().min(0).max(100).default(20),
  reuseMaxRisePct: z.coerce.number().min(0).default(40),

  paperStartBalanceSol: z.coerce.number().min(0).default(10),

  source: z.enum(TOKEN_SOURCES).default('hot_searches'),
  filter: hotSearchFilterSchema.default(hotSearchFilterSchema.parse({})),
  tokenFilter: tokenFilterSchema.default(tokenFilterSchema.parse({})),
  ogRule: ogRuleSchema.default(ogRuleSchema.parse({})),
});

/**
 * Zod 4 tetap mengisi .default() di field yang dibuat optional lewat .partial(),
 * jadi patch parsial akan menimpa field lain dengan default. Default dibuang dulu.
 */
function withoutDefaults<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [key, field instanceof z.ZodDefault ? field.unwrap() : field]),
  );
  return z.object(shape as { [K in keyof S]: S[K] extends z.ZodDefault<infer T> ? T : S[K] }).partial();
}

/** Payload PUT /settings: semua field opsional, botEnabled diatur lewat /bot/start|stop. */
export const settingsPatchSchema = withoutDefaults(botSettingsSchema.omit({ botEnabled: true, filter: true, tokenFilter: true, ogRule: true }))
  .extend({
    filter: withoutDefaults(hotSearchFilterSchema).optional(),
    tokenFilter: withoutDefaults(tokenFilterSchema).optional(),
    ogRule: withoutDefaults(ogRuleSchema).optional(),
  })
  .strict();

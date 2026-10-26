import { z } from 'zod';
import { PUMP_POOLS } from '../../integrations/pumpportal/pumpportal.types.ts';
import { TOKEN_SOURCES } from '../../integrations/gmgn/gmgn.types.ts';
import { AI_COMBO_IDS, NON_AI_COMBO_IDS } from './combos.ts';

const nullableNumber = z.coerce.number().min(0).nullable();

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
 * Kombo win cluster per mode AI (lihat combos.ts). Token dibeli kalau cocok dengan salah satu kombo terpilih
 * di daftar yang aktif: `ai` saat aiAgentEnabled, `nonAi` saat tidak. Daftar kosong = tidak ada buy.
 */
export const combosSchema = z.object({
  ai: z.array(z.enum(AI_COMBO_IDS)).default([]),
  nonAi: z.array(z.enum(NON_AI_COMBO_IDS)).default([]),
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

  /** sol = buyAmountSol tetap; pct = buyAmountPct % dari saldo tersedia (paper: saldo simulasi, real: saldo wallet setelah fee). */
  buySizeMode: z.enum(['sol', 'pct']).default('sol'),
  buyAmountSol: z.coerce.number().positive().default(0.05),
  buyAmountPct: z.coerce.number().gt(0).max(100).default(10),
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

  /** Token yang cocok kombo dicek AI agent (DeepSeek) sebelum buy; false = langsung buy. Juga memilih daftar kombo yang dipakai. */
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
  combos: combosSchema.default(combosSchema.parse({})),
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
export const settingsPatchSchema = withoutDefaults(botSettingsSchema.omit({ botEnabled: true, filter: true, combos: true, ogRule: true }))
  .extend({
    filter: withoutDefaults(hotSearchFilterSchema).optional(),
    combos: withoutDefaults(combosSchema).optional(),
    ogRule: withoutDefaults(ogRuleSchema).optional(),
  })
  .strict();

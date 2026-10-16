import { z } from 'zod';
import { PUMP_POOLS } from '../../integrations/pumpportal/pumpportal.types.ts';

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

export const botSettingsSchema = z.object({
  botEnabled: z.boolean().default(false),
  mode: z.enum(['paper', 'real']).default('paper'),

  buyAmountSol: z.coerce.number().positive().default(0.05),
  takeProfitPct: z.coerce.number().positive().default(50),
  stopLossPct: z.coerce.number().gt(0).lt(100).default(20),
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

  paperStartBalanceSol: z.coerce.number().min(0).default(10),

  filter: hotSearchFilterSchema.default(hotSearchFilterSchema.parse({})),
});

/** Payload PUT /settings: semua field opsional, botEnabled diatur lewat /bot/start|stop. */
export const settingsPatchSchema = botSettingsSchema
  .omit({ botEnabled: true, filter: true })
  .partial()
  .extend({ filter: hotSearchFilterSchema.partial().optional() })
  .strict();

import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accountIdOf } from '../../common/account.ts';
import { HISTORY_FLAG_KEYS, HISTORY_RANGE_KEYS, type HistoryRanges } from './positions.interfaces.ts';
import type { PositionsService } from './positions.service.ts';
import type { TradingService } from '../trading/trading.service.ts';

const listQuery = z.object({
  view: z.enum(['open', 'closed']).optional(),
  mode: z.enum(['paper', 'real']).optional(),
});
const historyQuery = z.object({
  mode: z.enum(['paper', 'real']).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
/** Tiap filter range dikirim sebagai <key>Min dan <key>Max, mis. top10PctMax=30. */
const rangeQuery = z.object(Object.fromEntries(
  HISTORY_RANGE_KEYS.flatMap((k) => [`${k}Min`, `${k}Max`]).map((k) => [k, z.coerce.number().finite().optional()]),
));
/** Filter boolean dikirim sebagai <key>=true / <key>=false, mis. dexPaid=true. */
const flagQuery = z.object(Object.fromEntries(
  HISTORY_FLAG_KEYS.map((k) => [k, z.enum(['true', 'false']).transform((v) => v === 'true').optional()]),
)) as z.ZodType<Partial<Record<(typeof HISTORY_FLAG_KEYS)[number], boolean>>>;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');
const dailyQuery = z.object({
  mode: z.enum(['paper', 'real']),
  tz: z.string().max(64).refine(isTimeZone, 'Zona waktu tidak dikenal').default('UTC'),
  from: isoDate,
  to: isoDate,
}).refine((q) => q.from <= q.to, { message: 'harus sebelum atau sama dengan to', path: ['from'] });
const idParams = z.object({ id: z.coerce.number().int().positive() });

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseRanges(query: unknown): HistoryRanges {
  const raw = rangeQuery.parse(query) as Record<string, number | undefined>;
  const ranges: HistoryRanges = {};
  for (const key of HISTORY_RANGE_KEYS) {
    const min = raw[`${key}Min`];
    const max = raw[`${key}Max`];
    if (min !== undefined || max !== undefined) ranges[key] = { min, max };
  }
  return ranges;
}

export class PositionsController {
  constructor(
    private readonly positions: PositionsService,
    private readonly trading: TradingService,
  ) {}

  list = (req: FastifyRequest) => this.positions.list({ accountId: accountIdOf(req), ...listQuery.parse(req.query) });

  history = (req: FastifyRequest) =>
    this.positions.history({
      accountId: accountIdOf(req),
      ...historyQuery.parse(req.query),
      ranges: parseRanges(req.query),
      flags: flagQuery.parse(req.query),
    });

  daily = (req: FastifyRequest) => this.positions.daily({ accountId: accountIdOf(req), ...dailyQuery.parse(req.query) });

  buyReason = (req: FastifyRequest) => this.positions.buyReason(accountIdOf(req), idParams.parse(req.params).id);

  close = async (req: FastifyRequest) => {
    const { id } = idParams.parse(req.params);
    await this.trading.close(id, 'manual');
    return { ok: true };
  };
}

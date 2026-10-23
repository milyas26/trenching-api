import { Prisma } from '../../generated/prisma/client.ts';
import type { PrismaClient } from '../../lib/prisma.ts';
import {
  ACTIVE_STATUSES, FINISHED_STATUSES, HISTORY_FLAG_KEYS, HISTORY_TOKEN_INFO_KEYS,
  type BuyReasonDto, type ClosedPositionData, type DailyPnl, type DailyPnlQuery, type HistoryRangeKey, type HistorySummary, type IPositionsRepository, type ListPositionsQuery,
  type ModeStats, type NewPosition, type OpenedPositionData, type Position, type PositionHistoryQuery, type TradeMode,
} from './positions.interfaces.ts';

/** Hanya nilai JSON bertipe number yang di-cast, supaya data lama yang aneh tidak membuat query error. */
function tokenInfoNum(...path: string[]) {
  const parent = ['token_info', ...path.slice(0, -1).map((k) => `'${k}'`)].join('->');
  const key = `'${path.at(-1)}'`;
  return `CASE WHEN jsonb_typeof(${parent}->${key}) = 'number' THEN (${parent}->>${key})::float8 END`;
}

const txnsRatio = (key: string) => `${tokenInfoNum(key, 'buys')} / NULLIF(${tokenInfoNum(key, 'sells')}, 0)`;

/**
 * Ekspresi SQL tiap filter range. Semuanya konstanta (bukan input user), jadi aman dipakai lewat Prisma.raw.
 * Rasio buy/sell mengikuti chip di app: data DexScreener, GMGN hanya kalau DexScreener tidak ada.
 */
const RANGE_SQL: Record<HistoryRangeKey, string> = {
  ...Object.fromEntries(HISTORY_TOKEN_INFO_KEYS.map((k) => [k, tokenInfoNum(k)])) as Record<(typeof HISTORY_TOKEN_INFO_KEYS)[number], string>,
  buySellRatio1h: `CASE WHEN jsonb_typeof(token_info->'dexTxns1h') = 'object' THEN ${txnsRatio('dexTxns1h')} ELSE ${txnsRatio('gmgnTxns1h')} END`,
  entryMc: 'entry_mc',
  // Sama dengan umur token di kartu posisi: dari createdAt token sampai posisi dibuka.
  tokenAgeMinutes: `(EXTRACT(EPOCH FROM opened_at) - ${tokenInfoNum('createdAt')}) / 60`,
  holdMinutes: 'EXTRACT(EPOCH FROM (closed_at - opened_at)) / 60',
};

/** Kondisi WHERE riwayat (akun, status selesai, mode, range, flag), dipakai daftar dan ringkasan. */
function historyConditions({ accountId, mode, ranges, flags }: Omit<PositionHistoryQuery, 'cursor' | 'limit'>) {
  const conditions = [
    Prisma.sql`account_id = ${accountId}`,
    Prisma.sql`status::text IN (${Prisma.join(FINISHED_STATUSES)})`,
  ];
  if (mode) conditions.push(Prisma.sql`mode::text = ${mode}`);
  for (const [key, { min, max } = {}] of Object.entries(ranges) as [HistoryRangeKey, { min?: number; max?: number }][]) {
    const expr = Prisma.raw(`(${RANGE_SQL[key]})`);
    if (min !== undefined) conditions.push(Prisma.sql`${expr} >= ${min}`);
    if (max !== undefined) conditions.push(Prisma.sql`${expr} <= ${max}`);
  }
  // Perbandingan jsonb: null atau field yang tidak ada tidak sama dengan true maupun false.
  for (const key of HISTORY_FLAG_KEYS) {
    const value = flags[key];
    if (value !== undefined) conditions.push(Prisma.sql`token_info->${key} = to_jsonb(${value}::boolean)`);
  }
  return conditions;
}

export class PositionsRepository implements IPositionsRepository {
  constructor(private readonly db: PrismaClient) {}

  list({ accountId, view, mode }: ListPositionsQuery, limit: number) {
    return this.db.position.findMany({
      where: {
        accountId,
        mode,
        status: view === 'open' ? { in: ACTIVE_STATUSES } : view === 'closed' ? { in: FINISHED_STATUSES } : undefined,
      },
      orderBy: [{ closedAt: { sort: 'desc', nulls: 'first' } }, { openedAt: 'desc' }],
      take: limit,
    });
  }

  /**
   * Filter range butuh ekspresi yang tidak bisa ditulis lewat Prisma (field JSON di-cast, selisih dua kolom),
   * jadi id dicari dengan SQL lalu barisnya diambil lewat Prisma. closedAt selalu terisi untuk closed/failed,
   * jadi (closed_at, id) aman sebagai kunci cursor.
   */
  async history(query: PositionHistoryQuery) {
    const conditions = historyConditions(query);
    if (query.cursor) {
      conditions.push(Prisma.sql`(closed_at, id) < (SELECT closed_at, id FROM positions WHERE id = ${query.cursor})`);
    }

    const ids = (await this.db.$queryRaw<{ id: number }[]>`
      SELECT id FROM positions WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY closed_at DESC, id DESC LIMIT ${query.limit}
    `).map((r) => r.id);
    const rows = await this.db.position.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  /** Win dan loss dihitung seperti statistik mode di Ringkasan: hanya posisi closed, PnL tepat 0 bukan keduanya. */
  async historySummary(query: Omit<PositionHistoryQuery, 'cursor' | 'limit'>): Promise<HistorySummary> {
    const closed = Prisma.raw(`status::text = 'closed'`);
    const [row] = await this.db.$queryRaw<HistorySummary[]>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE ${closed})::int AS closed,
        count(*) FILTER (WHERE status::text = 'failed')::int AS failed,
        count(*) FILTER (WHERE ${closed} AND pnl_sol > 0)::int AS wins,
        count(*) FILTER (WHERE ${closed} AND pnl_sol < 0)::int AS losses,
        COALESCE(sum(pnl_sol) FILTER (WHERE ${closed} AND pnl_sol > 0), 0)::float8 AS "profitSol",
        COALESCE(sum(pnl_sol) FILTER (WHERE ${closed} AND pnl_sol < 0), 0)::float8 AS "lossSol",
        COALESCE(sum(pnl_sol) FILTER (WHERE ${closed}), 0)::float8 AS "netSol",
        (avg(pnl_sol) FILTER (WHERE ${closed}))::float8 AS "avgPnlSol",
        (avg(pnl_pct) FILTER (WHERE ${closed}))::float8 AS "avgPnlPct",
        (max(pnl_pct) FILTER (WHERE ${closed}))::float8 AS "bestPnlPct",
        (min(pnl_pct) FILTER (WHERE ${closed}))::float8 AS "worstPnlPct",
        (avg(${Prisma.raw(RANGE_SQL.holdMinutes)}) FILTER (WHERE ${closed}))::float8 AS "avgHoldMinutes"
      FROM positions WHERE ${Prisma.join(historyConditions(query), ' AND ')}
    `;
    return row!;
  }

  /** closed_at disimpan tanpa zona waktu (UTC), jadi dibaca sebagai UTC dulu sebelum diubah ke tz. */
  dailyPnl({ accountId, mode, tz, from, to, ranges, flags }: DailyPnlQuery) {
    const day = Prisma.sql`((closed_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;
    return this.db.$queryRaw<DailyPnl[]>`
      SELECT
        to_char(${day}, 'YYYY-MM-DD') AS date,
        count(*)::int AS closed,
        count(*) FILTER (WHERE pnl_sol > 0)::int AS wins,
        count(*) FILTER (WHERE pnl_sol < 0)::int AS losses,
        COALESCE(sum(pnl_sol), 0)::float8 AS "pnlSol"
      FROM positions
      WHERE ${Prisma.join(historyConditions({ accountId, mode, ranges, flags }), ' AND ')}
        AND status::text = 'closed' AND closed_at IS NOT NULL
        AND ${day} BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1
      ORDER BY 1
    `;
  }

  async boughtMints(accountId: number) {
    const rows = await this.db.position.findMany({ where: { accountId }, distinct: ['mint'], select: { mint: true } });
    return new Set(rows.map((r) => r.mint));
  }

  countActive(accountId: number, mode?: TradeMode) {
    return this.db.position.count({ where: { accountId, mode, status: { in: ACTIVE_STATUSES } } });
  }

  findForAccount(id: number, accountId: number) {
    return this.db.position.findFirst({ where: { id, accountId } });
  }

  async buyReason({ accountId, mint, openedAt }: Pick<Position, 'accountId' | 'mint' | 'openedAt'>): Promise<BuyReasonDto | null> {
    // Tanpa filter mode: mode akun bisa diganti selama review AI berjalan, dan satu mint hanya dibeli sekali per akun.
    const row = await this.db.tokenSnapshot.findFirst({
      where: { accountId, mint, decision: { in: ['buy', 'no_ai'] }, createdAt: { lte: openedAt } },
      orderBy: { createdAt: 'desc' },
      select: {
        decision: true, confidence: true, reason: true, recheckGainPct: true,
        market: true, chart: true, priceSamples: true, createdAt: true,
      },
    });
    if (!row) return null;
    const { createdAt, decision, ...rest } = row;
    return { ...rest, decision: decision as BuyReasonDto['decision'], decidedAt: createdAt };
  }

  findOpen() {
    return this.db.position.findMany({ where: { status: 'open' } });
  }

  async claim({ tokenInfo, ...data }: NewPosition) {
    try {
      const row = await this.db.position.create({
        data: { ...data, tokenInfo: (tokenInfo ?? undefined) as Prisma.InputJsonValue | undefined, status: 'opening' },
        select: { id: true },
      });
      return row.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  async markOpen(id: number, { entryPrice, supply, buySignature }: OpenedPositionData) {
    await this.db.position.update({
      where: { id },
      data: {
        status: 'open', entryPrice, currentPrice: entryPrice, highPrice: entryPrice, lowPrice: entryPrice,
        supply, entryMc: supply ? entryPrice * supply : undefined,
        pnlPct: 0, buySignature, priceUpdatedAt: new Date(),
      },
    });
  }

  async markFailed(id: number, error: string) {
    await this.db.position.update({ where: { id }, data: { status: 'failed', error, closedAt: new Date() } });
  }

  async updatePrice(id: number, price: number, highPrice: number, lowPrice: number, pnlPct: number) {
    await this.db.position.updateMany({
      where: { id, status: 'open' },
      data: { currentPrice: price, highPrice, lowPrice, pnlPct, priceUpdatedAt: new Date() },
    });
  }

  async claimForClose(id: number) {
    const { count } = await this.db.position.updateMany({ where: { id, status: 'open' }, data: { status: 'closing' } });
    return count === 0 ? null : this.db.position.findUnique({ where: { id } });
  }

  async markClosed(id: number, data: ClosedPositionData) {
    await this.db.position.update({
      where: { id },
      data: { ...data, status: 'closed', currentPrice: data.exitPrice, error: null, closedAt: new Date() },
    });
  }

  async revertToOpen(id: number, error: string) {
    await this.db.position.update({
      where: { id },
      data: { status: 'open', error, sellAttempts: { increment: 1 } },
    });
  }

  /** Posisi yang tertinggal di tengah transaksi karena server mati. */
  recoverStuck() {
    return this.db.$transaction(async (tx) => {
      const stuck = await tx.position.findMany({
        where: { status: { in: ['opening', 'closing'] } },
        select: { id: true, accountId: true, mint: true, status: true },
      });
      const reason = 'server restart saat transaksi berjalan';
      await tx.position.updateMany({
        where: { status: 'opening' },
        data: { status: 'failed', error: reason, closedAt: new Date() },
      });
      await tx.position.updateMany({ where: { status: 'closing' }, data: { status: 'open', error: reason } });
      return stuck.map((p) => ({ ...p, status: p.status === 'opening' ? 'failed' as const : 'open' as const }));
    });
  }

  async allModeStats(accountId: number): Promise<Record<TradeMode, ModeStats>> {
    const [byStatus, wins, losses, open] = await Promise.all([
      this.db.position.groupBy({
        by: ['mode', 'status'],
        where: { accountId },
        _count: { _all: true },
        _sum: { amountSol: true, pnlSol: true },
        _avg: { pnlPct: true },
      }),
      this.db.position.groupBy({
        by: ['mode'],
        where: { accountId, status: 'closed', pnlSol: { gt: 0 } },
        _count: { _all: true },
      }),
      this.db.position.groupBy({
        by: ['mode'],
        where: { accountId, status: 'closed', pnlSol: { lt: 0 } },
        _count: { _all: true },
      }),
      this.db.position.findMany({ where: { accountId, status: 'open' }, select: { mode: true, amountSol: true, pnlPct: true } }),
    ]);

    const empty = (): ModeStats => ({
      open: 0, closed: 0, wins: 0, losses: 0, failed: 0,
      realizedSol: 0, unrealizedSol: 0, lockedSol: 0, avgPnlSol: null, avgPnlPct: null,
    });
    const result: Record<TradeMode, ModeStats> = { paper: empty(), real: empty() };

    for (const g of byStatus) {
      const stats = result[g.mode];
      if (ACTIVE_STATUSES.includes(g.status)) {
        stats.open += g._count._all;
        stats.lockedSol += g._sum.amountSol ?? 0;
      } else if (g.status === 'closed') {
        stats.closed = g._count._all;
        stats.realizedSol = g._sum.pnlSol ?? 0;
        stats.avgPnlSol = stats.realizedSol / g._count._all;
        stats.avgPnlPct = g._avg.pnlPct;
      } else if (g.status === 'failed') {
        stats.failed = g._count._all;
      }
    }
    for (const w of wins) result[w.mode].wins = w._count._all;
    for (const l of losses) result[l.mode].losses = l._count._all;
    for (const p of open) result[p.mode].unrealizedSol += p.amountSol * ((p.pnlPct ?? 0) / 100);
    return result;
  }
}

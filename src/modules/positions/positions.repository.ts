import { Prisma } from '../../generated/prisma/client.ts';
import type { PrismaClient } from '../../lib/prisma.ts';
import {
  ACTIVE_STATUSES, FINISHED_STATUSES,
  type ClosedPositionData, type IPositionsRepository, type ListPositionsQuery,
  type ModeStats, type NewPosition, type OpenedPositionData, type TradeMode,
} from './positions.interfaces.ts';

export class PositionsRepository implements IPositionsRepository {
  constructor(private readonly db: PrismaClient) {}

  list({ view, mode }: ListPositionsQuery, limit: number) {
    return this.db.position.findMany({
      where: {
        mode,
        status: view === 'open' ? { in: ACTIVE_STATUSES } : view === 'closed' ? { in: FINISHED_STATUSES } : undefined,
      },
      orderBy: [{ closedAt: { sort: 'desc', nulls: 'first' } }, { openedAt: 'desc' }],
      take: limit,
    });
  }

  /** Semua mint yang pernah dicoba buy, paper maupun real, termasuk yang gagal. */
  async boughtMints() {
    const rows = await this.db.position.findMany({ distinct: ['mint'], select: { mint: true } });
    return new Set(rows.map((r) => r.mint));
  }

  countActive(mode: TradeMode) {
    return this.db.position.count({ where: { mode, status: { in: ACTIVE_STATUSES } } });
  }

  findOpen() {
    return this.db.position.findMany({ where: { status: 'open' } });
  }

  async claim(data: NewPosition) {
    try {
      const row = await this.db.position.create({ data: { ...data, status: 'opening' }, select: { id: true } });
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
        status: 'open', entryPrice, currentPrice: entryPrice, highPrice: entryPrice,
        supply, entryMc: supply ? entryPrice * supply : undefined,
        pnlPct: 0, buySignature, priceUpdatedAt: new Date(),
      },
    });
  }

  async markFailed(id: number, error: string) {
    await this.db.position.update({ where: { id }, data: { status: 'failed', error, closedAt: new Date() } });
  }

  async updatePrice(id: number, price: number, highPrice: number, pnlPct: number) {
    await this.db.position.updateMany({
      where: { id, status: 'open' },
      data: { currentPrice: price, highPrice, pnlPct, priceUpdatedAt: new Date() },
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
        select: { id: true, mint: true, status: true },
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

  async allModeStats(): Promise<Record<TradeMode, ModeStats>> {
    const [byStatus, wins, open] = await Promise.all([
      this.db.position.groupBy({
        by: ['mode', 'status'],
        _count: { _all: true },
        _sum: { amountSol: true, pnlSol: true },
      }),
      this.db.position.groupBy({
        by: ['mode'],
        where: { status: 'closed', pnlSol: { gt: 0 } },
        _count: { _all: true },
      }),
      this.db.position.findMany({ where: { status: 'open' }, select: { mode: true, amountSol: true, pnlPct: true } }),
    ]);

    const empty = (): ModeStats => ({ open: 0, closed: 0, wins: 0, failed: 0, realizedSol: 0, unrealizedSol: 0, lockedSol: 0 });
    const result: Record<TradeMode, ModeStats> = { paper: empty(), real: empty() };

    for (const g of byStatus) {
      const stats = result[g.mode];
      if (ACTIVE_STATUSES.includes(g.status)) {
        stats.open += g._count._all;
        stats.lockedSol += g._sum.amountSol ?? 0;
      } else if (g.status === 'closed') {
        stats.closed = g._count._all;
        stats.realizedSol = g._sum.pnlSol ?? 0;
      } else if (g.status === 'failed') {
        stats.failed = g._count._all;
      }
    }
    for (const w of wins) result[w.mode].wins = w._count._all;
    for (const p of open) result[p.mode].unrealizedSol += p.amountSol * ((p.pnlPct ?? 0) / 100);
    return result;
  }
}

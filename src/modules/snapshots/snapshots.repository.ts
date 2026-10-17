import type { PrismaClient } from '../../lib/prisma.ts';
import type { Prisma } from '../../generated/prisma/client.ts';
import type { ISnapshotsRepository, NewGmgnScan, NewTokenSnapshot } from './snapshots.interfaces.ts';

/** undefined = kolom JSON dibiarkan NULL di database. */
const json = (value: unknown) => (value == null ? undefined : (value as Prisma.InputJsonValue));

export class SnapshotsRepository implements ISnapshotsRepository {
  constructor(private readonly db: PrismaClient) {}

  async create({ gmgn, market, chart, priceSamples, ...rest }: NewTokenSnapshot) {
    await this.db.tokenSnapshot.create({
      data: { ...rest, gmgn: gmgn as Prisma.InputJsonValue, market: json(market), chart: json(chart), priceSamples: json(priceSamples) },
    });
  }

  async createScan({ accountId, source, filter, response, tokens }: NewGmgnScan) {
    await this.db.gmgnScan.create({
      data: {
        accountId,
        source,
        filter: filter as Prisma.InputJsonValue,
        response: response as Prisma.InputJsonValue,
        tokenCount: tokens.length,
        tokens: { create: tokens.map((t) => ({ ...t, data: t.data as Prisma.InputJsonValue })) },
      },
    });
  }
}

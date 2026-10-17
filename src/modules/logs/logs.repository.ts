import type { PrismaClient } from '../../lib/prisma.ts';
import type { ILogsRepository, LogLevel } from './logs.interfaces.ts';

export class LogsRepository implements ILogsRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(accountId: number | null, level: LogLevel, message: string) {
    await this.db.log.create({ data: { accountId, level, message } });
  }

  async latest(accountId: number, limit: number) {
    const rows = await this.db.log.findMany({
      where: { OR: [{ accountId }, { accountId: null }] },
      orderBy: { id: 'desc' },
      take: limit,
      select: { id: true, level: true, message: true, createdAt: true },
    });
    // BigInt tidak bisa di-JSON-kan
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }
}

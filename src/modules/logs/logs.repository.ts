import type { PrismaClient } from '../../lib/prisma.ts';
import type { ILogsRepository, LogLevel } from './logs.interfaces.ts';

export class LogsRepository implements ILogsRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(level: LogLevel, message: string) {
    await this.db.log.create({ data: { level, message } });
  }

  async latest(limit: number) {
    const rows = await this.db.log.findMany({ orderBy: { id: 'desc' }, take: limit });
    // BigInt tidak bisa di-JSON-kan
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }
}

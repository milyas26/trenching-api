import type { Prisma } from '../../generated/prisma/client.ts';
import type { PrismaClient } from '../../lib/prisma.ts';
import type { IAccountsRepository } from './accounts.interfaces.ts';

const json = (value: unknown) => value as Prisma.InputJsonValue;

export class AccountsRepository implements IAccountsRepository {
  constructor(private readonly db: PrismaClient) {}

  list() {
    return this.db.account.findMany({ orderBy: { id: 'asc' } });
  }

  find(id: number) {
    return this.db.account.findUnique({ where: { id } });
  }

  create(name: string, settings: unknown) {
    return this.db.account.create({ data: { name, settings: json(settings) } });
  }

  update(id: number, data: { name?: string; pumpportalApiKey?: string | null; walletPublicKey?: string | null }) {
    return this.db.account.update({ where: { id }, data });
  }

  async saveSettings(id: number, settings: unknown) {
    await this.db.account.update({ where: { id }, data: { settings: json(settings) } });
  }

  /** Posisi, log, snapshot, dan scan akun ikut terhapus (ON DELETE CASCADE). */
  async delete(id: number) {
    await this.db.account.delete({ where: { id } });
  }
}

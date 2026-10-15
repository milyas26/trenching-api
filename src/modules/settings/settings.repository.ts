import type { PrismaClient } from '../../lib/prisma.ts';
import type { BotSettings, ISettingsRepository } from './settings.interfaces.ts';

const SETTINGS_ID = 1;

export class SettingsRepository implements ISettingsRepository {
  constructor(private readonly db: PrismaClient) {}

  async find() {
    const row = await this.db.setting.findUnique({ where: { id: SETTINGS_ID } });
    return row?.data ?? null;
  }

  async save(data: BotSettings) {
    await this.db.setting.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, data },
      update: { data },
    });
  }
}

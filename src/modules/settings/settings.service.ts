import { notFound } from '../../common/errors.ts';
import { botSettingsSchema } from './settings.schema.ts';
import type { BotSettings, ISettingsRepository, SettingsPatch } from './settings.interfaces.ts';

/** Settings per akun, di-cache di memori. */
export class SettingsService {
  private readonly cache = new Map<number, BotSettings>();

  constructor(private readonly repo: ISettingsRepository) {}

  /** Melempar 404 kalau akun tidak ada (mis. sudah dihapus). */
  async get(accountId: number): Promise<BotSettings> {
    const cached = this.cache.get(accountId);
    if (cached) return cached;
    const row = await this.repo.find(accountId);
    if (!row) throw notFound(`Akun #${accountId} tidak ditemukan`);
    // parse() mengisi default untuk field yang belum ada di data lama
    const settings = botSettingsSchema.parse(row.settings ?? {}) as BotSettings;
    this.cache.set(accountId, settings);
    return settings;
  }

  async update(accountId: number, patch: SettingsPatch & { botEnabled?: boolean }): Promise<BotSettings> {
    const current = await this.get(accountId);
    const next = botSettingsSchema.parse({
      ...current,
      ...patch,
      filter: { ...current.filter, ...patch.filter },
      combos: { ...current.combos, ...patch.combos },
      ogRule: { ...current.ogRule, ...patch.ogRule },
    }) as BotSettings;
    await this.repo.saveSettings(accountId, next);
    this.cache.set(accountId, next);
    return next;
  }

  forget(accountId: number) {
    this.cache.delete(accountId);
  }
}

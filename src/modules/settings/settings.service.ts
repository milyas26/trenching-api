import { botSettingsSchema } from './settings.schema.ts';
import type { BotSettings, ISettingsRepository, SettingsPatch } from './settings.interfaces.ts';

/** Settings disimpan satu baris JSON dan di-cache di memori. */
export class SettingsService {
  private cache: BotSettings | null = null;

  constructor(private readonly repo: ISettingsRepository) {}

  async get(): Promise<BotSettings> {
    if (this.cache) return this.cache;
    const stored = await this.repo.find();
    // parse() mengisi default untuk field yang belum ada di data lama
    const settings = botSettingsSchema.parse(stored ?? {}) as BotSettings;
    if (!stored) await this.repo.save(settings);
    this.cache = settings;
    return settings;
  }

  async update(patch: SettingsPatch & { botEnabled?: boolean }): Promise<BotSettings> {
    const current = await this.get();
    const next = botSettingsSchema.parse({
      ...current,
      ...patch,
      filter: { ...current.filter, ...patch.filter },
    }) as BotSettings;
    await this.repo.save(next);
    this.cache = next;
    return next;
  }
}

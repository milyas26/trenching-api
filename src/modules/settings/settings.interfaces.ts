import type { z } from 'zod';
import type { botSettingsSchema, settingsPatchSchema } from './settings.schema.ts';
import type { PumpPool } from '../../integrations/pumpportal/pumpportal.types.ts';

export type BotSettings = Omit<z.infer<typeof botSettingsSchema>, 'pool'> & { pool: PumpPool };
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Settings disimpan sebagai JSON di baris akun (tabel accounts). */
export interface ISettingsRepository {
  find(accountId: number): Promise<{ settings: unknown } | null>;
  saveSettings(accountId: number, settings: BotSettings): Promise<void>;
}

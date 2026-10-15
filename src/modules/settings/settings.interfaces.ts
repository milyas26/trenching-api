import type { z } from 'zod';
import type { botSettingsSchema, settingsPatchSchema } from './settings.schema.ts';
import type { PumpPool } from '../../integrations/pumpportal/pumpportal.types.ts';

export type BotSettings = Omit<z.infer<typeof botSettingsSchema>, 'pool'> & { pool: PumpPool };
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export interface ISettingsRepository {
  find(): Promise<unknown | null>;
  save(data: BotSettings): Promise<void>;
}

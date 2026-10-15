import type { FastifyRequest } from 'fastify';
import { settingsPatchSchema } from './settings.schema.ts';
import type { SettingsService } from './settings.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { BotScheduler } from '../bot/bot.scheduler.ts';

export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly logs: LogsService,
    private readonly scheduler: BotScheduler,
  ) {}

  get = () => this.settings.get();

  update = async (req: FastifyRequest) => {
    const patch = settingsPatchSchema.parse(req.body ?? {});
    const prev = await this.settings.get();
    const next = await this.settings.update(patch);

    if (prev.mode !== next.mode) await this.logs.info(`Mode diganti ke ${next.mode.toUpperCase()}`);
    if (prev.scanIntervalSec !== next.scanIntervalSec) this.scheduler.restartScan();
    return next;
  };
}

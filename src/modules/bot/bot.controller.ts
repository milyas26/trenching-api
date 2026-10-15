import type { BotService } from './bot.service.ts';

export class BotController {
  constructor(private readonly bot: BotService) {}

  status = () => this.bot.status();
  candidates = () => this.bot.candidates();
  scan = async () => ({ ok: true, ...(await this.bot.scanNow()) });

  start = async () => {
    await this.bot.start();
    return { ok: true };
  };

  stop = async () => {
    await this.bot.stop();
    return { ok: true };
  };
}

import type { FastifyRequest } from 'fastify';
import { accountIdOf } from '../../common/account.ts';
import type { BotService } from './bot.service.ts';

export class BotController {
  constructor(private readonly bot: BotService) {}

  status = (req: FastifyRequest) => this.bot.status(accountIdOf(req));
  candidates = (req: FastifyRequest) => this.bot.candidates(accountIdOf(req));
  scan = async (req: FastifyRequest) => ({ ok: true, ...(await this.bot.scanNow(accountIdOf(req))) });

  start = async (req: FastifyRequest) => {
    await this.bot.start(accountIdOf(req));
    return { ok: true };
  };

  stop = async (req: FastifyRequest) => {
    await this.bot.stop(accountIdOf(req));
    return { ok: true };
  };
}

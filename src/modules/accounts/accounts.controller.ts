import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AccountsService } from './accounts.service.ts';
import type { BotScheduler } from '../bot/bot.scheduler.ts';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const createBody = z.object({
  name: z.string().max(40).optional(),
  copyFromId: z.number().int().positive().optional(),
}).strict();
const updateBody = z.object({
  name: z.string().max(40).optional(),
  credentials: z.object({ apiKey: z.string().max(200), wallet: z.string().max(64) }).nullable().optional(),
}).strict();

export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly scheduler: BotScheduler,
  ) {}

  list = () => this.accounts.list();

  create = async (req: FastifyRequest) => {
    const account = await this.accounts.create(createBody.parse(req.body ?? {}));
    this.scheduler.restartScan(account.id);
    return account;
  };

  update = (req: FastifyRequest) => this.accounts.update(idParams.parse(req.params).id, updateBody.parse(req.body ?? {}));

  remove = async (req: FastifyRequest) => {
    const { id } = idParams.parse(req.params);
    await this.accounts.remove(id);
    this.scheduler.removeAccount(id);
    return { ok: true };
  };
}

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
  credentials: z.object({
    // API key Lightning PumpPortal bisa lebih dari 200 karakter.
    apiKey: z.string().trim().max(2000).regex(/^\S*$/, 'API key PumpPortal tidak boleh mengandung spasi atau baris baru'),
    wallet: z.string().trim().regex(/^([1-9A-HJ-NP-Za-km-z]{32,44})?$/, 'Wallet harus alamat publik Solana (base58, 32-44 karakter)'),
  }).nullable().optional(),
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

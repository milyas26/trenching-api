import type { FastifyRequest } from 'fastify';
import { accountIdOf } from '../../common/account.ts';
import { TOKEN_SOURCE_LABEL } from '../../integrations/gmgn/gmgn.types.ts';
import { settingsPatchSchema } from './settings.schema.ts';
import { comboCatalog } from './combos.ts';
import type { SettingsService } from './settings.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { BotScheduler } from '../bot/bot.scheduler.ts';
import type { AccountsService } from '../accounts/accounts.service.ts';

export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly accounts: AccountsService,
    private readonly logs: LogsService,
    private readonly scheduler: BotScheduler,
  ) {}

  get = (req: FastifyRequest) => this.settings.get(accountIdOf(req));

  /** Sama untuk semua akun, jadi tidak butuh header akun. */
  combos = () => comboCatalog();

  update = async (req: FastifyRequest) => {
    const accountId = accountIdOf(req);
    const patch = settingsPatchSchema.parse(req.body ?? {});
    const prev = await this.settings.get(accountId);
    if (patch.mode === 'real' && prev.mode !== 'real') await this.accounts.assertWalletFree(accountId);
    const next = await this.settings.update(accountId, patch);

    const log = this.logs.for(accountId);
    if (prev.mode !== next.mode) await log.info(`Mode diganti ke ${next.mode.toUpperCase()}`);
    if (prev.source !== next.source) await log.info(`Sumber token diganti ke ${TOKEN_SOURCE_LABEL[next.source]}`);
    if (prev.scanIntervalSec !== next.scanIntervalSec) this.scheduler.restartScan(accountId);
    return next;
  };
}

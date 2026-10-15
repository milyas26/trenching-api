import { env } from '../../config/env.ts';
import type { PumpportalClient } from '../../integrations/pumpportal/pumpportal.client.ts';
import type { IPositionsRepository } from '../positions/positions.interfaces.ts';
import type { PositionsService } from '../positions/positions.service.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { BotRuntimeState, BotStatus, CandidatesResponse } from './bot.interfaces.ts';
import type { BotScheduler } from './bot.scheduler.ts';
import type { ScannerService } from './scanner.service.ts';

export class BotService {
  constructor(
    private readonly state: BotRuntimeState,
    private readonly settings: SettingsService,
    private readonly positions: PositionsService,
    private readonly positionsRepo: IPositionsRepository,
    private readonly scheduler: BotScheduler,
    private readonly scanner: ScannerService,
    private readonly pumpportal: PumpportalClient,
    private readonly logs: LogsService,
  ) {}

  async status(): Promise<BotStatus> {
    const settings = await this.settings.get();
    const s = this.state;
    return {
      botEnabled: settings.botEnabled,
      mode: settings.mode,
      wallet: env.walletPublicKey,
      pumpportalReady: this.pumpportal.isConfigured,
      scanning: s.scanning,
      lastScanAt: s.lastScanAt,
      lastScanError: s.lastScanError,
      lastScanCount: s.lastScanTokens.length,
      nextScanAt: s.nextScanAt,
      lastPriceAt: s.lastPriceAt,
      lastPriceError: s.lastPriceError,
      stats: await this.positions.stats(settings),
    };
  }

  async start() {
    const settings = await this.settings.update({ botEnabled: true });
    await this.logs.info(`Bot START (${settings.mode})`);
    this.scheduler.restartScan();
  }

  async stop() {
    await this.settings.update({ botEnabled: false });
    this.state.nextScanAt = null;
    await this.logs.info('Bot STOP');
  }

  /** Scan manual. Buy hanya terjadi kalau bot sedang aktif. */
  async scanNow() {
    const { botEnabled } = await this.settings.get();
    await this.scanner.run({ buy: botEnabled });
    return { error: this.state.lastScanError };
  }

  /** Flag `bought` dihitung saat request supaya selalu sesuai isi tabel positions. */
  async candidates(): Promise<CandidatesResponse> {
    const { mode } = await this.settings.get();
    const bought = await this.positionsRepo.mintsByMode(mode);
    return {
      at: this.state.lastScanAt,
      tokens: this.state.lastScanTokens.map((t) => ({ ...t, bought: bought.has(t.mint) })),
    };
  }

  async recover() {
    for (const p of await this.positionsRepo.recoverStuck()) {
      await this.logs.warn(`Recover posisi #${p.id} (${p.mint.slice(0, 4)}…${p.mint.slice(-4)}) -> ${p.status}`);
    }
  }
}

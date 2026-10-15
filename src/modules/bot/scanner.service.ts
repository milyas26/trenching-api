import type { GmgnClient } from '../../integrations/gmgn/gmgn.client.ts';
import type { IPositionsRepository } from '../positions/positions.interfaces.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { TradingService } from '../trading/trading.service.ts';
import type { BotRuntimeState } from './bot.interfaces.ts';

/** Jalankan filter GMGN, lalu buy token baru selama slot masih ada. */
export class ScannerService {
  constructor(
    private readonly state: BotRuntimeState,
    private readonly gmgn: GmgnClient,
    private readonly positions: IPositionsRepository,
    private readonly settings: SettingsService,
    private readonly trading: TradingService,
    private readonly logs: LogsService,
  ) {}

  /** @param buy false = cuma refresh daftar kandidat (scan manual saat bot berhenti) */
  async run({ buy }: { buy: boolean }): Promise<void> {
    if (this.state.scanning) return;
    this.state.scanning = true;
    try {
      const settings = await this.settings.get();
      const tokens = await this.gmgn.fetchHotTokens(settings.filter);
      this.state.lastScanAt = new Date();
      this.state.lastScanError = null;
      this.state.lastScanTokens = tokens;
      if (!buy) return;

      // Token yang pernah dibeli di mode mana pun tidak dibeli lagi.
      const known = await this.positions.boughtMints();
      const fresh = tokens.filter((t) => !known.has(t.mint));
      const active = await this.positions.countActive(settings.mode);
      const slots = Math.max(0, Math.min(settings.maxOpenPositions - active, settings.maxBuysPerScan));
      await this.logs.info(`Scan: ${tokens.length} token lolos filter, ${fresh.length} baru, slot buy ${slots}`);

      for (const token of fresh.slice(0, slots)) {
        await this.trading.open(token, settings);
      }
    } catch (e) {
      this.state.lastScanError = (e as Error).message;
      await this.logs.error(`Scan gagal: ${this.state.lastScanError}`);
    } finally {
      this.state.scanning = false;
    }
  }
}

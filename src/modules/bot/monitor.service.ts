import type { DexscreenerClient } from '../../integrations/dexscreener/dexscreener.client.ts';
import type { IPositionsRepository } from '../positions/positions.interfaces.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { TradingService } from '../trading/trading.service.ts';
import { evaluateExit, pnlPct } from '../trading/exit-rules.ts';
import type { BotRuntimeState } from './bot.interfaces.ts';

/** Update harga semua posisi open dan close yang kena aturan exit. */
export class MonitorService {
  private busy = false;

  constructor(
    private readonly state: BotRuntimeState,
    private readonly prices: DexscreenerClient,
    private readonly positions: IPositionsRepository,
    private readonly settings: SettingsService,
    private readonly trading: TradingService,
    private readonly logs: LogsService,
  ) {}

  async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const open = await this.positions.findOpen();
      if (open.length === 0) return;

      const settings = await this.settings.get();
      const quotes = await this.prices.getQuotes(open.map((p) => p.mint));
      this.state.lastPriceAt = new Date();
      this.state.lastPriceError = null;

      for (const pos of open) {
        const price = quotes.get(pos.mint)?.priceUsd;
        if (!price || !pos.entryPrice) continue;

        const highPrice = Math.max(pos.highPrice ?? 0, price);
        await this.positions.updatePrice(pos.id, price, highPrice, pnlPct(pos.entryPrice, price));

        const reason = evaluateExit({ entryPrice: pos.entryPrice, highPrice, openedAt: pos.openedAt, price }, settings);
        // Error sell sudah dicatat oleh TradingService; lanjut ke posisi berikutnya.
        if (reason) await this.trading.close(pos.id, reason, price).catch(() => {});
      }
    } catch (e) {
      this.state.lastPriceError = (e as Error).message;
      await this.logs.error(`Cek harga gagal: ${this.state.lastPriceError}`);
    } finally {
      this.busy = false;
    }
  }
}

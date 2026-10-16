import type { PriceSource, TokenQuote } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { OnchainPriceStream } from '../../integrations/onchain/onchain-price.stream.ts';
import type { IPositionsRepository, Position } from '../positions/positions.interfaces.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { TradingService } from '../trading/trading.service.ts';
import type { PricesService } from '../prices/prices.service.ts';
import { toPositionDto } from '../positions/positions.mapper.ts';
import { evaluateExit, pnlPct } from '../trading/exit-rules.ts';
import type { BotRuntimeState } from './bot.interfaces.ts';

/** Harga dari stream bisa datang beberapa kali per detik; DB cukup ditulis sekali per detik per posisi. */
const STREAM_WRITE_MS = 1_000;
/** Sell yang gagal dicoba lagi dengan jeda 5 dtk, 10, 20, ... maks 2 menit, bukan di setiap tick harga. */
const SELL_RETRY_BASE_MS = 5_000;
const SELL_RETRY_MAX_MS = 120_000;

/**
 * Update harga semua posisi open dan close yang kena aturan exit.
 * - run(): polling berkala (heartbeat), sekaligus menyamakan daftar mint yang di-stream.
 * - handleQuote(): push dari OnchainPriceStream, exit dievaluasi begitu akun on-chain berubah.
 */
export class MonitorService {
  private busy = false;
  /** Posisi open terakhir dari DB, highPrice-nya ikut diperbarui oleh stream. */
  private open = new Map<number, Position>();
  private readonly closing = new Set<number>();
  private readonly lastWrite = new Map<number, number>();
  private readonly sellRetry = new Map<number, { failures: number; at: number }>();

  constructor(
    private readonly state: BotRuntimeState,
    private readonly prices: PriceSource,
    private readonly stream: OnchainPriceStream,
    private readonly positions: IPositionsRepository,
    private readonly settings: SettingsService,
    private readonly trading: TradingService,
    private readonly logs: LogsService,
    private readonly live: PricesService,
  ) {}

  async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const open = await this.positions.findOpen();
      this.syncOpen(open);
      // Gagal subscribe tidak fatal: polling di bawah tetap jalan.
      void this.stream.watch(open.map((p) => p.mint)).catch(() => {});
      if (open.length === 0) return;

      const settings = await this.settings.get();
      const quotes = await this.prices.getQuotes(open.map((p) => p.mint));
      this.state.lastPriceAt = new Date();
      this.state.lastPriceError = null;

      for (const pos of this.open.values()) {
        const price = quotes.get(pos.mint)?.priceUsd;
        if (price) await this.apply(pos, price, settings, false);
      }
    } catch (e) {
      this.state.lastPriceError = (e as Error).message;
      await this.logs.error(`Cek harga gagal: ${this.state.lastPriceError}`);
    } finally {
      this.busy = false;
    }
  }

  async handleQuote(mint: string, quote: TokenQuote): Promise<void> {
    const targets = [...this.open.values()].filter((p) => p.mint === mint);
    if (targets.length === 0) return;
    try {
      const settings = await this.settings.get();
      this.state.lastPriceAt = new Date();
      for (const pos of targets) await this.apply(pos, quote.priceUsd, settings, true);
    } catch (e) {
      this.state.lastPriceError = (e as Error).message;
    }
  }

  /** highPrice di memori bisa lebih baru dari DB karena tulisan stream di-throttle. */
  private syncOpen(rows: Position[]) {
    const next = new Map<number, Position>();
    for (const row of rows) {
      const cached = this.open.get(row.id);
      if (cached?.highPrice) row.highPrice = Math.max(row.highPrice ?? 0, cached.highPrice);
      next.set(row.id, row);
    }
    for (const id of this.lastWrite.keys()) if (!next.has(id)) this.lastWrite.delete(id);
    for (const id of this.sellRetry.keys()) if (!next.has(id)) this.sellRetry.delete(id);
    this.open = next;
    this.live.retain(new Set(next.keys()));
  }

  private async apply(pos: Position, price: number, settings: BotSettings, throttled: boolean) {
    if (!pos.entryPrice || this.closing.has(pos.id) || this.open.get(pos.id) !== pos) return;

    const highPrice = Math.max(pos.highPrice ?? 0, price);
    const pnl = pnlPct(pos.entryPrice, price);
    pos.highPrice = highPrice;
    pos.currentPrice = price;
    pos.pnlPct = pnl;
    const dto = toPositionDto(pos);
    this.live.publishTick({
      id: pos.id, mint: pos.mint, currentPrice: price, highPrice, pnlPct: pnl,
      currentMc: dto.currentMc, highMc: dto.highMc, at: Date.now(),
    });
    const reason = evaluateExit({ entryPrice: pos.entryPrice, highPrice, openedAt: pos.openedAt, price }, settings);

    const now = Date.now();
    if (reason || !throttled || now - (this.lastWrite.get(pos.id) ?? 0) >= STREAM_WRITE_MS) {
      this.lastWrite.set(pos.id, now);
      await this.positions.updatePrice(pos.id, price, highPrice, pnl);
    }
    if (!reason || this.closing.has(pos.id)) return;
    if (now < (this.sellRetry.get(pos.id)?.at ?? 0)) return;

    this.closing.add(pos.id);
    this.open.delete(pos.id);
    try {
      await this.trading.close(pos.id, reason, price);
      this.sellRetry.delete(pos.id);
      this.live.publishClosed(pos.id);
      if (![...this.open.values()].some((p) => p.mint === pos.mint)) this.stream.unwatch(pos.mint);
    } catch {
      // Error sell sudah dicatat oleh TradingService; posisi kembali open dan dimuat ulang di run() berikutnya.
      const failures = (this.sellRetry.get(pos.id)?.failures ?? 0) + 1;
      const delay = Math.min(SELL_RETRY_BASE_MS * 2 ** (failures - 1), SELL_RETRY_MAX_MS);
      this.sellRetry.set(pos.id, { failures, at: Date.now() + delay });
    } finally {
      this.closing.delete(pos.id);
    }
  }
}

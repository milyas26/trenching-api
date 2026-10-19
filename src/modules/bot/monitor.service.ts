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
import type { BotState } from './bot.state.ts';

/** Harga dari stream bisa datang beberapa kali per detik; DB cukup ditulis sekali per detik per posisi. */
const STREAM_WRITE_MS = 1_000;
/** Sell yang gagal dicoba lagi dengan jeda 5 dtk, 10, 20, ... maks 2 menit, bukan di setiap tick harga. */
const SELL_RETRY_BASE_MS = 5_000;
const SELL_RETRY_MAX_MS = 120_000;
/**
 * Harga yang melompat lebih dari X kali (naik atau turun) dari harga terakhir dalam satu tick dianggap
 * meragukan: belum dipakai untuk TP/SL sampai tick berikutnya mengonfirmasi (selisih < 2x).
 * Rug asli tetap kena SL, hanya tertunda satu tick.
 */
const MAX_TICK_JUMP = 20;
const CONFIRM_RATIO = 2;

/**
 * Update harga semua posisi open (semua akun) dan close yang kena aturan exit akun pemiliknya.
 * - run(): polling berkala (heartbeat), sekaligus menyamakan daftar mint yang di-stream.
 * - handleQuote(): push dari OnchainPriceStream, exit dievaluasi begitu akun on-chain berubah.
 */
export class MonitorService {
  private busy = false;
  /** Posisi open terakhir dari DB, highPrice/lowPrice-nya ikut diperbarui oleh stream. */
  private open = new Map<number, Position>();
  private readonly closing = new Set<number>();
  private readonly lastWrite = new Map<number, number>();
  private readonly sellRetry = new Map<number, { failures: number; at: number }>();
  /** Harga meragukan terakhir per posisi, menunggu konfirmasi tick berikutnya. */
  private readonly suspect = new Map<number, number>();

  constructor(
    private readonly state: BotState,
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

      const quotes = await this.prices.getQuotes(open.map((p) => p.mint));
      this.state.price.lastPriceAt = new Date();
      this.state.price.lastPriceError = null;

      for (const pos of this.open.values()) {
        const price = quotes.get(pos.mint)?.priceUsd;
        if (price) await this.apply(pos, price, await this.settings.get(pos.accountId), false);
      }
    } catch (e) {
      this.state.price.lastPriceError = (e as Error).message;
      await this.logs.system.error(`Cek harga gagal: ${this.state.price.lastPriceError}`);
    } finally {
      this.busy = false;
    }
  }

  async handleQuote(mint: string, quote: TokenQuote): Promise<void> {
    const targets = [...this.open.values()].filter((p) => p.mint === mint);
    if (targets.length === 0) return;
    try {
      this.state.price.lastPriceAt = new Date();
      for (const pos of targets) await this.apply(pos, quote.priceUsd, await this.settings.get(pos.accountId), true);
    } catch (e) {
      this.state.price.lastPriceError = (e as Error).message;
    }
  }

  /** false = harga melompat ekstrem dan belum dikonfirmasi tick berikutnya; tick ini diabaikan. */
  private async confirmed(pos: Position, price: number): Promise<boolean> {
    const last = pos.currentPrice ?? pos.entryPrice!;
    const jump = Math.max(price / last, last / price);
    if (!Number.isFinite(jump) || jump <= MAX_TICK_JUMP) {
      this.suspect.delete(pos.id);
      return true;
    }
    const pending = this.suspect.get(pos.id);
    if (pending !== undefined && Math.max(price / pending, pending / price) < CONFIRM_RATIO) {
      this.suspect.delete(pos.id);
      return true;
    }
    if (pending === undefined) {
      await this.logs.for(pos.accountId).warn(
        `Harga ${pos.symbol ?? pos.mint.slice(0, 4)} melompat ${jump.toFixed(0)}x ($${last} -> $${price}), diabaikan sampai dikonfirmasi tick berikutnya`,
      );
    }
    this.suspect.set(pos.id, price);
    return false;
  }

  /** highPrice/lowPrice di memori bisa lebih baru dari DB karena tulisan stream di-throttle. */
  private syncOpen(rows: Position[]) {
    const next = new Map<number, Position>();
    for (const row of rows) {
      const cached = this.open.get(row.id);
      if (cached?.highPrice) row.highPrice = Math.max(row.highPrice ?? 0, cached.highPrice);
      if (cached?.lowPrice) row.lowPrice = Math.min(row.lowPrice ?? Infinity, cached.lowPrice);
      next.set(row.id, row);
    }
    for (const id of this.lastWrite.keys()) if (!next.has(id)) this.lastWrite.delete(id);
    for (const id of this.sellRetry.keys()) if (!next.has(id)) this.sellRetry.delete(id);
    for (const id of this.suspect.keys()) if (!next.has(id)) this.suspect.delete(id);
    this.open = next;
    this.live.retain(new Set(next.keys()));
  }

  private async apply(pos: Position, price: number, settings: BotSettings, throttled: boolean) {
    if (!pos.entryPrice || this.closing.has(pos.id) || this.open.get(pos.id) !== pos) return;
    if (!(await this.confirmed(pos, price))) return;

    const highPrice = Math.max(pos.highPrice ?? 0, price);
    const lowPrice = Math.min(pos.lowPrice ?? pos.entryPrice, price);
    const pnl = pnlPct(pos.entryPrice, price);
    pos.highPrice = highPrice;
    pos.lowPrice = lowPrice;
    pos.currentPrice = price;
    pos.pnlPct = pnl;
    const dto = toPositionDto(pos);
    this.live.publishTick({
      id: pos.id, mint: pos.mint, currentPrice: price, highPrice, lowPrice, pnlPct: pnl,
      currentMc: dto.currentMc, highMc: dto.highMc, lowMc: dto.lowMc, at: Date.now(),
    });
    // Posisi token OG bisa punya take profit sendiri (disimpan saat beli).
    const rules = { ...settings, takeProfitPct: pos.takeProfitPct ?? settings.takeProfitPct };
    const reason = evaluateExit({ entryPrice: pos.entryPrice, highPrice, openedAt: pos.openedAt, price }, rules);

    const now = Date.now();
    if (reason || !throttled || now - (this.lastWrite.get(pos.id) ?? 0) >= STREAM_WRITE_MS) {
      this.lastWrite.set(pos.id, now);
      await this.positions.updatePrice(pos.id, price, highPrice, lowPrice, pnl);
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

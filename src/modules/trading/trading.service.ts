import type { IPositionsRepository, ExitReason, Position, RealLegData, TradeMode } from '../positions/positions.interfaces.ts';
import type { PositionsService } from '../positions/positions.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';
import type { AccountsService } from '../accounts/accounts.service.ts';
import { conflict } from '../../common/errors.ts';
import { pnlPct } from './exit-rules.ts';
import { ogTakeProfit } from './og-rule.ts';
import { realBuyMisses } from './real-buy-rule.ts';
import { NoTokensError, type BuyCandidate, type TradeContext, type TradeExecutor, type TradingPriceSource } from './trading.interfaces.ts';
import type { SwapFill } from './fills.ts';

const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** Batas selisih harga quote vs GMGN (kali lipat, naik atau turun) sebelum buy dibatalkan. */
export const MAX_PRICE_DEVIATION = 3;

export const priceDeviates = (quotePrice: number, gmgnPrice: number) =>
  Math.max(quotePrice / gmgnPrice, gmgnPrice / quotePrice) > MAX_PRICE_DEVIATION;

/** Ukuran buy dalam SOL. Mode pct dibulatkan ke bawah 4 desimal supaya tidak melebihi saldo. */
export const buyAmount = (s: BotSettings, availableSol: number) =>
  s.buySizeMode === 'pct' ? Math.floor(availableSol * s.buyAmountPct * 100) / 1e4 : s.buyAmountSol;

/**
 * Buka/tutup posisi. Satu-satunya tempat yang memanggil executor.
 * Posisi baru selalu paper. Di akun mode real, token yang cocok settings.realBuy juga dibeli di wallet asli;
 * buy real itu menempel di posisi paper yang sama dan ikut dijual saat posisi ditutup.
 */
export class TradingService {
  private readonly executors: Record<TradeMode, TradeExecutor>;

  constructor(
    private readonly repo: IPositionsRepository,
    private readonly positions: PositionsService,
    private readonly prices: TradingPriceSource,
    private readonly settings: SettingsService,
    private readonly accounts: AccountsService,
    private readonly logs: LogsService,
    executors: TradeExecutor[],
  ) {
    this.executors = Object.fromEntries(executors.map((e) => [e.mode, e])) as Record<TradeMode, TradeExecutor>;
  }

  private async context(accountId: number, settings: BotSettings): Promise<TradeContext> {
    return { ...settings, ...(await this.accounts.credentials(accountId)) };
  }

  /** @returns false kalau saldo paper tidak cukup, supaya pemanggil berhenti mencoba token lain. */
  async open(accountId: number, token: BuyCandidate, settings: BotSettings): Promise<boolean> {
    const label = `${token.symbol ?? shortMint(token.mint)} [paper]`;
    const log = this.logs.for(accountId);

    // Cek sebelum claim: kalau tidak, token ini tercatat failed dan tidak akan pernah dibeli lagi.
    const available = await this.positions.paperBalance(accountId, settings);
    const amountSol = buyAmount(settings, available);
    if (amountSol <= 0 || available < amountSol) {
      await log.warn(`Saldo paper tidak cukup untuk buy ${label}: tersedia ${available.toFixed(4)} SOL`);
      return false;
    }

    // Data GMGN bisa tertinggal jauh dari pool (pernah 34x pada token yang sudah rug). Dicek sebelum
    // claim supaya tidak ada posisi tercatat dan token bisa dicek lagi di scan berikutnya.
    const preQuote = (await this.prices.getQuotes([token.mint]).catch(() => null))?.get(token.mint);
    if (preQuote && token.price && priceDeviates(preQuote.priceUsd, token.price)) {
      await log.warn(
        `BUY ${label} dibatalkan: harga ${preQuote.source} $${preQuote.priceUsd} menyimpang >${MAX_PRICE_DEVIATION}x dari GMGN $${token.price}`,
      );
      return true;
    }
    const refPrice = preQuote?.priceUsd ?? token.price;

    // Disimpan di posisi supaya TP-nya tetap walau pengaturan OG diubah setelah beli.
    const ogTp = ogTakeProfit(token.info, token.mc, settings);
    // Klaim mint dulu (unique akun+mode+mint) supaya token yang sama tidak pernah dibeli dua kali.
    const id = await this.repo.claim({
      accountId, mode: 'paper', mint: token.mint, symbol: token.symbol, name: token.name, logo: token.logo,
      amountSol, entryMc: token.mc, tokenInfo: token.info, takeProfitPct: ogTp,
    });
    if (id === null) return true;

    try {
      // Buy real dulu (bisa sampai 60 detik menunggu konfirmasi), supaya posisi baru bisa ditutup
      // setelah buy real selesai. Gagal real tidak menggagalkan posisi paper.
      const real = settings.mode === 'real' && refPrice ? await this.buyRealLeg(accountId, token, settings) : null;
      const realLeg = real?.leg ?? null;

      const quote = (await this.prices.getQuotes([token.mint]).catch(() => null))?.get(token.mint);
      const quoteEntry = quote?.priceUsd ?? token.price ?? refPrice;
      // Entry posisi yang ikut buy real = harga yang benar-benar didapat wallet, supaya PnL dan TP/SL sama dengan wallet.
      const fillEntry = real?.fill ? await this.fillPriceUsd(real.fill) : null;
      const entry = fillEntry ?? quoteEntry;
      if (!entry) throw new Error('harga entry tidak tersedia');
      if (realLeg?.realStatus === 'open' && fillEntry === null) {
        await log.warn(`BUY ${label}: hasil buy real tidak terbaca dari chain, entry memakai quote $${quoteEntry}`);
      }

      // Supply tetap, jadi market cap = harga x supply untuk semua harga berikutnya.
      const supply = quote?.marketCap && quote.priceUsd
        ? quote.marketCap / quote.priceUsd
        : token.mc && token.price ? token.mc / token.price : null;

      await this.repo.markOpen(id, { entryPrice: entry, supply, buySignature: null, realLeg });
      await log.buy(
        `BUY ${label} ${amountSol} SOL${settings.buySizeMode === 'pct' ? ` (${settings.buyAmountPct}% saldo)` : ''} @ $${entry}${ogTp === null ? '' : ` | token OG, TP ${ogTp}%`}`
          + (realLeg?.realStatus === 'open' ? ` | + real ${realLeg.realAmountSol} SOL` : '')
          + (fillEntry !== null && quoteEntry ? ` | entry dari fill real (quote $${quoteEntry}, selisih ${pnlPct(quoteEntry, fillEntry).toFixed(1)}%)` : ''),
      );
    } catch (e) {
      const message = (e as Error).message;
      await this.repo.markFailed(id, message);
      await log.error(`BUY ${label} gagal: ${message}`);
    }
    return true;
  }

  /** Harga USD per token dari hasil swap; null kalau harga SOL tidak tersedia atau jumlah token nol. */
  private async fillPriceUsd(fill: SwapFill): Promise<number | null> {
    if (fill.tokens === 0 || fill.sol === 0) return null;
    const solUsd = await this.prices.getSolUsd().catch(() => null);
    return solUsd ? Math.abs(fill.sol / fill.tokens) * solUsd : null;
  }

  /** null = token tidak cocok syarat buy real (tidak ada buy real). Gagal dicatat sebagai realStatus failed. */
  private async buyRealLeg(
    accountId: number, token: BuyCandidate, settings: BotSettings,
  ): Promise<{ leg: RealLegData; fill: SwapFill | null } | null> {
    const label = `${token.symbol ?? shortMint(token.mint)} [real]`;
    const log = this.logs.for(accountId);
    const misses = realBuyMisses(token.info, settings);
    if (misses.length > 0) {
      await log.info(`${label} tidak cocok syarat buy real (${misses.join(', ')}), paper saja`);
      return null;
    }

    const amountSol = settings.realBuy.amountSol;
    const failed = async (error: string) => {
      await log.error(`BUY ${label} gagal, posisi paper tetap dibuka: ${error}`);
      const leg: RealLegData = { realStatus: 'failed', realAmountSol: amountSol, realError: error };
      return { leg, fill: null };
    };

    try {
      const ctx = await this.context(accountId, settings);
      const max = (await this.executors.real.maxBuySol(ctx)) ?? 0;
      if (max < amountSol) return failed(`saldo wallet kurang: maks ${max.toFixed(4)} SOL setelah fee`);
      const tx = await this.executors.real.buy(token.mint, amountSol, ctx);
      const signature = tx?.signature ?? null;
      const fill = tx?.fill ?? null;
      await log.buy(
        `BUY ${label} ${amountSol} SOL${fill ? ` | swap ${(-fill.sol).toFixed(4)} SOL untuk ${fill.tokens} token` : ''}`
          + (signature ? ` sig ${signature}` : ''),
      );
      const leg: RealLegData = { realStatus: 'open', realAmountSol: amountSol, realBuySignature: signature };
      return { leg, fill };
    } catch (e) {
      return failed((e as Error).message);
    }
  }

  async close(id: number, reason: ExitReason, priceHint?: number): Promise<void> {
    const pos = await this.repo.claimForClose(id);
    if (!pos) throw conflict('Posisi tidak sedang open');
    const label = `${pos.symbol ?? shortMint(pos.mint)} [${pos.mode}]`;
    const log = this.logs.for(pos.accountId);

    try {
      const settings = await this.settings.get(pos.accountId);
      const price = priceHint ?? (await this.prices.getPrice(pos.mint)) ?? pos.currentPrice;
      if (!price || !pos.entryPrice) throw new Error('harga exit tidak tersedia');

      const ctx = await this.context(pos.accountId, settings);
      // Posisi mode real lama dijual lewat executor real; posisi paper tidak punya transaksi.
      const sellSignature = (await this.executors[pos.mode].sellAll(pos.mint, ctx))?.signature ?? null;
      // Kalau sell real gagal (selain token tidak ada), error dilempar dan seluruh posisi dicoba lagi.
      const real = pos.realStatus === 'open' ? await this.sellRealLeg(pos, ctx) : null;
      // Exit posisi yang ikut sell real = harga yang benar-benar didapat wallet, bukan harga yang memicu exit.
      const exitPrice = real?.exitPrice ?? price;
      const pct = pnlPct(pos.entryPrice, exitPrice);
      const pnlSol = pos.amountSol * (pct / 100);
      const realLeg = real?.leg.realStatus === 'closed' && real.leg.realPnlSol === null
        ? { ...real.leg, realPnlSol: (pos.realAmountSol ?? 0) * (pct / 100) }
        : real?.leg ?? {};

      await this.repo.markClosed(id, { exitPrice, exitReason: reason, pnlPct: pct, pnlSol, sellSignature, ...realLeg });
      await log.sell(
        `SELL ${label} (${reason}) @ $${exitPrice}${exitPrice !== price ? ` (pemicu $${price})` : ''}`
          + ` | PnL ${pct.toFixed(2)}% (${pnlSol.toFixed(4)} SOL)` + (sellSignature ? ` sig ${sellSignature}` : ''),
      );
    } catch (e) {
      if (e instanceof NoTokensError) {
        await this.repo.markFailed(id, e.message);
        await log.warn(`SELL ${label} dibatalkan: ${e.message}, posisi ditandai failed`);
        return;
      }
      // Balik ke open supaya dicoba lagi di cek harga berikutnya.
      const message = (e as Error).message;
      await this.repo.revertToOpen(id, message);
      await log.error(`SELL ${label} gagal: ${message}`);
      throw e;
    }
  }

  /**
   * PnL real = SOL masuk dari sell - SOL keluar saat buy, dibaca dari kedua tx.
   * realPnlSol null kalau salah satu tx tidak terbaca; pemanggil lalu memperkirakannya dari PnL %.
   */
  private async sellRealLeg(pos: Position, ctx: TradeContext) {
    const label = `${pos.symbol ?? shortMint(pos.mint)} [real]`;
    const log = this.logs.for(pos.accountId);
    try {
      const sell = await this.executors.real.sellAll(pos.mint, ctx);
      const realSellSignature = sell?.signature ?? null;
      const buyFill = pos.realBuySignature
        ? await this.executors.real.readFill(pos.realBuySignature, pos.mint, ctx).catch(() => null)
        : null;
      const sellFill = sell?.fill ?? null;
      const exitPrice = sellFill ? await this.fillPriceUsd(sellFill) : null;

      if (!buyFill || !sellFill) {
        await log.warn(`SELL ${label}: hasil buy/sell real tidak terbaca dari chain, PnL real diperkirakan dari PnL %`);
        return { leg: { realStatus: 'closed' as const, realSellSignature, realPnlSol: null }, exitPrice };
      }
      const realPnlSol = sellFill.sol + buyFill.sol;
      await log.sell(
        `SELL ${label} | swap ${(-buyFill.sol).toFixed(4)} -> ${sellFill.sol.toFixed(4)} SOL | PnL ${realPnlSol.toFixed(4)} SOL`
          + (realSellSignature ? ` sig ${realSellSignature}` : ''),
      );
      return { leg: { realStatus: 'closed' as const, realSellSignature, realPnlSol }, exitPrice };
    } catch (e) {
      // Token sudah tidak ada di wallet: buy real tidak pernah masuk atau sudah dijual manual. Posisi paper tetap ditutup.
      if (!(e instanceof NoTokensError)) throw e;
      await log.warn(`SELL ${label} dilewati: ${e.message}`);
      return { leg: { realStatus: 'failed' as const, realError: e.message }, exitPrice: null };
    }
  }
}

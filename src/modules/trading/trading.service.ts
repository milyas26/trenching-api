import type { PriceSource } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { IPositionsRepository, ExitReason, TradeMode } from '../positions/positions.interfaces.ts';
import type { PositionsService } from '../positions/positions.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';
import type { AccountsService } from '../accounts/accounts.service.ts';
import { conflict } from '../../common/errors.ts';
import { pnlPct } from './exit-rules.ts';
import { ogTakeProfit } from './og-rule.ts';
import { NoTokensError, type BuyCandidate, type TradeContext, type TradeExecutor } from './trading.interfaces.ts';

const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** Batas selisih harga quote vs GMGN (kali lipat, naik atau turun) sebelum buy dibatalkan. */
export const MAX_PRICE_DEVIATION = 3;

export const priceDeviates = (quotePrice: number, gmgnPrice: number) =>
  Math.max(quotePrice / gmgnPrice, gmgnPrice / quotePrice) > MAX_PRICE_DEVIATION;

/** Buka/tutup posisi. Satu-satunya tempat yang memanggil executor (paper/real). */
export class TradingService {
  private readonly executors: Record<TradeMode, TradeExecutor>;

  constructor(
    private readonly repo: IPositionsRepository,
    private readonly positions: PositionsService,
    private readonly prices: PriceSource,
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

  /** @returns false kalau saldo tidak cukup, supaya pemanggil berhenti mencoba token lain. */
  async open(accountId: number, token: BuyCandidate, settings: BotSettings): Promise<boolean> {
    const { mode, buyAmountSol: amountSol } = settings;
    const label = `${token.symbol ?? shortMint(token.mint)} [${mode}]`;
    const log = this.logs.for(accountId);

    if (mode === 'paper' && (await this.positions.paperBalance(accountId, settings)) < amountSol) {
      await log.warn(`Saldo paper tidak cukup untuk buy ${label}`);
      return false;
    }
    const ctx = await this.context(accountId, settings);
    // Cek sebelum claim: kalau tidak, token ini tercatat failed dan tidak akan pernah dibeli lagi.
    const maxBuy = await this.executors[mode].maxBuySol(ctx).catch(async (e: Error) => {
      await log.error(`Cek saldo wallet gagal, buy ${label} dilewati: ${e.message}`);
      return 0;
    });
    if (maxBuy !== null && maxBuy < amountSol) {
      await log.warn(`Saldo wallet tidak cukup untuk buy ${label}: maks ${maxBuy.toFixed(4)} SOL setelah fee`);
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

    // Disimpan di posisi supaya TP-nya tetap walau pengaturan OG diubah setelah beli.
    const ogTp = ogTakeProfit(token.info, token.mc, settings);
    // Klaim mint dulu (unique akun+mode+mint) supaya token yang sama tidak pernah dibeli dua kali.
    const id = await this.repo.claim({
      accountId, mode, mint: token.mint, symbol: token.symbol, name: token.name, logo: token.logo,
      amountSol, entryMc: token.mc, tokenInfo: token.info, takeProfitPct: ogTp,
    });
    if (id === null) return true;

    try {
      const signature = await this.executors[mode].buy(token.mint, amountSol, ctx);
      const quote = (await this.prices.getQuotes([token.mint]).catch(() => null))?.get(token.mint);
      const entry = quote?.priceUsd ?? token.price;
      if (!entry) throw new Error('harga entry tidak tersedia');

      // Supply tetap, jadi market cap = harga x supply untuk semua harga berikutnya.
      const supply = quote?.marketCap && quote.priceUsd
        ? quote.marketCap / quote.priceUsd
        : token.mc && token.price ? token.mc / token.price : null;

      await this.repo.markOpen(id, { entryPrice: entry, supply, buySignature: signature });
      await log.buy(
        `BUY ${label} ${amountSol} SOL @ $${entry}${ogTp === null ? '' : ` | token OG, TP ${ogTp}%`}${signature ? ` sig ${signature}` : ''}`,
      );
    } catch (e) {
      const message = (e as Error).message;
      await this.repo.markFailed(id, message);
      await log.error(`BUY ${label} gagal: ${message}`);
    }
    return true;
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

      const sellSignature = await this.executors[pos.mode].sellAll(pos.mint, await this.context(pos.accountId, settings));
      const pct = pnlPct(pos.entryPrice, price);
      const pnlSol = pos.amountSol * (pct / 100);

      await this.repo.markClosed(id, { exitPrice: price, exitReason: reason, pnlPct: pct, pnlSol, sellSignature });
      await log.sell(
        `SELL ${label} (${reason}) @ $${price} | PnL ${pct.toFixed(2)}% (${pnlSol.toFixed(4)} SOL)`
          + (sellSignature ? ` sig ${sellSignature}` : ''),
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
}

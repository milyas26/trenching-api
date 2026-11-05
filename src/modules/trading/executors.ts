import type { PumpapiClient, SendOptions } from '../../integrations/pumpapi/pumpapi.client.ts';
import { WSOL_MINT } from '../../integrations/pumpapi/pumpapi.types.ts';
import type { DexscreenerClient } from '../../integrations/dexscreener/dexscreener.client.ts';
import type { SolanaClient } from '../../integrations/solana/solana.client.ts';
import { NoTokensError, type TradeContext, type TradeExecutor } from './trading.interfaces.ts';

/** Simulasi: tidak ada transaksi on-chain, harga diambil dari pasar oleh TradingService. */
export class PaperExecutor implements TradeExecutor {
  readonly mode = 'paper' as const;
  async maxBuySol() { return null; }
  async buy() { return null; }
  async sellAll() { return null; }
}

const CONFIRM_TIMEOUT_MS = 60_000;
const CONFIRM_POLL_MS = 2_000;
/** Fee PumpAPI 0,25% per swap; buy lewat quote non-SOL = dua swap. */
const PUMPAPI_FEE = 0.005;
/** Rent token account (~0.002 SOL), fee jaringan, dan sisa untuk bayar fee sell nanti. */
const FEE_BUFFER_SOL = 0.01;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * PumpAPI mengembalikan signature begitu tx dikirim, bukan saat tx berhasil.
 * Tx yang gagal on-chain (mis. saldo kurang) tetap dapat signature, jadi hasilnya dicek ke chain.
 */
export class RealExecutor implements TradeExecutor {
  readonly mode = 'real' as const;

  constructor(
    private readonly pumpapi: PumpapiClient,
    private readonly solana: SolanaClient,
    private readonly dexscreener: DexscreenerClient,
  ) {}

  async maxBuySol(ctx: TradeContext) {
    const balance = await this.solana.getBalanceSol(wallet(ctx));
    return Math.max(0, (balance - ctx.priorityFeeSol * 2 - FEE_BUFFER_SOL) / (1 + PUMPAPI_FEE));
  }

  async buy(mint: string, amountSol: number, ctx: TradeContext) {
    const quoteMint = ctx.quoteRoute === 'sol' ? WSOL_MINT : await this.topQuoteMint(mint);
    const { signature } = quoteMint === WSOL_MINT
      ? await this.pumpapi.buyWithSol(sendOpts(ctx), mint, amountSol)
      : await this.pumpapi.buyViaQuote(sendOpts(ctx), mint, quoteMint, amountSol);
    const landed = await this.confirm(signature, 'buy');
    if (!landed && (await this.tokenBalance(ctx, mint)) === 0n) {
      throw new Error(`tx buy ${signature} tidak terkonfirmasi dan token tidak ada di wallet`);
    }
    return signature;
  }

  async sellAll(mint: string, ctx: TradeContext) {
    if ((await this.tokenBalance(ctx, mint)) === 0n) throw new NoTokensError();
    const { signature, quoteMint } = await this.pumpapi.sellAll(sendOpts(ctx), mint, ctx.quoteRoute === 'sol' ? WSOL_MINT : undefined);
    const landed = await this.confirm(signature, 'sell');
    if (!landed && (await this.tokenBalance(ctx, mint)) > 0n) {
      throw new Error(`tx sell ${signature} tidak terkonfirmasi, token masih di wallet`);
    }
    if (quoteMint && quoteMint !== WSOL_MINT) await this.sellQuoteToSol(ctx, quoteMint);
    return signature;
  }

  /**
   * Quote pool terbesar menurut DexScreener. WSOL kalau tidak diketahui, supaya perilakunya sama seperti
   * token biasa dan error-nya datang dari PumpAPI, bukan dari lookup.
   */
  private async topQuoteMint(mint: string): Promise<string> {
    const top = (await this.dexscreener.getPairs(mint).catch(() => []))[0];
    return top?.quoteToken?.address ?? WSOL_MINT;
  }

  /**
   * Hasil sell di pool non-SOL (mis. WBTC) ditukar balik ke SOL. Token utama sudah terjual,
   * jadi gagal di sini tidak menggagalkan sell; quote-nya tertinggal di wallet.
   */
  private async sellQuoteToSol(ctx: TradeContext, quoteMint: string) {
    try {
      const { signature } = await this.pumpapi.sellAll(sendOpts(ctx), quoteMint, WSOL_MINT);
      await this.confirm(signature, 'sell');
    } catch (err) {
      console.error(`[real] gagal menukar quote ${quoteMint} ke SOL, tersisa di wallet:`, err);
    }
  }

  /** true = sukses on-chain, false = belum terlihat sampai timeout. Tx yang error dilempar. */
  private async confirm(signature: string, action: 'buy' | 'sell'): Promise<boolean> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(CONFIRM_POLL_MS);
      const status = await this.solana.getSignatureStatus(signature).catch(() => null);
      if (!status) continue;
      if (status.err) throw new Error(`tx ${action} gagal on-chain: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return true;
    }
    return false;
  }

  private tokenBalance(ctx: TradeContext, mint: string) {
    return this.solana.getTokenBalanceRaw(wallet(ctx), mint);
  }
}

function sendOpts(ctx: TradeContext): SendOptions {
  return { apiKey: ctx.apiKey, slippagePct: ctx.slippagePct, priorityFeeSol: ctx.priorityFeeSol };
}

function wallet(ctx: TradeContext) {
  if (!ctx.wallet) throw new Error('Wallet belum diisi untuk akun ini (Pengaturan > Akun, atau WALLET_PUBLIC_KEY di api/.env)');
  return ctx.wallet;
}

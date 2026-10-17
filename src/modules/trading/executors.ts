import type { PumpportalClient } from '../../integrations/pumpportal/pumpportal.client.ts';
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
/** Fee PumpPortal Lightning 1% dari nilai trade. */
const PUMPPORTAL_FEE = 0.01;
/** Rent token account (~0.002 SOL), fee jaringan, dan sisa untuk bayar fee sell nanti. */
const FEE_BUFFER_SOL = 0.01;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * PumpPortal mengembalikan signature begitu tx dikirim, bukan saat tx berhasil.
 * Tx yang gagal on-chain (mis. saldo kurang) tetap dapat signature, jadi hasilnya dicek ke chain.
 */
export class RealExecutor implements TradeExecutor {
  readonly mode = 'real' as const;

  constructor(
    private readonly pumpportal: PumpportalClient,
    private readonly solana: SolanaClient,
  ) {}

  async maxBuySol(ctx: TradeContext) {
    const balance = await this.solana.getBalanceSol(wallet(ctx));
    return Math.max(0, (balance - ctx.priorityFeeSol * 2 - FEE_BUFFER_SOL) / (1 + PUMPPORTAL_FEE));
  }

  async buy(mint: string, amountSol: number, ctx: TradeContext) {
    const signature = await this.pumpportal.buy(ctx.apiKey, mint, amountSol, ctx);
    const landed = await this.confirm(signature, 'buy');
    if (!landed && (await this.tokenBalance(ctx, mint)) === 0n) {
      throw new Error(`tx buy ${signature} tidak terkonfirmasi dan token tidak ada di wallet`);
    }
    return signature;
  }

  async sellAll(mint: string, ctx: TradeContext) {
    if ((await this.tokenBalance(ctx, mint)) === 0n) throw new NoTokensError();
    const signature = await this.pumpportal.sellAll(ctx.apiKey, mint, ctx);
    const landed = await this.confirm(signature, 'sell');
    if (!landed && (await this.tokenBalance(ctx, mint)) > 0n) {
      throw new Error(`tx sell ${signature} tidak terkonfirmasi, token masih di wallet`);
    }
    return signature;
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

function wallet(ctx: TradeContext) {
  if (!ctx.wallet) throw new Error('Wallet belum diisi untuk akun ini (Pengaturan > Akun, atau WALLET_PUBLIC_KEY di api/.env)');
  return ctx.wallet;
}

import type { SolanaClient } from '../solana/solana.client.ts';
import type { SolanaWsClient } from '../solana/solana-ws.client.ts';
import { isPubkey } from '../solana/pubkey.ts';
import type { TokenQuote } from '../dexscreener/dexscreener.types.ts';
import {
  MAX_SANE_MC_USD, PYTH_SOL_USD, WSOL_MINT,
  bondingCurveAddress, pumpSwapPoolAddress,
  decodeBondingCurve, decodeMint, decodePumpSwapPool, decodePumpSwapVirtualQuote, decodePythPrice,
  decodeTokenAmount, spotPriceSol,
} from './onchain.layouts.ts';

const MAX_SOL_PRICE_AGE_SEC = 300;
/** Notifikasi vault dan pool dari satu slot datang berselang beberapa ms; tunggu semuanya sebelum hitung harga. */
const POOL_SETTLE_MS = 30;

export type QuoteListener = (mint: string, quote: TokenQuote) => void;

interface VaultState {
  amount: bigint;
  slot: number;
}

type Venue =
  | { kind: 'resolving' }
  /** Belum bisa di-stream (mis. curve sudah complete tapi pool belum ada), dicoba lagi di watch() berikutnya. */
  | { kind: 'retry' }
  /** Venue lain atau curve non-SOL: harga hanya dari polling. */
  | { kind: 'none' }
  | { kind: 'curve'; address: string }
  | {
      kind: 'pool';
      address: string;
      baseVault: string;
      quoteVault: string;
      virtualQuote: bigint;
      base: VaultState | null;
      quote: VaultState | null;
      settleTimer: NodeJS.Timeout | null;
    };

interface Watched {
  venue: Venue;
  decimals: number;
  supply: bigint;
}

/**
 * Push harga posisi open lewat accountSubscribe: bonding curve pump.fun, atau pool PumpSwap
 * beserta kedua vault-nya, plus feed Pyth SOL/USD. Setiap update akun langsung jadi quote baru
 * untuk listener; polling OnchainPriceClient tetap jalan sebagai heartbeat.
 */
export class OnchainPriceStream {
  private readonly watched = new Map<string, Watched>();
  private readonly listeners: QuoteListener[] = [];
  private solUsd: number | null = null;

  constructor(
    private readonly solana: SolanaClient,
    private readonly ws: SolanaWsClient,
  ) {}

  onQuote(listener: QuoteListener) {
    this.listeners.push(listener);
  }

  /** Samakan subscription dengan daftar mint yang sedang open. */
  async watch(mints: string[]): Promise<void> {
    const wanted = new Set(mints.filter(isPubkey));
    for (const mint of [...this.watched.keys()]) if (!wanted.has(mint)) this.unwatch(mint);

    const toResolve: string[] = [];
    for (const mint of wanted) {
      const w = this.watched.get(mint);
      if (!w || w.venue.kind === 'retry') toResolve.push(mint);
    }
    if (this.watched.size === 0 && toResolve.length === 0) return;

    this.ws.subscribe(PYTH_SOL_USD, (data) => this.onPyth(data));
    if (toResolve.length > 0) await this.resolve(toResolve);
  }

  unwatch(mint: string) {
    const w = this.watched.get(mint);
    if (!w) return;
    this.watched.delete(mint);
    this.unsubscribeVenue(w.venue);
    if (this.watched.size === 0) this.ws.unsubscribe(PYTH_SOL_USD);
  }

  close() {
    for (const w of this.watched.values()) this.unsubscribeVenue(w.venue);
    this.watched.clear();
    this.ws.close();
  }

  /** Baca snapshot sekali untuk menentukan venue, desimal, dan alamat vault. Harga awal tetap dari polling. */
  private async resolve(mints: string[]) {
    const entries = new Map<string, Watched>();
    const keys = [PYTH_SOL_USD];
    for (const mint of mints) {
      const w: Watched = { venue: { kind: 'resolving' }, decimals: 0, supply: 0n };
      this.watched.set(mint, w);
      entries.set(mint, w);
      keys.push(mint, bondingCurveAddress(mint), pumpSwapPoolAddress(mint));
    }

    let accounts;
    try {
      accounts = await this.solana.getMultipleAccounts(keys);
    } catch {
      for (const w of entries.values()) w.venue = { kind: 'retry' };
      return;
    }

    const pyth = accounts.get(PYTH_SOL_USD);
    if (pyth) this.onPyth(pyth.data);

    for (const [mint, w] of entries) {
      // Sudah di-unwatch atau di-resolve ulang selama request berjalan.
      if (this.watched.get(mint) !== w) continue;
      const mintAcc = accounts.get(mint);
      if (!mintAcc) {
        w.venue = { kind: 'none' };
        continue;
      }
      ({ decimals: w.decimals, supply: w.supply } = decodeMint(mintAcc.data));

      const curveAddress = bondingCurveAddress(mint);
      const bc = accounts.get(curveAddress);
      if (bc) {
        const curve = decodeBondingCurve(bc.data);
        if (!curve.quotedInSol) {
          w.venue = { kind: 'none' };
          continue;
        }
        if (!curve.complete) {
          w.venue = { kind: 'curve', address: curveAddress };
          this.ws.subscribe(curveAddress, (data) => this.onCurve(mint, w, data));
          continue;
        }
      }

      const poolAddress = pumpSwapPoolAddress(mint);
      const poolAcc = accounts.get(poolAddress);
      if (!poolAcc) {
        // Curve complete tapi migrasi belum selesai; tanpa curve sama sekali berarti venue lain.
        w.venue = { kind: bc ? 'retry' : 'none' };
        continue;
      }
      const pool = decodePumpSwapPool(poolAcc.data);
      if (pool.baseMint !== mint || pool.quoteMint !== WSOL_MINT) {
        w.venue = { kind: 'none' };
        continue;
      }
      const venue: Venue = {
        kind: 'pool',
        address: poolAddress,
        baseVault: pool.baseVault,
        quoteVault: pool.quoteVault,
        virtualQuote: decodePumpSwapVirtualQuote(poolAcc.data),
        base: null,
        quote: null,
        settleTimer: null,
      };
      w.venue = venue;
      this.ws.subscribe(poolAddress, (data) => {
        venue.virtualQuote = decodePumpSwapVirtualQuote(data);
        this.emitPool(mint, w, venue);
      });
      this.ws.subscribe(venue.baseVault, (data, slot) => {
        venue.base = { amount: decodeTokenAmount(data), slot };
        this.emitPool(mint, w, venue);
      });
      this.ws.subscribe(venue.quoteVault, (data, slot) => {
        venue.quote = { amount: decodeTokenAmount(data), slot };
        this.emitPool(mint, w, venue);
      });
    }
  }

  private unsubscribeVenue(venue: Venue) {
    if (venue.kind === 'curve') this.ws.unsubscribe(venue.address);
    if (venue.kind === 'pool') {
      if (venue.settleTimer) clearTimeout(venue.settleTimer);
      this.ws.unsubscribe(venue.address);
      this.ws.unsubscribe(venue.baseVault);
      this.ws.unsubscribe(venue.quoteVault);
    }
  }

  private onPyth(data: Buffer) {
    if (data.length < 100) return;
    const { price, publishTime } = decodePythPrice(data);
    const fresh = price > 0 && Date.now() / 1000 - publishTime < MAX_SOL_PRICE_AGE_SEC;
    this.solUsd = fresh ? price : null;
  }

  private onCurve(mint: string, w: Watched, data: Buffer) {
    if (data.length < 49) return;
    const curve = decodeBondingCurve(data);
    if (curve.complete) {
      // Graduate: pindah ke pool PumpSwap begitu migrasi selesai.
      this.unsubscribeVenue(w.venue);
      w.venue = { kind: 'retry' };
      void this.resolve([mint]);
      return;
    }
    this.emit(mint, w, spotPriceSol(curve.virtualSolReserves, curve.virtualTokenReserves, w.decimals), 'pump');
  }

  /**
   * Satu swap mengubah kedua vault dan akun pool (virtual quote) dalam slot yang sama, tapi
   * notifikasinya datang terpisah. Harga dihitung setelah jeda singkat dan hanya jika kedua
   * vault berada di slot yang sama, supaya tidak ada harga setengah jadi yang memicu TP/SL palsu.
   */
  private emitPool(mint: string, w: Watched, venue: Extract<Venue, { kind: 'pool' }>) {
    if (venue.settleTimer) return;
    venue.settleTimer = setTimeout(() => {
      venue.settleTimer = null;
      if (!venue.base || !venue.quote || venue.base.slot !== venue.quote.slot) return;
      const solReserve = venue.quote.amount + venue.virtualQuote;
      this.emit(mint, w, spotPriceSol(solReserve, venue.base.amount, w.decimals), 'pumpswap');
    }, POOL_SETTLE_MS);
  }

  private emit(mint: string, w: Watched, priceSol: number | null, source: TokenQuote['source']) {
    if (priceSol === null || this.solUsd === null || this.watched.get(mint) !== w) return;
    const priceUsd = priceSol * this.solUsd;
    const marketCap = priceUsd * (Number(w.supply) / 10 ** w.decimals);
    // Hasil baca akun yang salah; polling (dengan fallback Dexscreener) tetap jalan sebagai heartbeat.
    if (!Number.isFinite(marketCap) || marketCap > MAX_SANE_MC_USD) return;
    const quote: TokenQuote = { priceUsd, marketCap, source };
    for (const listener of this.listeners) listener(mint, quote);
  }
}

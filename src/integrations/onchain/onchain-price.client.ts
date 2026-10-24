import type { SolanaClient, AccountInfo } from '../solana/solana.client.ts';
import { isPubkey } from '../solana/pubkey.ts';
import type { DexscreenerClient } from '../dexscreener/dexscreener.client.ts';
import type { GeckoterminalClient } from '../geckoterminal/geckoterminal.client.ts';
import type { PriceSource, TokenQuote } from '../dexscreener/dexscreener.types.ts';
import {
  MAX_SANE_MC_USD, PYTH_SOL_USD, SOL_DECIMALS, WSOL_MINT,
  bondingCurveAddress, pumpSwapPoolAddress,
  decodeBondingCurve, decodeMint, decodePumpSwapPool, decodePumpSwapVirtualQuote, decodePythPrice,
  decodeTokenAmount, spotPriceSol,
} from './onchain.layouts.ts';

/** Feed Pyth lebih tua dari ini dianggap mati, semua harga jatuh ke Dexscreener. */
const MAX_SOL_PRICE_AGE_SEC = 300;

interface PumpSwapPool {
  address: string;
  baseVault: string;
  quoteVault: string;
  quoteMint: string;
}

/** Harga USD token quote selain SOL (mis. PSOL) cukup diambil ulang tiap menit. */
const QUOTE_USD_TTL_MS = 60_000;
const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

/**
 * Harga spot langsung dari akun on-chain (commitment confirmed), tanpa cache API pihak ketiga.
 * - Bonding curve pump.fun: virtual quote / virtual token reserves.
 * - Sudah graduate ke PumpSwap: (saldo vault quote + virtual quote reserve pool) / saldo vault token.
 * SOL/USD dari Pyth. Curve dan pool yang di-quote token lain (mis. PSOL) dikonversi memakai harga USD
 * token quote dari Dexscreener. Token di venue lain (Raydium, Meteora, dll) jatuh ke Dexscreener,
 * lalu GeckoTerminal untuk yang masih kosong.
 */
export class OnchainPriceClient implements PriceSource {
  private readonly pdas = new Map<string, { bondingCurve: string; pool: string }>();
  /** Alamat vault tidak pernah berubah setelah pool dibuat, jadi cukup dibaca sekali. */
  private readonly pools = new Map<string, PumpSwapPool>();
  /** Quote mint curve per token, hanya yang bukan SOL; menentukan alamat pool PumpSwap-nya. */
  private readonly quoteMints = new Map<string, string>();
  private readonly quoteDecimals = new Map<string, number>([[WSOL_MINT, SOL_DECIMALS]]);
  private readonly quoteUsdCache = new Map<string, { usd: number; at: number }>();

  constructor(
    private readonly solana: SolanaClient,
    private readonly fallback: DexscreenerClient,
    private readonly gecko: GeckoterminalClient,
  ) {}

  async getQuotes(mints: string[]): Promise<Map<string, TokenQuote>> {
    const all = [...new Set(mints)];
    // Satu alamat tidak valid membuat seluruh getMultipleAccounts ditolak RPC.
    const unique = all.filter(isPubkey);
    const result = new Map<string, TokenQuote>();

    let onchainError: Error | null = null;
    try {
      await this.readOnchain(unique, result);
    } catch (e) {
      onchainError = e as Error;
    }

    // Error baru dilempar kalau semua sumber yang dicoba gagal, supaya monitor mencatat lastPriceError.
    const errors: string[] = onchainError ? [onchainError.message] : [];
    let anySucceeded = !onchainError;
    const missing = all.filter((mint) => !result.has(mint));
    if (missing.length > 0) {
      try {
        for (const [mint, q] of await this.fallback.getQuotes(missing)) result.set(mint, q);
        anySucceeded = true;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }

    const stillMissing = all.filter((mint) => !result.has(mint));
    if (stillMissing.length > 0) {
      try {
        for (const [mint, priceUsd] of await this.gecko.getTokenPrices(stillMissing)) {
          result.set(mint, { priceUsd, marketCap: null, source: 'geckoterminal' });
        }
        anySucceeded = true;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (!anySucceeded) throw new Error(errors.join('; '));
    return result;
  }

  async getPrice(mint: string): Promise<number | null> {
    return (await this.getQuotes([mint])).get(mint)?.priceUsd ?? null;
  }

  private async readOnchain(unique: string[], result: Map<string, TokenQuote>): Promise<void> {
    // Request 1: SOL/USD, mint, pool, lalu vault (jika pool sudah dikenal) atau bonding curve.
    const keys = [PYTH_SOL_USD];
    for (const mint of unique) {
      const { bondingCurve, pool } = this.pdasOf(mint);
      keys.push(mint, pool);
      const known = this.pools.get(mint);
      if (known) keys.push(known.baseVault, known.quoteVault);
      else keys.push(bondingCurve);
    }
    const accounts = await this.solana.getMultipleAccounts(keys);

    const solUsd = this.solUsd(accounts.get(PYTH_SOL_USD));
    if (solUsd === null) return;

    // Curve yang belum graduate dan di-quote token selain SOL; dihitung setelah harga quote-nya ada.
    const curves: { mint: string; quoteMint: string; quoteReserve: bigint; tokenReserve: bigint }[] = [];
    // Token yang baru ketahuan di-quote token lain: pool-nya beda alamat dan belum ikut request 1.
    const rediscover: string[] = [];
    const newVaults: string[] = [];

    for (const mint of unique) {
      const mintAcc = accounts.get(mint);
      if (!mintAcc || this.pools.has(mint)) continue;
      const { bondingCurve, pool } = this.pdasOf(mint);

      const bc = accounts.get(bondingCurve);
      if (bc) {
        const curve = decodeBondingCurve(bc.data);
        if (!curve.complete) {
          if (curve.quotedInSol) {
            const { decimals, supply } = decodeMint(mintAcc.data);
            const priceSol = spotPriceSol(curve.virtualSolReserves, curve.virtualTokenReserves, decimals);
            const q = priceSol === null ? null : quote(priceSol * solUsd, supply, decimals, 'pump');
            if (q) result.set(mint, q);
          } else {
            curves.push({ mint, quoteMint: curve.quoteMint, quoteReserve: curve.virtualSolReserves, tokenReserve: curve.virtualTokenReserves });
          }
          continue;
        }
        if (curve.quoteMint !== this.quoteOf(mint)) {
          this.quoteMints.set(mint, curve.quoteMint);
          this.pdas.delete(mint);
          rediscover.push(mint);
          continue;
        }
      }

      const poolAcc = accounts.get(pool);
      if (poolAcc) this.registerPool(mint, pool, poolAcc, newVaults);
    }

    // Request 2 (sekali per token): pool PumpSwap untuk quote non-SOL yang baru ketahuan.
    if (rediscover.length > 0) {
      const pools = rediscover.map((mint) => this.pdasOf(mint).pool);
      const fetched = await this.solana.getMultipleAccounts(pools);
      rediscover.forEach((mint, i) => {
        const acc = fetched.get(pools[i]!);
        if (!acc) return;
        accounts.set(pools[i]!, acc);
        this.registerPool(mint, pools[i]!, acc, newVaults);
      });
    }

    // Request 3 hanya untuk vault pool yang baru dikenal dan desimal token quote yang belum diketahui.
    const quoteMintsNeeded = new Set([
      ...curves.map((c) => c.quoteMint),
      ...unique.flatMap((mint) => this.pools.get(mint)?.quoteMint ?? []),
    ]);
    const missingDecimals = [...quoteMintsNeeded].filter((m) => !this.quoteDecimals.has(m));
    if (newVaults.length > 0 || missingDecimals.length > 0) {
      for (const [key, acc] of await this.solana.getMultipleAccounts([...newVaults, ...missingDecimals])) {
        accounts.set(key, acc);
      }
      for (const m of missingDecimals) {
        const acc = accounts.get(m);
        if (acc) this.quoteDecimals.set(m, decodeMint(acc.data).decimals);
      }
    }
    const quoteUsd = await this.quoteUsd([...quoteMintsNeeded], solUsd);

    for (const c of curves) {
      const mintAcc = accounts.get(c.mint)!;
      const usd = quoteUsd.get(c.quoteMint);
      const quoteDecimals = this.quoteDecimals.get(c.quoteMint);
      if (usd === undefined || quoteDecimals === undefined) continue;
      const { decimals, supply } = decodeMint(mintAcc.data);
      const priceQuote = spotPriceSol(c.quoteReserve, c.tokenReserve, decimals, quoteDecimals);
      const q = priceQuote === null ? null : quote(priceQuote * usd, supply, decimals, 'pump');
      if (q) result.set(c.mint, q);
    }

    for (const mint of unique) {
      const known = this.pools.get(mint);
      const mintAcc = accounts.get(mint);
      const poolAcc = known && accounts.get(known.address);
      const base = known && accounts.get(known.baseVault);
      const quoteAcc = known && accounts.get(known.quoteVault);
      if (!known || !mintAcc || !poolAcc || !base || !quoteAcc) continue;
      const usd = quoteUsd.get(known.quoteMint);
      const quoteDecimals = this.quoteDecimals.get(known.quoteMint);
      if (usd === undefined || quoteDecimals === undefined) continue;

      const { decimals, supply } = decodeMint(mintAcc.data);
      const quoteReserve = decodeTokenAmount(quoteAcc.data) + decodePumpSwapVirtualQuote(poolAcc.data);
      const priceQuote = spotPriceSol(quoteReserve, decodeTokenAmount(base.data), decimals, quoteDecimals);
      const q = priceQuote === null ? null : quote(priceQuote * usd, supply, decimals, 'pumpswap');
      if (q) result.set(mint, q);
    }
  }

  private registerPool(mint: string, address: string, acc: AccountInfo, newVaults: string[]) {
    const decoded = decodePumpSwapPool(acc.data);
    if (decoded.baseMint !== mint || decoded.quoteMint !== this.quoteOf(mint)) return;
    this.pools.set(mint, { address, baseVault: decoded.baseVault, quoteVault: decoded.quoteVault, quoteMint: decoded.quoteMint });
    newVaults.push(decoded.baseVault, decoded.quoteVault);
  }

  /** Harga USD per token quote. Gagal ambil harga token non-SOL tidak fatal: token itu jatuh ke fallback. */
  private async quoteUsd(quoteMints: string[], solUsd: number): Promise<Map<string, number>> {
    const result = new Map<string, number>([[WSOL_MINT, solUsd]]);
    const now = Date.now();
    const stale: string[] = [];
    for (const m of quoteMints) {
      if (m === WSOL_MINT) continue;
      if (STABLE_MINTS.has(m)) {
        result.set(m, 1);
        continue;
      }
      const cached = this.quoteUsdCache.get(m);
      if (cached && now - cached.at < QUOTE_USD_TTL_MS) result.set(m, cached.usd);
      else stale.push(m);
    }
    if (stale.length === 0) return result;
    try {
      for (const [m, q] of await this.fallback.getQuotes(stale)) {
        this.quoteUsdCache.set(m, { usd: q.priceUsd, at: now });
        result.set(m, q.priceUsd);
      }
    } catch {
      // Pakai harga lama kalau ada, daripada token itu kehilangan harga sama sekali.
      for (const m of stale) {
        const cached = this.quoteUsdCache.get(m);
        if (cached) result.set(m, cached.usd);
      }
    }
    return result;
  }

  private quoteOf(mint: string) {
    return this.quoteMints.get(mint) ?? WSOL_MINT;
  }

  private pdasOf(mint: string) {
    let pdas = this.pdas.get(mint);
    if (!pdas) {
      pdas = { bondingCurve: bondingCurveAddress(mint), pool: pumpSwapPoolAddress(mint, this.quoteOf(mint)) };
      this.pdas.set(mint, pdas);
    }
    return pdas;
  }

  private solUsd(acc: AccountInfo | null | undefined): number | null {
    if (!acc) return null;
    const { price, publishTime } = decodePythPrice(acc.data);
    const age = Date.now() / 1000 - publishTime;
    return price > 0 && age < MAX_SOL_PRICE_AGE_SEC ? price : null;
  }
}

/** null kalau market cap-nya mustahil (lihat MAX_SANE_MC_USD); token itu lalu diambil dari Dexscreener. */
function quote(priceUsd: number, supply: bigint, decimals: number, source: TokenQuote['source']): TokenQuote | null {
  const marketCap = priceUsd * (Number(supply) / 10 ** decimals);
  return Number.isFinite(marketCap) && marketCap <= MAX_SANE_MC_USD ? { priceUsd, marketCap, source } : null;
}

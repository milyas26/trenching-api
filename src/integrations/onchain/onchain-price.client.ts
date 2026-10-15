import type { SolanaClient, AccountInfo } from '../solana/solana.client.ts';
import { isPubkey } from '../solana/pubkey.ts';
import type { DexscreenerClient } from '../dexscreener/dexscreener.client.ts';
import type { PriceSource, TokenQuote } from '../dexscreener/dexscreener.types.ts';
import {
  PYTH_SOL_USD, WSOL_MINT,
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
}

/**
 * Harga spot langsung dari akun on-chain (commitment confirmed), tanpa cache API pihak ketiga.
 * - Bonding curve pump.fun: virtual SOL / virtual token reserves.
 * - Sudah graduate ke PumpSwap: (saldo vault WSOL + virtual quote reserve pool) / saldo vault token.
 * SOL/USD dari Pyth. Token di venue lain (Raydium, Meteora, dll) jatuh ke Dexscreener.
 */
export class OnchainPriceClient implements PriceSource {
  private readonly pdas = new Map<string, { bondingCurve: string; pool: string }>();
  /** Alamat vault tidak pernah berubah setelah pool dibuat, jadi cukup dibaca sekali. */
  private readonly pools = new Map<string, PumpSwapPool>();

  constructor(
    private readonly solana: SolanaClient,
    private readonly fallback: DexscreenerClient,
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

    const missing = all.filter((mint) => !result.has(mint));
    if (missing.length > 0) {
      try {
        for (const [mint, q] of await this.fallback.getQuotes(missing)) result.set(mint, q);
      } catch (e) {
        // Error baru dilempar kalau kedua sumber gagal, supaya monitor mencatat lastPriceError.
        if (onchainError) throw new Error(`${onchainError.message}; ${(e as Error).message}`);
      }
    }
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
    if (solUsd !== null) {
      // Request 2 hanya untuk token yang baru ketahuan graduate di poll ini.
      const newVaults: string[] = [];

      for (const mint of unique) {
        const mintAcc = accounts.get(mint);
        if (!mintAcc || this.pools.has(mint)) continue;
        const { bondingCurve, pool } = this.pdasOf(mint);

        const bc = accounts.get(bondingCurve);
        if (bc) {
          const curve = decodeBondingCurve(bc.data);
          if (!curve.quotedInSol) continue;
          if (!curve.complete) {
            const { decimals, supply } = decodeMint(mintAcc.data);
            const priceSol = spotPriceSol(curve.virtualSolReserves, curve.virtualTokenReserves, decimals);
            if (priceSol !== null) result.set(mint, quote(priceSol * solUsd, supply, decimals, 'pump'));
            continue;
          }
        }

        const poolAcc = accounts.get(pool);
        if (!poolAcc) continue;
        const decoded = decodePumpSwapPool(poolAcc.data);
        if (decoded.baseMint !== mint || decoded.quoteMint !== WSOL_MINT) continue;
        this.pools.set(mint, { address: pool, baseVault: decoded.baseVault, quoteVault: decoded.quoteVault });
        newVaults.push(decoded.baseVault, decoded.quoteVault);
      }

      if (newVaults.length > 0) {
        for (const [key, acc] of await this.solana.getMultipleAccounts(newVaults)) accounts.set(key, acc);
      }

      for (const mint of unique) {
        const known = this.pools.get(mint);
        const mintAcc = accounts.get(mint);
        const poolAcc = known && accounts.get(known.address);
        const base = known && accounts.get(known.baseVault);
        const quoteAcc = known && accounts.get(known.quoteVault);
        if (!mintAcc || !poolAcc || !base || !quoteAcc) continue;

        const { decimals, supply } = decodeMint(mintAcc.data);
        const solReserve = decodeTokenAmount(quoteAcc.data) + decodePumpSwapVirtualQuote(poolAcc.data);
        const priceSol = spotPriceSol(solReserve, decodeTokenAmount(base.data), decimals);
        if (priceSol !== null) result.set(mint, quote(priceSol * solUsd, supply, decimals, 'pumpswap'));
      }
    }
  }

  private pdasOf(mint: string) {
    let pdas = this.pdas.get(mint);
    if (!pdas) {
      pdas = { bondingCurve: bondingCurveAddress(mint), pool: pumpSwapPoolAddress(mint) };
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

function quote(priceUsd: number, supply: bigint, decimals: number, source: TokenQuote['source']): TokenQuote {
  return { priceUsd, marketCap: priceUsd * (Number(supply) / 10 ** decimals), source };
}

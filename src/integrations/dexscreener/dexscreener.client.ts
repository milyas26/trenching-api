import type { DexPair, PriceSource, TokenQuote } from './dexscreener.types.ts';

const BASE_URL = 'https://api.dexscreener.com/tokens/v1/solana/';
const MAX_PER_REQUEST = 30;

export class DexscreenerClient implements PriceSource {
  /** Harga USD per mint. Mint tanpa pair tidak muncul di Map hasil. */
  async getQuotes(mints: string[]): Promise<Map<string, TokenQuote>> {
    const result = new Map<string, TokenQuote>();
    const unique = [...new Set(mints)];

    for (let i = 0; i < unique.length; i += MAX_PER_REQUEST) {
      const chunk = unique.slice(i, i + MAX_PER_REQUEST);
      const res = await fetch(BASE_URL + chunk.join(','), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
      const pairs = (await res.json()) as DexPair[];

      // Satu token bisa punya banyak pair; pakai yang likuiditasnya paling besar.
      const best = new Map<string, { liquidity: number; quote: TokenQuote }>();
      for (const pair of pairs) {
        const mint = pair.baseToken?.address;
        if (!mint || !chunk.includes(mint) || !pair.priceUsd) continue;
        const liquidity = pair.liquidity?.usd ?? 0;
        const prev = best.get(mint);
        if (!prev || liquidity > prev.liquidity) {
          best.set(mint, {
            liquidity,
            quote: { priceUsd: Number(pair.priceUsd), marketCap: pair.marketCap ?? pair.fdv ?? null, source: 'dexscreener' },
          });
        }
      }
      for (const [mint, { quote }] of best) result.set(mint, quote);
    }
    return result;
  }

  async getPrice(mint: string): Promise<number | null> {
    return (await this.getQuotes([mint])).get(mint)?.priceUsd ?? null;
  }
}

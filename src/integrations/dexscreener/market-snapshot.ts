import type { DexPair } from './dexscreener.types.ts';

/**
 * Data pair DexScreener yang disimpan ke token_snapshots.market.
 * Dipakai review AI dan buy tanpa AI supaya bentuk datanya sama.
 */
export function buildMarketSnapshot(pair: DexPair, otherPairs: number) {
  return {
    dex: pair.dexId,
    priceUsd: Number(pair.priceUsd),
    marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    pairAgeMinutes: pair.pairCreatedAt ? Math.round((Date.now() - pair.pairCreatedAt) / 60_000) : null,
    priceChangePct: pair.priceChange,
    volumeUsd: pair.volume,
    txns: pair.txns,
    otherPairs,
    websites: pair.info?.websites?.map((w) => w.url) ?? [],
    socials: pair.info?.socials?.map((s) => `${s.type}: ${s.url}`) ?? [],
    activeBoosts: pair.boosts?.active ?? 0,
  };
}

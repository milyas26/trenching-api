import { setTimeout as sleep } from 'node:timers/promises';
import type { Candle } from './geckoterminal.types.ts';

const BASE_URL = 'https://api.geckoterminal.com/api/v2/networks/solana/pools/';
/** API publik GeckoTerminal sudah 429 setelah ~5 request beruntun, jadi request diberi jarak. */
const MIN_GAP_MS = 6_000;
const RETRY_AFTER_429_MS = 15_000;

export class GeckoterminalClient {
  private nextSlot = 0;

  /**
   * Candle 1 menit terbaru, urut lama ke baru. Menit tanpa trade tidak dikirim API,
   * dan candle terakhir bisa masih berjalan.
   */
  async getMinuteCandles(pool: string, limit: number): Promise<Candle[]> {
    const url = `${BASE_URL}${pool}/ohlcv/minute?aggregate=1&limit=${limit}&currency=usd`;
    let res = await this.get(url);
    if (res.status === 429) {
      await sleep(RETRY_AFTER_429_MS);
      res = await this.get(url);
    }
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    return (body.data?.attributes?.ohlcv_list ?? [])
      .map(([at = 0, open = 0, high = 0, low = 0, close = 0, volumeUsd = 0]) => ({ at, open, high, low, close, volumeUsd }))
      .reverse();
  }

  private async get(url: string) {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = now + wait + MIN_GAP_MS;
    await sleep(wait);
    return fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  }
}

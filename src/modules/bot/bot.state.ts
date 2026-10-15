import type { BotRuntimeState } from './bot.interfaces.ts';

/** State runtime (tidak disimpan di DB): hasil scan terakhir, waktu cek harga, error terakhir. */
export const createBotState = (): BotRuntimeState => ({
  scanning: false,
  lastScanAt: null,
  lastScanError: null,
  lastScanTokens: [],
  nextScanAt: null,
  lastPriceAt: null,
  lastPriceError: null,
});

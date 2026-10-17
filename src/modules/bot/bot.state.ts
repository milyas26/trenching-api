import type { PriceState, ScanState } from './bot.interfaces.ts';

const emptyScan = (): ScanState => ({
  scanning: false,
  lastScanAt: null,
  lastScanError: null,
  lastScanSource: null,
  lastScanFetched: [],
  lastScanTokens: [],
  lastScanRejected: new Map(),
  nextScanAt: null,
});

/** State runtime (tidak disimpan di DB): hasil scan terakhir per akun, waktu cek harga, error terakhir. */
export class BotState {
  readonly price: PriceState = { lastPriceAt: null, lastPriceError: null };
  private readonly scans = new Map<number, ScanState>();

  scan(accountId: number): ScanState {
    let state = this.scans.get(accountId);
    if (!state) {
      state = emptyScan();
      this.scans.set(accountId, state);
    }
    return state;
  }

  forget(accountId: number) {
    this.scans.delete(accountId);
  }
}

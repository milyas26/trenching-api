export interface Candle {
  /** unix detik, awal menit */
  at: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

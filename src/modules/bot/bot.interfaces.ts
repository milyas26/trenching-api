import type { HotToken, TokenInfo, TokenSource } from '../../integrations/gmgn/gmgn.types.ts';
import type { PositionStats, TradeMode } from '../positions/positions.interfaces.ts';

/** State scan satu akun (tidak disimpan di DB). */
export interface ScanState {
  scanning: boolean;
  lastScanAt: Date | null;
  lastScanError: string | null;
  lastScanSource: TokenSource | null;
  /** Semua token dari GMGN, sebelum filter Token Info. */
  lastScanFetched: HotToken[];
  /** Token yang lolos filter Token Info: kandidat buy. */
  lastScanTokens: HotToken[];
  /** mint -> alasan ditolak filter Token Info. */
  lastScanRejected: Map<string, string[]>;
  nextScanAt: Date | null;
}

/** Monitor harga berjalan untuk semua akun sekaligus. */
export interface PriceState {
  lastPriceAt: Date | null;
  lastPriceError: string | null;
}

export interface BotStatus {
  accountId: number;
  botEnabled: boolean;
  mode: TradeMode;
  source: TokenSource;
  wallet: string;
  pumpportalReady: boolean;
  /** Hanya diisi saat mode real. */
  walletBalanceSol: number | null;
  walletBalanceError: string | null;
  scanning: boolean;
  lastScanAt: Date | null;
  lastScanError: string | null;
  lastScanFetchedCount: number;
  lastScanCount: number;
  nextScanAt: Date | null;
  lastPriceAt: Date | null;
  lastPriceError: string | null;
  stats: PositionStats;
}

export interface Candidate extends Omit<HotToken, 'raw' | 'safety' | 'signals'> {
  info: TokenInfo;
  bought: boolean;
  /** Alasan ditolak filter Token Info; kosong = lolos. */
  rejectedBy: string[];
}

export interface CandidatesResponse {
  at: Date | null;
  source: TokenSource | null;
  tokens: Candidate[];
}

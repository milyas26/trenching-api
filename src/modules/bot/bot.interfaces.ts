import type { HotToken } from '../../integrations/gmgn/gmgn.types.ts';
import type { PositionStats, TradeMode } from '../positions/positions.interfaces.ts';

export interface BotRuntimeState {
  scanning: boolean;
  lastScanAt: Date | null;
  lastScanError: string | null;
  lastScanTokens: HotToken[];
  nextScanAt: Date | null;
  lastPriceAt: Date | null;
  lastPriceError: string | null;
}

export interface BotStatus {
  botEnabled: boolean;
  mode: TradeMode;
  wallet: string;
  pumpportalReady: boolean;
  scanning: boolean;
  lastScanAt: Date | null;
  lastScanError: string | null;
  lastScanCount: number;
  nextScanAt: Date | null;
  lastPriceAt: Date | null;
  lastPriceError: string | null;
  stats: PositionStats;
}

export interface Candidate extends HotToken {
  bought: boolean;
}

export interface CandidatesResponse {
  at: Date | null;
  tokens: Candidate[];
}

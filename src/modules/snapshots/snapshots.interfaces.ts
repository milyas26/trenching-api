import type { SnapshotDecision, TradeMode } from '../../generated/prisma/enums.ts';
import type { TokenSource } from '../../integrations/gmgn/gmgn.types.ts';

export type { SnapshotDecision };

export interface NewTokenSnapshot {
  accountId: number;
  mode: TradeMode;
  mint: string;
  symbol: string | null;
  decision: SnapshotDecision;
  confidence: number | null;
  reason: string | null;
  recheckGainPct: number | null;
  gmgn: Record<string, unknown>;
  market: unknown;
  chart: unknown;
  priceSamples: unknown;
}

export interface NewGmgnScan {
  accountId: number;
  source: TokenSource;
  filter: unknown;
  response: Record<string, unknown>;
  tokens: { mint: string; symbol: string | null; data: Record<string, unknown> }[];
}

export interface ISnapshotsRepository {
  create(data: NewTokenSnapshot): Promise<void>;
  createScan(data: NewGmgnScan): Promise<void>;
}

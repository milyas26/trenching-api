import type { SnapshotDecision, TradeMode } from '../../generated/prisma/enums.ts';

export type { SnapshotDecision };

export interface NewTokenSnapshot {
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
  filter: unknown;
  response: Record<string, unknown>;
  tokens: { mint: string; symbol: string | null; data: Record<string, unknown> }[];
}

export interface ISnapshotsRepository {
  create(data: NewTokenSnapshot): Promise<void>;
  createScan(data: NewGmgnScan): Promise<void>;
}

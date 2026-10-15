import type { Position } from '../../generated/prisma/client.ts';
import type { ExitReason, PositionStatus, TradeMode } from '../../generated/prisma/enums.ts';

export type { Position, ExitReason, PositionStatus, TradeMode };

export const ACTIVE_STATUSES: PositionStatus[] = ['opening', 'open', 'closing'];
export const FINISHED_STATUSES: PositionStatus[] = ['closed', 'failed'];

export type PositionView = 'open' | 'closed';

export interface ListPositionsQuery {
  view?: PositionView;
  mode?: TradeMode;
}

export interface NewPosition {
  mode: TradeMode;
  mint: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  amountSol: number;
  entryMc: number | null;
}

export interface OpenedPositionData {
  entryPrice: number;
  supply: number | null;
  buySignature: string | null;
}

/** Posisi untuk response API: market cap diturunkan dari harga x supply. */
export interface PositionDto extends Position {
  currentMc: number | null;
  highMc: number | null;
  exitMc: number | null;
}

export interface ClosedPositionData {
  exitPrice: number;
  exitReason: ExitReason;
  pnlPct: number;
  pnlSol: number;
  sellSignature: string | null;
}

export interface ModeStats {
  open: number;
  closed: number;
  wins: number;
  failed: number;
  realizedSol: number;
  unrealizedSol: number;
  lockedSol: number;
}

export interface PositionStats {
  paper: ModeStats & { balanceSol: number };
  real: ModeStats;
}

export interface IPositionsRepository {
  list(query: ListPositionsQuery, limit: number): Promise<Position[]>;
  boughtMints(): Promise<Set<string>>;
  countActive(mode: TradeMode): Promise<number>;
  findOpen(): Promise<Position[]>;
  /** Insert status 'opening'; null kalau mint sudah pernah ada di mode itu. */
  claim(data: NewPosition): Promise<number | null>;
  markOpen(id: number, data: OpenedPositionData): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
  updatePrice(id: number, price: number, highPrice: number, pnlPct: number): Promise<void>;
  /** open -> closing secara atomik; null kalau posisi tidak sedang open. */
  claimForClose(id: number): Promise<Position | null>;
  markClosed(id: number, data: ClosedPositionData): Promise<void>;
  revertToOpen(id: number, error: string): Promise<void>;
  recoverStuck(): Promise<{ id: number; mint: string; status: PositionStatus }[]>;
  /** Statistik semua mode sekaligus (3 query total, bukan 3 per mode). */
  allModeStats(): Promise<Record<TradeMode, ModeStats>>;
}

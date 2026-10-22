import type { Position } from '../../generated/prisma/client.ts';
import type { ExitReason, PositionStatus, TradeMode } from '../../generated/prisma/enums.ts';
import type { TokenInfo } from '../../integrations/gmgn/gmgn.types.ts';

export type { Position, ExitReason, PositionStatus, TradeMode };

export const ACTIVE_STATUSES: PositionStatus[] = ['opening', 'open', 'closing'];
export const FINISHED_STATUSES: PositionStatus[] = ['closed', 'failed'];

export type PositionView = 'open' | 'closed';

export interface ListPositionsQuery {
  accountId: number;
  view?: PositionView;
  mode?: TradeMode;
}

/** Field angka Token Info (JSON token_info) yang bisa disaring di riwayat. */
export const HISTORY_TOKEN_INFO_KEYS = [
  'top10Pct', 'devHoldPct', 'insiderPct', 'bundlerPct', 'phishingPct', 'sniperPct',
  'botDegenCount', 'botDegenPct', 'rugPct', 'swaps1h', 'sells1h', 'smartMoneyCount', 'kolCount',
] as const;

/**
 * Filter range riwayat. Satuan: entryMc USD, tokenAgeMinutes umur token saat dibeli (menit),
 * holdMinutes menit, buySellRatio1h rasio yang sama dengan chip di app (DexScreener, fallback GMGN).
 */
export const HISTORY_RANGE_KEYS = [
  ...HISTORY_TOKEN_INFO_KEYS, 'buySellRatio1h', 'entryMc', 'tokenAgeMinutes', 'holdMinutes',
] as const;
export type HistoryRangeKey = (typeof HISTORY_RANGE_KEYS)[number];
export type HistoryRanges = Partial<Record<HistoryRangeKey, { min?: number; max?: number }>>;

/** Field boolean Token Info yang bisa disaring: true = harus ya, false = harus tidak. */
export const HISTORY_FLAG_KEYS = ['devSold', 'dexPaid', 'communityTakeover', 'isOg'] as const;
export type HistoryFlagKey = (typeof HISTORY_FLAG_KEYS)[number];
export type HistoryFlags = Partial<Record<HistoryFlagKey, boolean>>;

export interface PositionHistoryQuery {
  accountId: number;
  mode?: TradeMode;
  /** Posisi tanpa nilai untuk field yang disaring (range maupun flag) ikut tersaring keluar. */
  ranges: HistoryRanges;
  flags: HistoryFlags;
  /** Id posisi terakhir dari halaman sebelumnya; kosong = halaman pertama. */
  cursor?: number;
  limit: number;
}

/** Ringkasan semua riwayat yang lolos filter, bukan hanya halaman yang sedang dimuat. */
export interface HistorySummary {
  /** closed + failed */
  total: number;
  closed: number;
  failed: number;
  wins: number;
  losses: number;
  /** Jumlah PnL posisi untung, jumlah PnL posisi rugi (negatif), dan totalnya. */
  profitSol: number;
  lossSol: number;
  netSol: number;
  /** Rata-rata dan ekstrem hanya dari posisi closed; null kalau belum ada yang closed. */
  avgPnlSol: number | null;
  avgPnlPct: number | null;
  bestPnlPct: number | null;
  worstPnlPct: number | null;
  avgHoldMinutes: number | null;
}

export interface PositionHistoryPage {
  /** Hanya ada di halaman pertama (tanpa cursor). */
  summary?: HistorySummary;
  items: PositionDto[];
  /** null = sudah halaman terakhir. */
  nextCursor: number | null;
}

export interface DailyPnlQuery {
  accountId: number;
  mode: TradeMode;
  /** Zona waktu IANA app (mis. Asia/Jakarta), supaya batas hari sama dengan jam di HP. */
  tz: string;
  /** Rentang tanggal YYYY-MM-DD, keduanya inklusif. */
  from: string;
  to: string;
}

/** PnL posisi closed yang ditutup pada satu tanggal; hari tanpa posisi closed tidak muncul. */
export interface DailyPnl {
  /** YYYY-MM-DD di zona waktu query. */
  date: string;
  closed: number;
  wins: number;
  losses: number;
  pnlSol: number;
}

export interface NewPosition {
  accountId: number;
  mode: TradeMode;
  mint: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  amountSol: number;
  entryMc: number | null;
  tokenInfo: TokenInfo | null;
  /** Take profit khusus posisi ini (aturan token OG); null = pakai take profit akun. */
  takeProfitPct: number | null;
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
  lowMc: number | null;
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
  /** Posisi closed dengan PnL > 0. */
  wins: number;
  /** Posisi closed dengan PnL < 0. PnL tepat 0 tidak dihitung win maupun loss. */
  losses: number;
  failed: number;
  realizedSol: number;
  unrealizedSol: number;
  lockedSol: number;
  /** Rata-rata PnL per posisi closed; null kalau belum ada yang closed. */
  avgPnlSol: number | null;
  avgPnlPct: number | null;
}

/** Keputusan beli yang tersimpan di token_snapshots, untuk popup detail posisi di app. */
export interface BuyReasonDto {
  /** no_ai = dibeli langsung tanpa review AI. */
  decision: 'buy' | 'no_ai';
  confidence: number | null;
  reason: string | null;
  recheckGainPct: number | null;
  /** Bentuk sama dengan ReviewEvidence agent; null untuk buy tanpa AI. */
  market: unknown;
  chart: unknown;
  priceSamples: unknown;
  decidedAt: Date;
}

export interface PositionStats {
  paper: ModeStats & { balanceSol: number };
  real: ModeStats;
}

export interface IPositionsRepository {
  list(query: ListPositionsQuery, limit: number): Promise<Position[]>;
  /** Posisi closed/failed, terbaru dulu, berhalaman lewat cursor id. */
  history(query: PositionHistoryQuery): Promise<Position[]>;
  historySummary(query: Omit<PositionHistoryQuery, 'cursor' | 'limit'>): Promise<HistorySummary>;
  /** PnL closed per tanggal dalam rentang, urut tanggal. */
  dailyPnl(query: DailyPnlQuery): Promise<DailyPnl[]>;
  /** Semua mint yang pernah dicoba buy oleh akun ini, paper maupun real, termasuk yang gagal. */
  boughtMints(accountId: number): Promise<Set<string>>;
  /** Tanpa mode = semua mode. */
  countActive(accountId: number, mode?: TradeMode): Promise<number>;
  findOpen(): Promise<Position[]>;
  /** Insert status 'opening'; null kalau mint sudah pernah ada di akun dan mode itu. */
  claim(data: NewPosition): Promise<number | null>;
  markOpen(id: number, data: OpenedPositionData): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
  updatePrice(id: number, price: number, highPrice: number, lowPrice: number, pnlPct: number): Promise<void>;
  /** open -> closing secara atomik; null kalau posisi tidak sedang open. */
  claimForClose(id: number): Promise<Position | null>;
  markClosed(id: number, data: ClosedPositionData): Promise<void>;
  revertToOpen(id: number, error: string): Promise<void>;
  recoverStuck(): Promise<{ id: number; accountId: number; mint: string; status: PositionStatus }[]>;
  findForAccount(id: number, accountId: number): Promise<Position | null>;
  /** Snapshot buy terakhir sebelum posisi dibuka; null untuk posisi lama sebelum snapshot disimpan. */
  buyReason(p: Pick<Position, 'accountId' | 'mint' | 'openedAt'>): Promise<BuyReasonDto | null>;
  /** Statistik semua mode satu akun sekaligus (4 query total, bukan 4 per mode). */
  allModeStats(accountId: number): Promise<Record<TradeMode, ModeStats>>;
}

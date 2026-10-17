export type AgentVerdict = 'buy' | 'skip';

export interface AgentDecision {
  decision: AgentVerdict;
  /** 0-100 */
  confidence: number;
  reason: string;
  /** Jumlah giliran model sampai keputusan keluar. */
  steps: number;
}

/** Data yang sudah dimuat agent selama review; disimpan ke token_snapshots tanpa fetch ulang. */
export interface ReviewEvidence {
  market: unknown;
  chart: unknown;
  priceSamples: PriceSample[];
  recheckGainPct: number | null;
}

export type ReviewedDecision = AgentDecision & { evidence: ReviewEvidence };

export interface PriceSample {
  /** unix ms */
  at: number;
  priceUsd: number;
  marketCap: number | null;
}

export type AgentStepKind = 'market' | 'holders' | 'chart' | 'recheck' | 'decision' | 'note';

/** Satu kejadian di loop review, ditampilkan di app sebagai baris timeline. */
export interface AgentStep {
  at: Date;
  /** Putaran model ke berapa (1..maxLoops). */
  loop: number;
  kind: AgentStepKind;
  title: string;
  detail: string;
  failed: boolean;
}

export type AgentReviewStatus = 'running' | AgentVerdict | 'error';

export interface AgentReview {
  id: number;
  mint: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  status: AgentReviewStatus;
  /** Yang sedang dikerjakan agent saat status running, mis. "Menunggu 20 dtk lalu cek harga". */
  activity: string | null;
  loop: number;
  maxLoops: number;
  confidence: number | null;
  reason: string | null;
  steps: AgentStep[];
  startedAt: Date;
  finishedAt: Date | null;
}

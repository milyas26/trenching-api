import type { HotScan, HotSearchFilter, HotToken } from '../../integrations/gmgn/gmgn.types.ts';
import type { ReviewedDecision } from '../agent/agent.interfaces.ts';
import type { TradeMode } from '../positions/positions.interfaces.ts';
import type { ISnapshotsRepository, NewTokenSnapshot } from './snapshots.interfaces.ts';

/** Data token saat keputusan buy/skip, disimpan untuk analisa. Gagal simpan tidak boleh menghentikan scan. */
export class SnapshotsService {
  constructor(private readonly repo: ISnapshotsRepository) {}

  /** Semua token dari satu scan GMGN, termasuk yang tidak pernah direview. */
  async scan(filter: HotSearchFilter, { response, tokens }: HotScan) {
    try {
      await this.repo.createScan({ filter, response, tokens: tokens.map((t) => ({ mint: t.mint, symbol: t.symbol, data: t.raw })) });
    } catch (e) {
      console.error('gagal simpan scan GMGN:', (e as Error).message);
    }
  }

  reviewed(token: HotToken, mode: TradeMode, d: ReviewedDecision) {
    return this.save(token, mode, {
      decision: d.decision, confidence: d.confidence, reason: d.reason,
      recheckGainPct: d.evidence.recheckGainPct, market: d.evidence.market, chart: d.evidence.chart, priceSamples: d.evidence.priceSamples,
    });
  }

  failed(token: HotToken, mode: TradeMode, error: string) {
    return this.save(token, mode, { decision: 'error', reason: error });
  }

  /** Buy langsung tanpa review AI. */
  unreviewed(token: HotToken, mode: TradeMode) {
    return this.save(token, mode, { decision: 'no_ai' });
  }

  private async save(token: HotToken, mode: TradeMode, data: Partial<NewTokenSnapshot> & Pick<NewTokenSnapshot, 'decision'>) {
    try {
      await this.repo.create({
        confidence: null, reason: null, recheckGainPct: null, market: null, chart: null, priceSamples: null,
        ...data,
        mode, mint: token.mint, symbol: token.symbol, gmgn: token.raw,
      });
    } catch (e) {
      console.error('gagal simpan token snapshot:', (e as Error).message);
    }
  }
}

import type { HotScan, HotSearchFilter, HotToken, TokenSource } from '../../integrations/gmgn/gmgn.types.ts';
import type { ReviewedDecision } from '../agent/agent.interfaces.ts';
import type { TradeMode } from '../positions/positions.interfaces.ts';
import type { ISnapshotsRepository, NewTokenSnapshot } from './snapshots.interfaces.ts';

/** Data token saat keputusan buy/skip, disimpan untuk analisa. Gagal simpan tidak boleh menghentikan scan. */
export class SnapshotsService {
  constructor(private readonly repo: ISnapshotsRepository) {}

  /** Semua token dari satu scan GMGN (sebelum filter Token Info), termasuk yang tidak pernah direview. */
  async scan(accountId: number, source: TokenSource, filter: HotSearchFilter, { response, tokens }: HotScan) {
    try {
      await this.repo.createScan({
        accountId, source, filter, response,
        tokens: tokens.map((t) => ({ mint: t.mint, symbol: t.symbol, data: t.raw })),
      });
    } catch (e) {
      console.error('gagal simpan scan GMGN:', (e as Error).message);
    }
  }

  reviewed(accountId: number, token: HotToken, mode: TradeMode, d: ReviewedDecision) {
    return this.save(accountId, token, mode, {
      decision: d.decision, confidence: d.confidence, reason: d.reason,
      recheckGainPct: d.evidence.recheckGainPct, market: d.evidence.market, chart: d.evidence.chart, priceSamples: d.evidence.priceSamples,
    });
  }

  failed(accountId: number, token: HotToken, mode: TradeMode, error: string) {
    return this.save(accountId, token, mode, { decision: 'error', reason: error });
  }

  /** Buy langsung tanpa review AI. */
  unreviewed(accountId: number, token: HotToken, mode: TradeMode, market: unknown = null) {
    return this.save(accountId, token, mode, { decision: 'no_ai', market });
  }

  private async save(accountId: number, token: HotToken, mode: TradeMode, data: Partial<NewTokenSnapshot> & Pick<NewTokenSnapshot, 'decision'>) {
    try {
      await this.repo.create({
        confidence: null, reason: null, recheckGainPct: null, market: null, chart: null, priceSamples: null,
        ...data,
        accountId, mode, mint: token.mint, symbol: token.symbol, gmgn: token.raw,
      });
    } catch (e) {
      console.error('gagal simpan token snapshot:', (e as Error).message);
    }
  }
}

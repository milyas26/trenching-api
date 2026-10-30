import { notFound } from '../../common/errors.ts';
import type {
  BuyReasonDto, ClosedTrade, DailyPnl, DailyPnlQuery, IPositionsRepository, ListPositionsQuery, PositionDto, PositionHistoryPage, PositionHistoryQuery, PositionStats,
} from './positions.interfaces.ts';
import { toPositionDto } from './positions.mapper.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';

export class PositionsService {
  constructor(private readonly repo: IPositionsRepository) {}

  async list(query: ListPositionsQuery): Promise<PositionDto[]> {
    return (await this.repo.list(query, 200)).map(toPositionDto);
  }

  /** Ambil satu baris lebih untuk tahu masih ada halaman berikutnya tanpa query count. */
  async history(query: PositionHistoryQuery): Promise<PositionHistoryPage> {
    const [rows, summary] = await Promise.all([
      this.repo.history({ ...query, limit: query.limit + 1 }),
      query.cursor ? undefined : this.repo.historySummary(query),
    ]);
    const items = rows.slice(0, query.limit).map(toPositionDto);
    return { summary, items, nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async daily(query: DailyPnlQuery): Promise<{ days: DailyPnl[] }> {
    return { days: await this.repo.dailyPnl(query) };
  }

  async trades(query: DailyPnlQuery): Promise<{ trades: ClosedTrade[] }> {
    return { trades: await this.repo.closedTrades(query) };
  }

  async buyReason(accountId: number, id: number): Promise<{ buy: BuyReasonDto | null }> {
    const position = await this.repo.findForAccount(id, accountId);
    if (!position) throw notFound('Posisi tidak ditemukan');
    return { buy: await this.repo.buyReason(position) };
  }

  async stats(accountId: number, settings: BotSettings): Promise<PositionStats> {
    const { paper, real } = await this.repo.allModeStats(accountId);
    return {
      paper: { ...paper, balanceSol: settings.paperStartBalanceSol + paper.realizedSol - paper.lockedSol },
      real,
    };
  }

  async paperBalance(accountId: number, settings: BotSettings) {
    return (await this.stats(accountId, settings)).paper.balanceSol;
  }
}

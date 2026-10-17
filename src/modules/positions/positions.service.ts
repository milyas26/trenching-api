import type { IPositionsRepository, ListPositionsQuery, PositionDto, PositionStats } from './positions.interfaces.ts';
import { toPositionDto } from './positions.mapper.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';

export class PositionsService {
  constructor(private readonly repo: IPositionsRepository) {}

  async list(query: ListPositionsQuery): Promise<PositionDto[]> {
    return (await this.repo.list(query, 200)).map(toPositionDto);
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

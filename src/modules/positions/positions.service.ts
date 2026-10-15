import type { IPositionsRepository, ListPositionsQuery, PositionDto, PositionStats } from './positions.interfaces.ts';
import { toPositionDto } from './positions.mapper.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';

export class PositionsService {
  constructor(private readonly repo: IPositionsRepository) {}

  async list(query: ListPositionsQuery): Promise<PositionDto[]> {
    return (await this.repo.list(query, 200)).map(toPositionDto);
  }

  async stats(settings: BotSettings): Promise<PositionStats> {
    const { paper, real } = await this.repo.allModeStats();
    return {
      paper: { ...paper, balanceSol: settings.paperStartBalanceSol + paper.realizedSol - paper.lockedSol },
      real,
    };
  }

  async paperBalance(settings: BotSettings) {
    return (await this.stats(settings)).paper.balanceSol;
  }
}

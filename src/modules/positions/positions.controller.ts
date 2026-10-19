import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accountIdOf } from '../../common/account.ts';
import type { PositionsService } from './positions.service.ts';
import type { TradingService } from '../trading/trading.service.ts';

const listQuery = z.object({
  view: z.enum(['open', 'closed']).optional(),
  mode: z.enum(['paper', 'real']).optional(),
});
const historyQuery = z.object({
  mode: z.enum(['paper', 'real']).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

export class PositionsController {
  constructor(
    private readonly positions: PositionsService,
    private readonly trading: TradingService,
  ) {}

  list = (req: FastifyRequest) => this.positions.list({ accountId: accountIdOf(req), ...listQuery.parse(req.query) });

  history = (req: FastifyRequest) => this.positions.history({ accountId: accountIdOf(req), ...historyQuery.parse(req.query) });

  buyReason = (req: FastifyRequest) => this.positions.buyReason(accountIdOf(req), idParams.parse(req.params).id);

  close = async (req: FastifyRequest) => {
    const { id } = idParams.parse(req.params);
    await this.trading.close(id, 'manual');
    return { ok: true };
  };
}

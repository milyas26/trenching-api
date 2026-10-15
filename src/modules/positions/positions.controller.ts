import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PositionsService } from './positions.service.ts';
import type { TradingService } from '../trading/trading.service.ts';

const listQuery = z.object({
  view: z.enum(['open', 'closed']).optional(),
  mode: z.enum(['paper', 'real']).optional(),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

export class PositionsController {
  constructor(
    private readonly positions: PositionsService,
    private readonly trading: TradingService,
  ) {}

  list = (req: FastifyRequest) => this.positions.list(listQuery.parse(req.query));

  close = async (req: FastifyRequest) => {
    const { id } = idParams.parse(req.params);
    await this.trading.close(id, 'manual');
    return { ok: true };
  };
}

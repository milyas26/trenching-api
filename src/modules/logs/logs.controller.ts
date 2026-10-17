import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accountIdOf } from '../../common/account.ts';
import type { LogsService } from './logs.service.ts';

const listQuery = z.object({ limit: z.coerce.number().int().optional() });

export class LogsController {
  constructor(private readonly logs: LogsService) {}

  list = (req: FastifyRequest) => this.logs.latest(accountIdOf(req), listQuery.parse(req.query).limit);
}

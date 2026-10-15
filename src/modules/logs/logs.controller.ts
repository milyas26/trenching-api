import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LogsService } from './logs.service.ts';

const listQuery = z.object({ limit: z.coerce.number().int().optional() });

export class LogsController {
  constructor(private readonly logs: LogsService) {}

  list = (req: FastifyRequest) => this.logs.latest(listQuery.parse(req.query).limit);
}

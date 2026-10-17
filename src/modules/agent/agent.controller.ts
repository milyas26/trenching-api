import type { FastifyRequest } from 'fastify';
import { accountIdOf } from '../../common/account.ts';
import type { AgentService } from './agent.service.ts';

export class AgentController {
  constructor(private readonly agent: AgentService) {}

  reviews = (req: FastifyRequest) => ({ configured: this.agent.isConfigured, reviews: this.agent.recentReviews(accountIdOf(req)) });
}

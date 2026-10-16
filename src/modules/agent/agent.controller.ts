import type { AgentService } from './agent.service.ts';

export class AgentController {
  constructor(private readonly agent: AgentService) {}

  reviews = () => ({ configured: this.agent.isConfigured, reviews: this.agent.recentReviews() });
}

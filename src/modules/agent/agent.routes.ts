import type { FastifyPluginAsync } from 'fastify';
import type { AgentController } from './agent.controller.ts';

export const agentRoutes = (c: AgentController): FastifyPluginAsync => async (app) => {
  app.get('/agent/reviews', c.reviews);
};

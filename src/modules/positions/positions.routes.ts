import type { FastifyPluginAsync } from 'fastify';
import type { PositionsController } from './positions.controller.ts';

export const positionsRoutes = (c: PositionsController): FastifyPluginAsync => async (app) => {
  app.get('/positions', c.list);
  app.post('/positions/:id/close', c.close);
};

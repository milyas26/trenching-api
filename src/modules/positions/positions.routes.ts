import type { FastifyPluginAsync } from 'fastify';
import type { PositionsController } from './positions.controller.ts';

export const positionsRoutes = (c: PositionsController): FastifyPluginAsync => async (app) => {
  app.get('/positions', c.list);
  app.get('/positions/history', c.history);
  app.get('/positions/daily', c.daily);
  app.get('/positions/:id/buy-reason', c.buyReason);
  app.post('/positions/:id/close', c.close);
  app.post('/positions/:id/refresh-price', c.refreshPrice);
};

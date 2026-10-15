import type { FastifyPluginAsync } from 'fastify';
import type { PricesController } from './prices.controller.ts';

export const pricesRoutes = (c: PricesController): FastifyPluginAsync => async (app) => {
  app.get('/prices/stream', c.stream);
};

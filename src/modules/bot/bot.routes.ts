import type { FastifyPluginAsync } from 'fastify';
import type { BotController } from './bot.controller.ts';

export const botRoutes = (c: BotController): FastifyPluginAsync => async (app) => {
  app.get('/status', c.status);
  app.get('/candidates', c.candidates);
  app.post('/scan', c.scan);
  app.post('/bot/start', c.start);
  app.post('/bot/stop', c.stop);
};

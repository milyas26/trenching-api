import type { FastifyPluginAsync } from 'fastify';
import type { LogsController } from './logs.controller.ts';

export const logsRoutes = (c: LogsController): FastifyPluginAsync => async (app) => {
  app.get('/logs', c.list);
};

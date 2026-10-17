import type { FastifyPluginAsync } from 'fastify';
import type { AccountsController } from './accounts.controller.ts';

export const accountsRoutes = (c: AccountsController): FastifyPluginAsync => async (app) => {
  app.get('/accounts', c.list);
  app.post('/accounts', c.create);
  app.patch('/accounts/:id', c.update);
  app.delete('/accounts/:id', c.remove);
};

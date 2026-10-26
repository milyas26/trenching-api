import type { FastifyPluginAsync } from 'fastify';
import type { SettingsController } from './settings.controller.ts';

export const settingsRoutes = (c: SettingsController): FastifyPluginAsync => async (app) => {
  app.get('/settings', c.get);
  app.get('/settings/combos', c.combos);
  app.put('/settings', c.update);
};

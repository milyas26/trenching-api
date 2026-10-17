import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.ts';
import { errorHandler } from './common/errors.ts';
import type { Container } from './container.ts';
import { botRoutes } from './modules/bot/bot.routes.ts';
import { settingsRoutes } from './modules/settings/settings.routes.ts';
import { accountsRoutes } from './modules/accounts/accounts.routes.ts';
import { positionsRoutes } from './modules/positions/positions.routes.ts';
import { logsRoutes } from './modules/logs/logs.routes.ts';
import { pricesRoutes } from './modules/prices/prices.routes.ts';
import { agentRoutes } from './modules/agent/agent.routes.ts';

export async function buildApp({ controllers }: Container) {
  const app = Fastify({ logger: { level: 'warn' } });
  await app.register(cors, {
    origin: env.corsOrigin,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  });
  app.setErrorHandler(errorHandler);

  await app.register(async (api) => {
    await api.register(botRoutes(controllers.bot));
    await api.register(accountsRoutes(controllers.accounts));
    await api.register(settingsRoutes(controllers.settings));
    await api.register(positionsRoutes(controllers.positions));
    await api.register(logsRoutes(controllers.logs));
    await api.register(pricesRoutes(controllers.prices));
    await api.register(agentRoutes(controllers.agent));
  }, { prefix: '/api' });

  return app;
}

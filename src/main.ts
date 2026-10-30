import { env } from './config/env.ts';
import { createContainer } from './container.ts';
import { buildApp } from './app.ts';

const container = createContainer();
const app = await buildApp(container);

await container.accounts.ensureDefault();
await container.bot.recover();
await container.scheduler.start();
container.retention.start();

await app.listen({ port: env.port, host: env.host });
console.log(`trenching API jalan di http://localhost:${env.port}`);

async function shutdown() {
  container.scheduler.stop();
  container.retention.stop();
  container.priceStream.close();
  await app.close();
  await container.prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

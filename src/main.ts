import { env } from './config/env.ts';
import { createContainer } from './container.ts';
import { buildApp } from './app.ts';

const container = createContainer();
const app = await buildApp(container);

await container.settings.get();
await container.bot.recover();
container.scheduler.start();

await app.listen({ port: env.port, host: env.host });
console.log(`micin-agent API jalan di http://localhost:${env.port}`);

async function shutdown() {
  container.scheduler.stop();
  container.priceStream.close();
  await app.close();
  await container.prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

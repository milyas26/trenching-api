import { prisma } from './lib/prisma.ts';
import { GmgnClient } from './integrations/gmgn/gmgn.client.ts';
import { DexscreenerClient } from './integrations/dexscreener/dexscreener.client.ts';
import { PumpportalClient } from './integrations/pumpportal/pumpportal.client.ts';
import { SettingsRepository } from './modules/settings/settings.repository.ts';
import { SettingsService } from './modules/settings/settings.service.ts';
import { SettingsController } from './modules/settings/settings.controller.ts';
import { LogsRepository } from './modules/logs/logs.repository.ts';
import { LogsService } from './modules/logs/logs.service.ts';
import { LogsController } from './modules/logs/logs.controller.ts';
import { PositionsRepository } from './modules/positions/positions.repository.ts';
import { PositionsService } from './modules/positions/positions.service.ts';
import { PositionsController } from './modules/positions/positions.controller.ts';
import { TradingService } from './modules/trading/trading.service.ts';
import { PaperExecutor, RealExecutor } from './modules/trading/executors.ts';
import { createBotState } from './modules/bot/bot.state.ts';
import { ScannerService } from './modules/bot/scanner.service.ts';
import { MonitorService } from './modules/bot/monitor.service.ts';
import { BotScheduler } from './modules/bot/bot.scheduler.ts';
import { BotService } from './modules/bot/bot.service.ts';
import { BotController } from './modules/bot/bot.controller.ts';

/** Wiring manual semua dependency. Urutan mengikuti arah dependency: integrasi -> repo -> service -> controller. */
export function createContainer() {
  const gmgn = new GmgnClient();
  const dexscreener = new DexscreenerClient();
  const pumpportal = new PumpportalClient();

  const settingsRepo = new SettingsRepository(prisma);
  const logsRepo = new LogsRepository(prisma);
  const positionsRepo = new PositionsRepository(prisma);

  const settings = new SettingsService(settingsRepo);
  const logs = new LogsService(logsRepo);
  const positions = new PositionsService(positionsRepo);
  const trading = new TradingService(positionsRepo, positions, dexscreener, settings, logs, [
    new PaperExecutor(),
    new RealExecutor(pumpportal),
  ]);

  const state = createBotState();
  const scanner = new ScannerService(state, gmgn, positionsRepo, settings, trading, logs);
  const monitor = new MonitorService(state, dexscreener, positionsRepo, settings, trading, logs);
  const scheduler = new BotScheduler(state, settings, scanner, monitor);
  const bot = new BotService(state, settings, positions, positionsRepo, scheduler, scanner, pumpportal, logs);

  return {
    prisma,
    settings,
    scheduler,
    bot,
    controllers: {
      settings: new SettingsController(settings, logs, scheduler),
      logs: new LogsController(logs),
      positions: new PositionsController(positions, trading),
      bot: new BotController(bot),
    },
  };
}

export type Container = ReturnType<typeof createContainer>;

import { prisma } from './lib/prisma.ts';
import { GmgnClient } from './integrations/gmgn/gmgn.client.ts';
import { DexscreenerClient } from './integrations/dexscreener/dexscreener.client.ts';
import { PumpportalClient } from './integrations/pumpportal/pumpportal.client.ts';
import { SolanaClient } from './integrations/solana/solana.client.ts';
import { SolanaWsClient } from './integrations/solana/solana-ws.client.ts';
import { OnchainPriceClient } from './integrations/onchain/onchain-price.client.ts';
import { OnchainPriceStream } from './integrations/onchain/onchain-price.stream.ts';
import { GeckoterminalClient } from './integrations/geckoterminal/geckoterminal.client.ts';
import { DeepseekClient } from './integrations/deepseek/deepseek.client.ts';
import { AgentService } from './modules/agent/agent.service.ts';
import { AgentController } from './modules/agent/agent.controller.ts';
import { AccountsRepository } from './modules/accounts/accounts.repository.ts';
import { AccountsService } from './modules/accounts/accounts.service.ts';
import { AccountsController } from './modules/accounts/accounts.controller.ts';
import { SettingsService } from './modules/settings/settings.service.ts';
import { SettingsController } from './modules/settings/settings.controller.ts';
import { LogsRepository } from './modules/logs/logs.repository.ts';
import { LogsService } from './modules/logs/logs.service.ts';
import { LogsController } from './modules/logs/logs.controller.ts';
import { PositionsRepository } from './modules/positions/positions.repository.ts';
import { PositionsService } from './modules/positions/positions.service.ts';
import { PositionsController } from './modules/positions/positions.controller.ts';
import { SnapshotsRepository } from './modules/snapshots/snapshots.repository.ts';
import { SnapshotsService } from './modules/snapshots/snapshots.service.ts';
import { TradingService } from './modules/trading/trading.service.ts';
import { PaperExecutor, RealExecutor } from './modules/trading/executors.ts';
import { BotState } from './modules/bot/bot.state.ts';
import { ScannerService } from './modules/bot/scanner.service.ts';
import { MonitorService } from './modules/bot/monitor.service.ts';
import { PricesService } from './modules/prices/prices.service.ts';
import { PricesController } from './modules/prices/prices.controller.ts';
import { BotScheduler } from './modules/bot/bot.scheduler.ts';
import { BotService } from './modules/bot/bot.service.ts';
import { BotController } from './modules/bot/bot.controller.ts';

/** Wiring manual semua dependency. Urutan mengikuti arah dependency: integrasi -> repo -> service -> controller. */
export function createContainer() {
  const gmgn = new GmgnClient();
  const dexscreener = new DexscreenerClient();
  const pumpportal = new PumpportalClient();
  const solana = new SolanaClient();
  // Satu instance supaya jeda anti-429 GeckoTerminal berlaku untuk harga dan chart agent sekaligus.
  const gecko = new GeckoterminalClient();
  const prices = new OnchainPriceClient(solana, dexscreener, gecko);
  const priceStream = new OnchainPriceStream(solana, new SolanaWsClient());

  const accountsRepo = new AccountsRepository(prisma);
  const logsRepo = new LogsRepository(prisma);
  const positionsRepo = new PositionsRepository(prisma);

  const settings = new SettingsService(accountsRepo);
  const accounts = new AccountsService(accountsRepo, settings, positionsRepo);
  const logs = new LogsService(logsRepo);
  const positions = new PositionsService(positionsRepo);
  const snapshots = new SnapshotsService(new SnapshotsRepository(prisma));
  const trading = new TradingService(positionsRepo, positions, prices, settings, accounts, logs, [
    new PaperExecutor(),
    new RealExecutor(pumpportal, solana),
  ]);

  const agent = new AgentService(new DeepseekClient(), dexscreener, gecko, prices);

  const state = new BotState();
  const scanner = new ScannerService(state, gmgn, dexscreener, gecko, positionsRepo, settings, trading, logs, agent, snapshots);
  const livePrices = new PricesService();
  const monitor = new MonitorService(state, prices, priceStream, positionsRepo, settings, trading, logs, livePrices);
  priceStream.onQuote((mint, quote) => void monitor.handleQuote(mint, quote));
  const scheduler = new BotScheduler(state, settings, accounts, scanner, monitor);
  const bot = new BotService(state, settings, accounts, positions, positionsRepo, scheduler, scanner, solana, logs);

  return {
    prisma,
    accounts,
    scheduler,
    priceStream,
    bot,
    controllers: {
      accounts: new AccountsController(accounts, scheduler),
      settings: new SettingsController(settings, accounts, logs, scheduler),
      logs: new LogsController(logs),
      prices: new PricesController(livePrices),
      positions: new PositionsController(positions, trading, monitor),
      bot: new BotController(bot),
      agent: new AgentController(agent),
    },
  };
}

export type Container = ReturnType<typeof createContainer>;

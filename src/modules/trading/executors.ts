import type { PumpportalClient } from '../../integrations/pumpportal/pumpportal.client.ts';
import type { TradeOptions } from '../../integrations/pumpportal/pumpportal.types.ts';
import type { TradeExecutor } from './trading.interfaces.ts';

/** Simulasi: tidak ada transaksi on-chain, harga diambil dari pasar oleh TradingService. */
export class PaperExecutor implements TradeExecutor {
  readonly mode = 'paper' as const;
  async buy() { return null; }
  async sellAll() { return null; }
}

export class RealExecutor implements TradeExecutor {
  readonly mode = 'real' as const;

  constructor(private readonly pumpportal: PumpportalClient) {}

  buy(mint: string, amountSol: number, opts: TradeOptions) {
    return this.pumpportal.buy(mint, amountSol, opts);
  }

  sellAll(mint: string, opts: TradeOptions) {
    return this.pumpportal.sellAll(mint, opts);
  }
}

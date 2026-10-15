export type PumpPool = 'auto' | 'pump' | 'pump-amm' | 'raydium' | 'raydium-cpmm' | 'launchlab' | 'bonk';

export const PUMP_POOLS: readonly PumpPool[] = ['auto', 'pump', 'pump-amm', 'raydium', 'raydium-cpmm', 'launchlab', 'bonk'];

export interface TradeOptions {
  slippagePct: number;
  priorityFeeSol: number;
  pool: PumpPool;
}

export interface TradeRequest {
  action: 'buy' | 'sell';
  mint: string;
  amount: number | string;
  denominatedInSol: 'true' | 'false';
  slippage: number;
  priorityFee: number;
  pool: PumpPool;
}

export interface TradeResponse {
  signature?: string;
  errors?: string[] | string;
}

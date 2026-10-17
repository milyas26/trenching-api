import type { TradeOptions, TradeRequest, TradeResponse } from './pumpportal.types.ts';

/**
 * Lightning Transaction API (https://pumpportal.fun/trading-api/).
 * Transaksi ditandatangani dan dikirim PumpPortal pakai wallet yang terhubung ke API key.
 * API key dikirim per panggilan karena tiap akun bisa punya wallet sendiri.
 */
const TRADE_URL = 'https://pumpportal.fun/api/trade';

export class PumpportalClient {
  buy(apiKey: string, mint: string, amountSol: number, opts: TradeOptions): Promise<string> {
    return this.trade(apiKey, {
      action: 'buy',
      mint,
      amount: amountSol,
      denominatedInSol: 'true',
      slippage: opts.slippagePct,
      priorityFee: opts.priorityFeeSol,
      pool: opts.pool,
    });
  }

  sellAll(apiKey: string, mint: string, opts: TradeOptions): Promise<string> {
    return this.trade(apiKey, {
      action: 'sell',
      mint,
      amount: '100%',
      denominatedInSol: 'false',
      slippage: opts.slippagePct,
      priorityFee: opts.priorityFeeSol,
      pool: opts.pool,
    });
  }

  private async trade(apiKey: string, body: TradeRequest): Promise<string> {
    if (!apiKey) throw new Error('API key PumpPortal belum diisi untuk akun ini (Pengaturan > Akun, atau PUMPPORTAL_API_KEY di api/.env)');

    const res = await fetch(`${TRADE_URL}?api-key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();

    let data: TradeResponse;
    try {
      data = JSON.parse(text) as TradeResponse;
    } catch {
      throw new Error(`PumpPortal HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const errors = Array.isArray(data.errors) ? data.errors : data.errors ? [data.errors] : [];
    if (!res.ok || errors.length > 0 || !data.signature) {
      throw new Error(`PumpPortal gagal: ${errors.join('; ') || text.slice(0, 200)}`);
    }
    return data.signature;
  }
}

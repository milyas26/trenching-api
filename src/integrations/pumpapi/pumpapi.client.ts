import { WSOL_MINT, type TradeAction, type TradeResponse, type TradeResult } from './pumpapi.types.ts';

/**
 * Lightning Transaction API (https://pumpapi.io/trade-api).
 * Tx ditandatangani dan dikirim PumpAPI memakai apiKey (private key wallet yang dienkripsi PumpAPI).
 * API key dikirim per panggilan karena tiap akun bisa punya wallet sendiri.
 */
const TRADE_URL = 'https://api.pumpapi.io';

export interface SendOptions {
  apiKey: string;
  slippagePct: number;
  priorityFeeSol: number;
}

export class PumpapiClient {
  /** Buy dengan SOL. quoteMint = WSOL membatasi ke pool SOL; kosong = pool terbesar (harus berpasangan SOL). */
  buyWithSol(opts: SendOptions, mint: string, amountSol: number): Promise<TradeResult> {
    return this.send(opts, [
      { action: 'buy', mint, quoteMint: WSOL_MINT, amount: amountSol, denominatedInQuote: 'true', slippage: opts.slippagePct },
    ]);
  }

  /**
   * Token yang pool terbesarnya dipasangkan token lain (mis. WBTC): beli quote dengan SOL,
   * lalu beli token dengan seluruh quote itu. Satu tx, jadi gagal satu = gagal semua.
   */
  buyViaQuote(opts: SendOptions, mint: string, quoteMint: string, amountSol: number): Promise<TradeResult> {
    return this.send(opts, [
      { action: 'buy', mint: quoteMint, quoteMint: WSOL_MINT, amount: amountSol, denominatedInQuote: 'true', slippage: opts.slippagePct },
      { action: 'buy', mint, quoteMint, amount: '100%', denominatedInQuote: 'true', slippage: opts.slippagePct },
    ]);
  }

  /** Jual semua token. quoteMint kosong = pool terbesar; hasilnya bisa berupa quote non-SOL (lihat result.quoteMint). */
  sellAll(opts: SendOptions, mint: string, quoteMint?: string): Promise<TradeResult> {
    return this.send(opts, [
      { action: 'sell', mint, quoteMint, amount: '100%', denominatedInQuote: 'false', slippage: opts.slippagePct },
    ]);
  }

  private async send(opts: SendOptions, actions: TradeAction[]): Promise<TradeResult> {
    if (!opts.apiKey) throw new Error('API key PumpAPI belum diisi untuk akun ini (Pengaturan > Akun, atau PUMPAPI_API_KEY di api/.env)');

    const body = actions.length === 1
      ? { apiKey: opts.apiKey, priorityFee: opts.priorityFeeSol, ...actions[0] }
      // priorityFee per action dijumlahkan PumpAPI; di level atas berlaku sekali untuk seluruh tx.
      : { apiKey: opts.apiKey, priorityFee: opts.priorityFeeSol, actions: actions.map((a) => ({ apiKey: opts.apiKey, ...a })) };

    const res = await fetch(TRADE_URL, {
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
      throw new Error(`PumpAPI HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    if (!res.ok || data.err || !data.signature) {
      throw new Error(`PumpAPI gagal: ${data.err || text.slice(0, 200)}`);
    }
    const trades = data.trades ?? [];
    return { signature: data.signature, quoteMint: trades[trades.length - 1]?.quoteMint ?? null };
  }
}

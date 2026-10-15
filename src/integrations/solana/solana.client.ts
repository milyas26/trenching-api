import { env } from '../../config/env.ts';

const LAMPORTS_PER_SOL = 1_000_000_000;

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

/** JSON-RPC Solana langsung lewat fetch, cukup untuk baca saldo tanpa @solana/web3.js. */
export class SolanaClient {
  async getBalanceSol(address: string): Promise<number> {
    const res = await fetch(env.solanaRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
    const data = (await res.json()) as RpcResponse<{ value: number }>;
    if (data.error || !data.result) throw new Error(`Solana RPC: ${data.error?.message ?? 'response kosong'}`);
    return data.result.value / LAMPORTS_PER_SOL;
  }
}

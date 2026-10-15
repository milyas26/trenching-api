import { env } from '../../config/env.ts';

const LAMPORTS_PER_SOL = 1_000_000_000;
/** Batas getMultipleAccounts per request. */
const MAX_ACCOUNTS = 100;

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

interface RpcAccount {
  data: [string, 'base64'];
  owner: string;
}

export interface AccountInfo {
  data: Buffer;
  owner: string;
}

/** JSON-RPC Solana langsung lewat fetch, tanpa @solana/web3.js. */
export class SolanaClient {
  async getBalanceSol(address: string): Promise<number> {
    const result = await this.rpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]);
    return result.value / LAMPORTS_PER_SOL;
  }

  /** Data mentah akun. Akun yang tidak ada bernilai null. */
  async getMultipleAccounts(addresses: string[]): Promise<Map<string, AccountInfo | null>> {
    const unique = [...new Set(addresses)];
    const result = new Map<string, AccountInfo | null>();
    for (let i = 0; i < unique.length; i += MAX_ACCOUNTS) {
      const chunk = unique.slice(i, i + MAX_ACCOUNTS);
      const { value } = await this.rpc<{ value: (RpcAccount | null)[] }>('getMultipleAccounts', [
        chunk,
        { encoding: 'base64', commitment: 'confirmed' },
      ]);
      chunk.forEach((address, j) => {
        const acc = value[j];
        result.set(address, acc ? { data: Buffer.from(acc.data[0], 'base64'), owner: acc.owner } : null);
      });
    }
    return result;
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(env.solanaRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
    const data = (await res.json()) as RpcResponse<T>;
    if (data.error || !data.result) throw new Error(`Solana RPC: ${data.error?.message ?? 'response kosong'}`);
    return data.result;
  }
}

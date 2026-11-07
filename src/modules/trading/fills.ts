import type { ParsedTokenBalance, ParsedTransaction, SolanaClient } from '../../integrations/solana/solana.client.ts';

const LAMPORTS_PER_SOL = 1_000_000_000;
const READ_ATTEMPTS = 6;
const READ_RETRY_MS = 2_000;

/** Hasil swap satu wallet di satu tx: SOL keluar (buy, negatif) atau masuk (sell, positif) dan token yang berpindah. */
export interface SwapFill {
  /** Di luar fee jaringan dan rent token account; fee PumpAPI dan tip tetap masuk. */
  sol: number;
  /** Jumlah token (ui), positif saat buy, negatif saat sell. */
  tokens: number;
  /** Waktu blok tx (epoch detik). */
  blockTime: number | null;
}

/**
 * SOL swap = perubahan saldo SOL wallet + fee tx + perubahan lamport token account milik wallet.
 * Lamport token account ikut dihitung supaya rent (dibayar saat buy, kembali saat akun ditutup)
 * dan SOL yang dibungkus jadi WSOL tidak terbaca sebagai harga beli/jual.
 */
export function swapFill(tx: ParsedTransaction, wallet: string, mint: string): SwapFill | null {
  const meta = tx.meta;
  if (!meta || meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const walletIdx = keys.indexOf(wallet);
  if (walletIdx < 0) return null;

  const balances = [...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])];
  const ownedAccounts = new Set(balances.filter((b) => b.owner === wallet).map((b) => b.accountIndex));

  const lamportDelta = (i: number) => (meta.postBalances[i] ?? 0) - (meta.preBalances[i] ?? 0);
  let lamports = lamportDelta(walletIdx);
  if (walletIdx === 0) lamports += meta.fee;
  for (const i of ownedAccounts) lamports += lamportDelta(i);

  const tokenSum = (list: ParsedTokenBalance[]) => list
    .filter((b) => b.owner === wallet && b.mint === mint)
    .reduce((sum, b) => sum + Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals, 0);
  const tokens = tokenSum(meta.postTokenBalances ?? []) - tokenSum(meta.preTokenBalances ?? []);

  return { sol: lamports / LAMPORTS_PER_SOL, tokens, blockTime: tx.blockTime };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Membaca hasil swap dari chain; null kalau tx tetap belum terbaca setelah beberapa kali coba atau gagal on-chain. */
export async function readSwapFill(solana: SolanaClient, signature: string, wallet: string, mint: string) {
  for (let i = 0; i < READ_ATTEMPTS; i++) {
    const tx = await solana.getTransaction(signature).catch(() => null);
    if (tx) return swapFill(tx, wallet, mint);
    await sleep(READ_RETRY_MS);
  }
  return null;
}

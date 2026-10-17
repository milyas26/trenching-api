import type { Account } from '../../generated/prisma/client.ts';
import type { TokenSource } from '../../integrations/gmgn/gmgn.types.ts';
import type { TradeMode } from '../positions/positions.interfaces.ts';

export type { Account };

/** Kredensial yang dipakai order real. Kosong = belum diisi, order real akan gagal dengan pesan jelas. */
export interface WalletCredentials {
  apiKey: string;
  wallet: string;
}

/** Akun untuk response API. API key tidak pernah dikirim, cukup 4 karakter terakhirnya. */
export interface AccountDto {
  id: number;
  name: string;
  mode: TradeMode;
  botEnabled: boolean;
  source: TokenSource;
  /** Wallet yang dipakai (milik akun atau dari api/.env). */
  wallet: string;
  /** true = akun punya API key dan wallet sendiri; false = pakai api/.env. */
  ownCredentials: boolean;
  apiKeyHint: string | null;
  pumpportalReady: boolean;
}

export interface CreateAccountInput {
  name?: string;
  /** Salin pengaturan dari akun ini (tanpa kredensial, mode paper, bot mati). */
  copyFromId?: number;
}

export interface UpdateAccountInput {
  name?: string;
  /** Diisi berpasangan; null keduanya = kembali pakai api/.env. */
  credentials?: { apiKey: string; wallet: string } | null;
}

export interface IAccountsRepository {
  list(): Promise<Account[]>;
  find(id: number): Promise<Account | null>;
  create(name: string, settings: unknown): Promise<Account>;
  update(id: number, data: { name?: string; pumpportalApiKey?: string | null; walletPublicKey?: string | null }): Promise<Account>;
  saveSettings(id: number, settings: unknown): Promise<void>;
  delete(id: number): Promise<void>;
}

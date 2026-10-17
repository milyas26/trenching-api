import { env } from '../../config/env.ts';
import { badRequest, conflict, notFound } from '../../common/errors.ts';
import { botSettingsSchema } from '../settings/settings.schema.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { IPositionsRepository } from '../positions/positions.interfaces.ts';
import type {
  Account, AccountDto, CreateAccountInput, IAccountsRepository, UpdateAccountInput, WalletCredentials,
} from './accounts.interfaces.ts';

/** Akun tanpa kredensial sendiri memakai PUMPPORTAL_API_KEY dan WALLET_PUBLIC_KEY dari api/.env. */
function credentialsOf(a: Pick<Account, 'pumpportalApiKey' | 'walletPublicKey'>): WalletCredentials {
  return a.pumpportalApiKey && a.walletPublicKey
    ? { apiKey: a.pumpportalApiKey, wallet: a.walletPublicKey }
    : { apiKey: env.pumpportalApiKey, wallet: env.walletPublicKey };
}

export class AccountsService {
  constructor(
    private readonly repo: IAccountsRepository,
    private readonly settings: SettingsService,
    private readonly positions: IPositionsRepository,
  ) {}

  /** Database baru selalu punya minimal satu akun. */
  async ensureDefault() {
    if ((await this.repo.list()).length > 0) return;
    await this.repo.create('Akun 1', botSettingsSchema.parse({}));
  }

  async ids(): Promise<number[]> {
    return (await this.repo.list()).map((a) => a.id);
  }

  async list(): Promise<AccountDto[]> {
    return Promise.all((await this.repo.list()).map((a) => this.toDto(a)));
  }

  async credentials(id: number): Promise<WalletCredentials> {
    return credentialsOf(await this.find(id));
  }

  async create({ name, copyFromId }: CreateAccountInput): Promise<AccountDto> {
    const accounts = await this.repo.list();
    const base = copyFromId ? await this.settings.get(copyFromId) : botSettingsSchema.parse({});
    // Akun baru selalu mulai aman: paper dan bot mati, apa pun mode akun asalnya.
    const settings = { ...base, mode: 'paper', botEnabled: false };
    const account = await this.repo.create(name?.trim() || `Akun ${accounts.length + 1}`, settings);
    return this.toDto(account);
  }

  async update(id: number, { name, credentials }: UpdateAccountInput): Promise<AccountDto> {
    await this.find(id);
    const data: { name?: string; pumpportalApiKey?: string | null; walletPublicKey?: string | null } = {};
    if (name !== undefined) {
      if (!name.trim()) throw badRequest('Nama akun wajib diisi');
      data.name = name.trim();
    }
    if (credentials !== undefined) {
      data.pumpportalApiKey = credentials?.apiKey.trim() || null;
      data.walletPublicKey = credentials?.wallet.trim() || null;
      if (Boolean(data.pumpportalApiKey) !== Boolean(data.walletPublicKey)) {
        throw badRequest('API key dan wallet diisi berpasangan, atau kosongkan keduanya untuk memakai api/.env');
      }
      const settings = await this.settings.get(id);
      if (settings.mode === 'real') {
        await this.assertWalletFree(id, credentialsOf({ pumpportalApiKey: data.pumpportalApiKey, walletPublicKey: data.walletPublicKey }).wallet);
      }
    }
    return this.toDto(await this.repo.update(id, data));
  }

  async remove(id: number) {
    await this.find(id);
    if ((await this.repo.list()).length <= 1) throw conflict('Akun terakhir tidak bisa dihapus');
    if ((await this.positions.countActive(id)) > 0) {
      throw conflict('Akun masih punya posisi open. Tutup semua posisinya dulu.');
    }
    await this.repo.delete(id);
    this.settings.forget(id);
  }

  /**
   * Dua akun mode real di wallet yang sama akan saling menjual token satu sama lain (sell selalu 100%),
   * jadi satu wallet hanya boleh dipakai satu akun real.
   */
  async assertWalletFree(id: number, wallet?: string) {
    const target = wallet ?? (await this.credentials(id)).wallet;
    if (!target) return;
    for (const other of await this.repo.list()) {
      if (other.id === id || credentialsOf(other).wallet !== target) continue;
      if ((await this.settings.get(other.id)).mode === 'real') {
        throw conflict(`Wallet ini sudah dipakai akun "${other.name}" di mode Real. Isi API key dan wallet lain untuk akun ini.`);
      }
    }
  }

  private async find(id: number): Promise<Account> {
    const account = await this.repo.find(id);
    if (!account) throw notFound(`Akun #${id} tidak ditemukan`);
    return account;
  }

  private async toDto(a: Account): Promise<AccountDto> {
    const settings = await this.settings.get(a.id);
    const creds = credentialsOf(a);
    const own = Boolean(a.pumpportalApiKey && a.walletPublicKey);
    return {
      id: a.id,
      name: a.name,
      mode: settings.mode,
      botEnabled: settings.botEnabled,
      source: settings.source,
      wallet: creds.wallet,
      ownCredentials: own,
      apiKeyHint: own ? a.pumpportalApiKey!.slice(-4) : null,
      pumpportalReady: creds.apiKey.length > 0,
    };
  }
}

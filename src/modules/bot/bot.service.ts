import { setTimeout as sleep } from 'node:timers/promises';
import type { SolanaClient } from '../../integrations/solana/solana.client.ts';
import { TOKEN_SOURCE_LABEL } from '../../integrations/gmgn/gmgn.types.ts';
import type { IPositionsRepository } from '../positions/positions.interfaces.ts';
import type { PositionsService } from '../positions/positions.service.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { AccountsService } from '../accounts/accounts.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { BotStatus, CandidatesResponse } from './bot.interfaces.ts';
import type { BotState } from './bot.state.ts';
import type { BotScheduler } from './bot.scheduler.ts';
import type { ScannerService } from './scanner.service.ts';

/** /status dipoll tiap 5 detik; saldo cukup dicek ulang tiap 15 detik supaya RPC publik tidak kena rate limit. */
const BALANCE_TTL_MS = 15_000;
/** Batas tunggu fetch GMGN saat scan manual (timeout script GMGN 45 detik). */
const SCAN_FETCH_WAIT_MS = 50_000;

interface CachedBalance { sol: number | null; error: string | null; at: number }

export class BotService {
  /** Per alamat wallet, karena beberapa akun bisa memakai wallet .env yang sama. */
  private readonly balances = new Map<string, CachedBalance>();

  constructor(
    private readonly state: BotState,
    private readonly settings: SettingsService,
    private readonly accounts: AccountsService,
    private readonly positions: PositionsService,
    private readonly positionsRepo: IPositionsRepository,
    private readonly scheduler: BotScheduler,
    private readonly scanner: ScannerService,
    private readonly solana: SolanaClient,
    private readonly logs: LogsService,
  ) {}

  async status(accountId: number): Promise<BotStatus> {
    const settings = await this.settings.get(accountId);
    const creds = await this.accounts.credentials(accountId);
    const s = this.state.scan(accountId);
    const balance = settings.mode === 'real' ? await this.walletBalance(creds.wallet) : null;
    return {
      accountId,
      botEnabled: settings.botEnabled,
      mode: settings.mode,
      source: settings.source,
      wallet: creds.wallet,
      pumpportalReady: creds.apiKey.length > 0,
      walletBalanceSol: balance?.sol ?? null,
      walletBalanceError: balance?.error ?? null,
      scanning: s.scanning,
      lastScanAt: s.lastScanAt,
      lastScanError: s.lastScanError,
      lastScanFetchedCount: s.lastScanFetched.length,
      lastScanCount: s.lastScanTokens.length,
      nextScanAt: s.nextScanAt,
      lastPriceAt: this.state.price.lastPriceAt,
      lastPriceError: this.state.price.lastPriceError,
      stats: await this.positions.stats(accountId, settings),
    };
  }

  /** Kalau RPC gagal, saldo terakhir tetap dikirim bersama pesan error-nya. */
  private async walletBalance(wallet: string) {
    if (!wallet) return { sol: null, error: 'Wallet belum diisi untuk akun ini' };
    let balance = this.balances.get(wallet);
    if (!balance) {
      balance = { sol: null, error: null, at: 0 };
      this.balances.set(wallet, balance);
    }
    if (Date.now() - balance.at >= BALANCE_TTL_MS) {
      balance.at = Date.now();
      try {
        balance.sol = await this.solana.getBalanceSol(wallet);
        balance.error = null;
      } catch (e) {
        balance.error = (e as Error).message;
      }
    }
    return balance;
  }

  async start(accountId: number) {
    const current = await this.settings.get(accountId);
    if (current.mode === 'real') await this.accounts.assertWalletFree(accountId);
    const settings = await this.settings.update(accountId, { botEnabled: true });
    await this.logs.for(accountId).info(`Bot START (${settings.mode}, ${TOKEN_SOURCE_LABEL[settings.source]})`);
    this.scheduler.restartScan(accountId);
  }

  async stop(accountId: number) {
    await this.settings.update(accountId, { botEnabled: false });
    this.state.scan(accountId).nextScanAt = null;
    await this.logs.for(accountId).info('Bot STOP');
  }

  /**
   * Scan manual. Buy hanya terjadi kalau bot sedang aktif; saat itu scan dijalankan lewat scheduler
   * supaya review AI berjalan di belakang dan hitung mundur berikutnya mulai setelah review selesai.
   * Request cukup menunggu daftar token GMGN diperbarui.
   */
  async scanNow(accountId: number) {
    const { botEnabled } = await this.settings.get(accountId);
    const state = this.state.scan(accountId);
    if (!botEnabled) {
      await this.scanner.run(accountId, { buy: false });
      return { error: state.lastScanError };
    }

    const before = state.lastScanAt;
    const wasScanning = state.scanning;
    this.scheduler.restartScan(accountId);
    // Scan yang sudah berjalan sebelumnya berarti daftar token sudah segar; tidak perlu ditunggu.
    const deadline = Date.now() + SCAN_FETCH_WAIT_MS;
    let started = false;
    while (!wasScanning && state.lastScanAt === before && Date.now() < deadline) {
      // Scan selesai tanpa lastScanAt berubah berarti fetch GMGN gagal; error-nya ada di lastScanError.
      if (started && !state.scanning) break;
      started ||= state.scanning;
      await sleep(250);
    }
    return { error: state.lastScanError };
  }

  /**
   * Semua token dari GMGN, yang lolos filter Token Info lebih dulu.
   * Flag `bought` dihitung saat request supaya selalu sesuai isi tabel positions.
   */
  async candidates(accountId: number): Promise<CandidatesResponse> {
    await this.settings.get(accountId);
    const s = this.state.scan(accountId);
    const bought = await this.positionsRepo.boughtMints(accountId);
    const tokens = s.lastScanFetched.map(({ raw: _raw, safety: _safety, signals: _signals, ...t }) => ({
      ...t,
      bought: bought.has(t.mint),
      rejectedBy: s.lastScanRejected.get(t.mint) ?? [],
    }));
    tokens.sort((a, b) => Number(a.rejectedBy.length > 0) - Number(b.rejectedBy.length > 0));
    return { at: s.lastScanAt, source: s.lastScanSource, tokens };
  }

  async recover() {
    for (const p of await this.positionsRepo.recoverStuck()) {
      await this.logs.for(p.accountId).warn(`Recover posisi #${p.id} (${p.mint.slice(0, 4)}…${p.mint.slice(-4)}) -> ${p.status}`);
    }
  }
}

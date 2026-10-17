import type { SettingsService } from '../settings/settings.service.ts';
import type { AccountsService } from '../accounts/accounts.service.ts';
import type { BotState } from './bot.state.ts';
import type { ScannerService } from './scanner.service.ts';
import type { MonitorService } from './monitor.service.ts';

const IDLE_POLL_MS = 2_000;

/**
 * Loop setTimeout (bukan setInterval) supaya interval baru dari Settings
 * langsung dipakai dan run tidak pernah tumpang tindih.
 * - scan: satu loop per akun, hanya scan saat bot akun itu aktif
 * - monitor harga: satu loop untuk semua akun, selalu jalan supaya TP/SL posisi open tetap dieksekusi walau bot di-stop
 */
export class BotScheduler {
  private readonly scans = new Map<number, { timer: NodeJS.Timeout | null; generation: number }>();
  private priceTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly state: BotState,
    private readonly settings: SettingsService,
    private readonly accounts: AccountsService,
    private readonly scanner: ScannerService,
    private readonly monitor: MonitorService,
  ) {}

  async start() {
    this.running = true;
    for (const id of await this.accounts.ids()) if (!this.scans.has(id)) this.restartScan(id);
    if (!this.priceTimer) void this.priceLoop();
  }

  /** Mulai ulang loop scan akun ini sekarang juga (bot di-start, interval berubah, atau akun baru). */
  restartScan(accountId: number) {
    if (!this.running) return;
    const entry = this.scans.get(accountId) ?? { timer: null, generation: 0 };
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.generation++;
    this.scans.set(accountId, entry);
    void this.scanLoop(accountId, entry.generation);
  }

  removeAccount(accountId: number) {
    const entry = this.scans.get(accountId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.scans.delete(accountId);
    this.state.forget(accountId);
  }

  stop() {
    this.running = false;
    for (const entry of this.scans.values()) if (entry.timer) clearTimeout(entry.timer);
    this.scans.clear();
    if (this.priceTimer) clearTimeout(this.priceTimer);
    this.priceTimer = null;
  }

  private async scanLoop(accountId: number, generation: number) {
    // Akun yang sudah dihapus: settings.get melempar 404 dan loop-nya berhenti.
    const current = await this.settings.get(accountId).catch(() => null);
    if (current?.botEnabled) await this.scanner.run(accountId, { buy: true });
    // loop lama yang sudah digantikan restartScan() berhenti di sini
    const entry = this.scans.get(accountId);
    if (!entry || generation !== entry.generation) return;

    const s = await this.settings.get(accountId).catch(() => null);
    if (!s) return this.removeAccount(accountId);
    const delay = s.botEnabled ? s.scanIntervalSec * 1000 : IDLE_POLL_MS;
    this.state.scan(accountId).nextScanAt = s.botEnabled ? new Date(Date.now() + delay) : null;
    entry.timer = setTimeout(() => void this.scanLoop(accountId, generation), delay);
  }

  /** Interval cek harga mengikuti akun dengan interval tercepat. */
  private async priceLoop() {
    await this.monitor.run();
    if (!this.running) return;
    const ids = [...this.scans.keys()];
    const intervals = await Promise.all(ids.map((id) => this.settings.get(id).then((s) => s.priceIntervalSec, () => Infinity)));
    const sec = Math.min(...intervals);
    this.priceTimer = setTimeout(() => void this.priceLoop(), (Number.isFinite(sec) ? sec : 10) * 1000);
  }
}

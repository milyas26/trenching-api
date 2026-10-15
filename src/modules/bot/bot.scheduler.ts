import type { SettingsService } from '../settings/settings.service.ts';
import type { BotRuntimeState } from './bot.interfaces.ts';
import type { ScannerService } from './scanner.service.ts';
import type { MonitorService } from './monitor.service.ts';

const IDLE_POLL_MS = 2_000;

/**
 * Dua loop setTimeout (bukan setInterval) supaya interval baru dari Settings
 * langsung dipakai dan run tidak pernah tumpang tindih.
 * - scan: hanya jalan saat bot aktif
 * - monitor harga: selalu jalan, supaya TP/SL posisi open tetap dieksekusi walau bot di-stop
 */
export class BotScheduler {
  private scanTimer: NodeJS.Timeout | null = null;
  private priceTimer: NodeJS.Timeout | null = null;
  private scanGeneration = 0;

  constructor(
    private readonly state: BotRuntimeState,
    private readonly settings: SettingsService,
    private readonly scanner: ScannerService,
    private readonly monitor: MonitorService,
  ) {}

  start() {
    if (!this.scanTimer) void this.scanLoop(this.scanGeneration);
    if (!this.priceTimer) void this.priceLoop();
  }

  /** Mulai ulang loop scan sekarang juga (dipakai saat bot di-start atau interval berubah). */
  restartScan() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    void this.scanLoop(++this.scanGeneration);
  }

  stop() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.priceTimer) clearTimeout(this.priceTimer);
    this.scanGeneration++;
  }

  private async scanLoop(generation: number) {
    const { botEnabled } = await this.settings.get();
    if (botEnabled) await this.scanner.run({ buy: true });
    // loop lama yang sudah digantikan restartScan() berhenti di sini
    if (generation !== this.scanGeneration) return;

    const s = await this.settings.get();
    const delay = s.botEnabled ? s.scanIntervalSec * 1000 : IDLE_POLL_MS;
    this.state.nextScanAt = s.botEnabled ? new Date(Date.now() + delay) : null;
    this.scanTimer = setTimeout(() => void this.scanLoop(generation), delay);
  }

  private async priceLoop() {
    await this.monitor.run();
    const { priceIntervalSec } = await this.settings.get();
    this.priceTimer = setTimeout(() => void this.priceLoop(), priceIntervalSec * 1000);
  }
}

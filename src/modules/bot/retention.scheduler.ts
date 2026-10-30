import type { LogsService } from '../logs/logs.service.ts';
import type { SnapshotsService } from '../snapshots/snapshots.service.ts';

const INTERVAL_MS = 10 * 60_000;
const LOG_MS = 24 * 60 * 60_000;
/** Token yang tidak dibeli disimpan selama ini, jaga-jaga token yang muncul di beberapa scan baru dibeli belakangan. */
const UNBOUGHT_TOKEN_MS = 24 * 60 * 60_000;

/**
 * Batasi ukuran tabel logs dan gmgn_tokens. Token yang pernah ada di positions (akun/mode mana pun,
 * open atau closed) tidak pernah dihapus, supaya histori scan-nya tetap bisa dipakai analisa dan backfill.
 */
export class RetentionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly logs: LogsService,
    private readonly snapshots: SnapshotsService,
  ) {}

  start() {
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async loop() {
    try {
      const logs = await this.logs.prune(new Date(Date.now() - LOG_MS));
      const { tokens, scans } = await this.snapshots.pruneUnbought(new Date(Date.now() - UNBOUGHT_TOKEN_MS));
      if (logs || tokens || scans) console.log(`[retention] hapus ${logs} log, ${tokens} token GMGN, ${scans} scan GMGN`);
    } catch (e) {
      console.error('gagal bersihkan data lama:', (e as Error).message);
    }
    if (this.running) this.timer = setTimeout(() => void this.loop(), INTERVAL_MS);
  }
}

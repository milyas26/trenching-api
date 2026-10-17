import type { GmgnClient } from '../../integrations/gmgn/gmgn.client.ts';
import type { IPositionsRepository } from '../positions/positions.interfaces.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { TradingService } from '../trading/trading.service.ts';
import type { AgentService } from '../agent/agent.service.ts';
import type { SnapshotsService } from '../snapshots/snapshots.service.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';
import { TOKEN_SOURCE_LABEL, type HotToken } from '../../integrations/gmgn/gmgn.types.ts';
import type { BotState } from './bot.state.ts';
import { applyTokenFilter } from './token-filter.ts';

/** Review AI per scan dibatasi supaya satu scan tidak berjalan terlalu lama (tiap review bisa ~1 menit). */
const MAX_REVIEWS_PER_SCAN = 5;

const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** Jalankan filter GMGN dan filter Token Info, lalu buy token baru selama slot masih ada. Satu scan per akun. */
export class ScannerService {
  constructor(
    private readonly state: BotState,
    private readonly gmgn: GmgnClient,
    private readonly positions: IPositionsRepository,
    private readonly settings: SettingsService,
    private readonly trading: TradingService,
    private readonly logs: LogsService,
    private readonly agent: AgentService,
    private readonly snapshots: SnapshotsService,
  ) {}

  private readonly current = new Map<number, Promise<void>>();

  /**
   * @param buy false = cuma refresh daftar kandidat (scan manual saat bot berhenti)
   *
   * Kalau scan akun ini (termasuk review AI) masih berjalan, pemanggil ikut menunggu run itu selesai,
   * supaya hitung mundur scan berikutnya baru dimulai setelah semuanya beres.
   */
  run(accountId: number, opts: { buy: boolean }): Promise<void> {
    let run = this.current.get(accountId);
    if (!run) {
      run = this.execute(accountId, opts).finally(() => this.current.delete(accountId));
      this.current.set(accountId, run);
    }
    return run;
  }

  private async execute(accountId: number, { buy }: { buy: boolean }): Promise<void> {
    const state = this.state.scan(accountId);
    const log = this.logs.for(accountId);
    state.scanning = true;
    state.nextScanAt = null;
    try {
      const settings = await this.settings.get(accountId);
      const scan = await this.gmgn.fetchTokens(settings.source, settings.filter);
      await this.snapshots.scan(accountId, settings.source, settings.filter, scan);
      const { passed, rejected } = applyTokenFilter(scan.tokens, settings.tokenFilter);
      state.lastScanAt = new Date();
      state.lastScanError = null;
      state.lastScanSource = settings.source;
      state.lastScanFetched = scan.tokens;
      state.lastScanTokens = passed;
      state.lastScanRejected = rejected;
      if (!buy) return;

      // Token yang pernah dibeli akun ini di mode mana pun tidak dibeli lagi.
      const known = await this.positions.boughtMints(accountId);
      const fresh = passed.filter((t) => !known.has(t.mint));
      const active = await this.positions.countActive(accountId, settings.mode);
      const slots = Math.max(0, Math.min(settings.maxOpenPositions - active, settings.maxBuysPerScan));
      await log.info(
        `Scan ${TOKEN_SOURCE_LABEL[settings.source]}: ${scan.tokens.length} token dari GMGN, ${passed.length} lolos Token Info, `
          + `${fresh.length} baru, slot buy ${slots}`,
      );

      if (settings.aiAgentEnabled) await this.buyReviewed(accountId, fresh, slots);
      else {
        for (const token of fresh.slice(0, slots)) {
          await this.snapshots.unreviewed(accountId, token, settings.mode);
          if (!(await this.trading.open(accountId, token, settings))) break;
        }
      }
    } catch (e) {
      state.lastScanError = (e as Error).message;
      await log.error(`Scan gagal: ${state.lastScanError}`);
    } finally {
      state.scanning = false;
    }
  }

  /** Token ditinjau AI satu per satu; hanya yang diputuskan buy yang dibeli, sampai slot habis. */
  private async buyReviewed(accountId: number, tokens: HotToken[], slots: number) {
    if (slots === 0) return;
    const log = this.logs.for(accountId);
    if (!this.agent.isConfigured) {
      await log.warn('AI agent aktif tapi DEEPSEEK_API_KEY kosong di api/.env, buy dilewati');
      return;
    }

    let bought = 0;
    let reviewed = 0;
    for (const token of tokens) {
      if (bought >= slots || reviewed >= MAX_REVIEWS_PER_SCAN) break;
      if (this.agent.recentlyReviewed(accountId, token.mint)) continue;
      reviewed++;

      const label = token.symbol ?? shortMint(token.mint);
      let settings: BotSettings = await this.settings.get(accountId);
      try {
        const d = await this.agent.review(accountId, token, settings);
        await this.snapshots.reviewed(accountId, token, settings.mode, d);
        await log.info(`AI ${d.decision.toUpperCase()} ${label} (${d.confidence}%, ${d.steps} langkah): ${d.reason}`);
        if (d.decision !== 'buy') continue;
      } catch (e) {
        await this.snapshots.failed(accountId, token, settings.mode, (e as Error).message);
        await log.error(`AI review ${label} gagal, token dilewati: ${(e as Error).message}`);
        continue;
      }

      // Review makan waktu; bot bisa sudah di-stop, setting berubah, atau akun dihapus selama itu.
      const latest = await this.settings.get(accountId).catch(() => null);
      if (!latest?.botEnabled) return;
      settings = latest;
      if (!(await this.trading.open(accountId, token, settings))) return;
      bought++;
    }
  }
}

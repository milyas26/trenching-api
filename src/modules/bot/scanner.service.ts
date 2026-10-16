import type { GmgnClient } from '../../integrations/gmgn/gmgn.client.ts';
import type { IPositionsRepository } from '../positions/positions.interfaces.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { TradingService } from '../trading/trading.service.ts';
import type { AgentService } from '../agent/agent.service.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';
import type { HotToken } from '../../integrations/gmgn/gmgn.types.ts';
import type { BotRuntimeState } from './bot.interfaces.ts';

/** Review AI per scan dibatasi supaya satu scan tidak berjalan terlalu lama (tiap review bisa ~1 menit). */
const MAX_REVIEWS_PER_SCAN = 5;

const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** Jalankan filter GMGN, lalu buy token baru selama slot masih ada. */
export class ScannerService {
  constructor(
    private readonly state: BotRuntimeState,
    private readonly gmgn: GmgnClient,
    private readonly positions: IPositionsRepository,
    private readonly settings: SettingsService,
    private readonly trading: TradingService,
    private readonly logs: LogsService,
    private readonly agent: AgentService,
  ) {}

  private current: Promise<void> | null = null;

  /**
   * @param buy false = cuma refresh daftar kandidat (scan manual saat bot berhenti)
   *
   * Kalau scan (termasuk review AI) masih berjalan, pemanggil ikut menunggu run itu selesai,
   * supaya hitung mundur scan berikutnya baru dimulai setelah semuanya beres.
   */
  run(opts: { buy: boolean }): Promise<void> {
    this.current ??= this.execute(opts).finally(() => { this.current = null; });
    return this.current;
  }

  private async execute({ buy }: { buy: boolean }): Promise<void> {
    this.state.scanning = true;
    this.state.nextScanAt = null;
    try {
      const settings = await this.settings.get();
      const tokens = await this.gmgn.fetchHotTokens(settings.filter);
      this.state.lastScanAt = new Date();
      this.state.lastScanError = null;
      this.state.lastScanTokens = tokens;
      if (!buy) return;

      // Token yang pernah dibeli di mode mana pun tidak dibeli lagi.
      const known = await this.positions.boughtMints();
      const fresh = tokens.filter((t) => !known.has(t.mint));
      const active = await this.positions.countActive(settings.mode);
      const slots = Math.max(0, Math.min(settings.maxOpenPositions - active, settings.maxBuysPerScan));
      await this.logs.info(`Scan: ${tokens.length} token lolos filter, ${fresh.length} baru, slot buy ${slots}`);

      if (settings.aiAgentEnabled) await this.buyReviewed(fresh, slots);
      else {
        for (const token of fresh.slice(0, slots)) {
          if (!(await this.trading.open(token, settings))) break;
        }
      }
    } catch (e) {
      this.state.lastScanError = (e as Error).message;
      await this.logs.error(`Scan gagal: ${this.state.lastScanError}`);
    } finally {
      this.state.scanning = false;
    }
  }

  /** Token ditinjau AI satu per satu; hanya yang diputuskan buy yang dibeli, sampai slot habis. */
  private async buyReviewed(tokens: HotToken[], slots: number) {
    if (slots === 0) return;
    if (!this.agent.isConfigured) {
      await this.logs.warn('AI agent aktif tapi DEEPSEEK_API_KEY kosong di api/.env, buy dilewati');
      return;
    }

    let bought = 0;
    let reviewed = 0;
    for (const token of tokens) {
      if (bought >= slots || reviewed >= MAX_REVIEWS_PER_SCAN) break;
      if (this.agent.recentlyReviewed(token.mint)) continue;
      reviewed++;

      const label = token.symbol ?? shortMint(token.mint);
      let settings: BotSettings = await this.settings.get();
      try {
        const d = await this.agent.review(token, settings);
        await this.logs.info(`AI ${d.decision.toUpperCase()} ${label} (${d.confidence}%, ${d.steps} langkah): ${d.reason}`);
        if (d.decision !== 'buy') continue;
      } catch (e) {
        await this.logs.error(`AI review ${label} gagal, token dilewati: ${(e as Error).message}`);
        continue;
      }

      // Review makan waktu; bot bisa sudah di-stop atau setting berubah selama itu.
      settings = await this.settings.get();
      if (!settings.botEnabled) return;
      if (!(await this.trading.open(token, settings))) return;
      bought++;
    }
  }
}

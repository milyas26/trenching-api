import type { GmgnClient } from '../../integrations/gmgn/gmgn.client.ts';
import type { DexscreenerClient } from '../../integrations/dexscreener/dexscreener.client.ts';
import type { IPositionsRepository } from '../positions/positions.interfaces.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import type { LogsService } from '../logs/logs.service.ts';
import type { TradingService } from '../trading/trading.service.ts';
import type { AgentService } from '../agent/agent.service.ts';
import type { SnapshotsService } from '../snapshots/snapshots.service.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';
import { TOKEN_SOURCE_LABEL, type HotToken } from '../../integrations/gmgn/gmgn.types.ts';
import type { BotState } from './bot.state.ts';
import { comboLabels, matchCombos } from '../settings/combos.ts';
import { settingsForToken } from '../trading/og-rule.ts';
import { buildMarketSnapshot } from '../../integrations/dexscreener/market-snapshot.ts';
import type { GeckoterminalClient } from '../../integrations/geckoterminal/geckoterminal.client.ts';
import { loadChartStats } from '../agent/agent.chart.ts';

/** Review AI per scan dibatasi supaya satu scan tidak berjalan terlalu lama (tiap review bisa ~1 menit). */
const MAX_REVIEWS_PER_SCAN = 5;
/** Tiap cek chart memakai satu slot GeckoTerminal (jeda 6 detik) yang juga dipakai untuk harga posisi. */
const MAX_CHART_CHECKS_PER_SCAN = 5;

const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** Ambil token dengan filter GMGN, cocokkan ke kombo yang dipilih, lalu buy token baru selama slot masih ada. Satu scan per akun. */
export class ScannerService {
  constructor(
    private readonly state: BotState,
    private readonly gmgn: GmgnClient,
    private readonly dexscreener: DexscreenerClient,
    private readonly gecko: GeckoterminalClient,
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
      await this.attachDexTxns(scan.tokens, accountId);
      const { passed, rejected } = this.applyCombos(scan.tokens, settings);
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
        `Scan ${TOKEN_SOURCE_LABEL[settings.source]}: ${scan.tokens.length} token dari GMGN, ${passed.length} cocok kombo, `
          + `${fresh.length} baru, slot buy ${slots}`,
      );

      if (settings.aiAgentEnabled) await this.buyReviewed(accountId, fresh, slots);
      else await this.buyUnreviewed(accountId, fresh, slots, settings);
    } catch (e) {
      state.lastScanError = (e as Error).message;
      await log.error(`Scan gagal: ${state.lastScanError}`);
    } finally {
      state.scanning = false;
    }
  }

  /**
   * Transaksi 1 jam pair DexScreener disimpan ke token.info (ikut tersimpan di posisi) karena beberapa kombo memakainya.
   * Kalau request gagal, scan tetap jalan; kombo yang butuh data ini tidak cocok.
   */
  private async attachDexTxns(tokens: HotToken[], accountId: number) {
    if (tokens.length === 0) return;
    try {
      const pairs = await this.dexscreener.getTopPairs(tokens.map((t) => t.mint));
      for (const token of tokens) token.info.dexTxns1h = pairs.get(token.mint)?.txns?.h1 ?? null;
    } catch (e) {
      await this.logs.for(accountId).warn(`Data DexScreener gagal diambil, kombo yang memakai buys/sells/rasio dilewati: ${(e as Error).message}`);
    }
  }

  /** Daftar kombo yang dipakai mengikuti cek AI. Id kombo yang cocok disimpan di token.info. */
  private applyCombos(tokens: HotToken[], settings: BotSettings) {
    const selected = settings.aiAgentEnabled ? settings.combos.ai : settings.combos.nonAi;
    const which = settings.aiAgentEnabled ? 'AI' : 'non-AI';
    const passed: HotToken[] = [];
    const rejected = new Map<string, string[]>();
    for (const token of tokens) {
      const matched = matchCombos(token, selected);
      token.info.combos = matched.map((c) => c.id);
      if (matched.length > 0) passed.push(token);
      else rejected.set(token.mint, [selected.length === 0 ? `Belum ada kombo ${which} dipilih` : `Tidak cocok kombo ${which}`]);
    }
    return { passed, rejected };
  }

  /**
   * Tanpa AI, gate chart bot yang sama dengan review AI tetap dijalankan sebelum buy. Kalau data chart tidak bisa
   * diambil, token tetap dibeli, sama seperti review AI yang lanjut ke model saat chart gagal.
   */
  private async buyUnreviewed(accountId: number, tokens: HotToken[], slots: number, settings: BotSettings) {
    const log = this.logs.for(accountId);
    let bought = 0;
    let checked = 0;
    for (const token of tokens) {
      if (bought >= slots || checked >= MAX_CHART_CHECKS_PER_SCAN) break;
      checked++;
      const label = token.symbol ?? shortMint(token.mint);
      const { market, botFlags } = await this.inspect(accountId, token);
      if (botFlags.length > 0) {
        await log.info(`SKIP ${label} (kombo ${comboLabels(token.info.combos)}): chart buatan bot: ${botFlags.join('; ')}`);
        continue;
      }
      await log.info(`Kombo ${label}: ${comboLabels(token.info.combos)}`);
      await this.snapshots.unreviewed(accountId, token, settings.mode, market);
      if (!(await this.trading.open(accountId, token, settings))) break;
      bought++;
    }
  }

  /** Market DexScreener tetap disimpan supaya fitur analisa sama dengan buy hasil review AI. Pair dipakai juga untuk chart. */
  private async inspect(accountId: number, token: HotToken): Promise<{ market: unknown; botFlags: string[] }> {
    try {
      const [pair, ...others] = await this.dexscreener.getPairs(token.mint);
      if (!pair) return { market: { error: 'token belum punya pair di DexScreener' }, botFlags: [] };
      const chart = await loadChartStats(pair, this.gecko);
      return { market: buildMarketSnapshot(pair, others.length), botFlags: chart.botFlags };
    } catch (e) {
      await this.logs.for(accountId).warn(`Data DexScreener gagal diambil, cek chart dan snapshot market dilewati: ${(e as Error).message}`);
      return { market: { error: (e as Error).message }, botFlags: [] };
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
      if (bought >= slots) break;
      if (this.agent.recentlyReviewed(accountId, token.mint)) continue;

      const label = token.symbol ?? shortMint(token.mint);
      let settings: BotSettings = await this.settings.get(accountId);
      const shared = settings.reuseRecentReview ? await this.reuseReview(accountId, token, settings, label) : false;
      if (!shared) {
        if (reviewed >= MAX_REVIEWS_PER_SCAN) continue;
        reviewed++;
        try {
          // AI menilai peluang mencapai TP yang benar-benar dipakai (TP khusus kalau token OG).
          const d = await this.agent.review(accountId, token, settingsForToken(token, settings));
          await this.snapshots.reviewed(accountId, token, settings.mode, d);
          await log.info(`AI ${d.decision.toUpperCase()} ${label} (${d.confidence}%, ${d.steps} langkah, kombo ${comboLabels(token.info.combos)}): ${d.reason}`);
          if (d.decision !== 'buy') continue;
        } catch (e) {
          await this.snapshots.failed(accountId, token, settings.mode, (e as Error).message);
          await log.error(`AI review ${label} gagal, token dilewati: ${(e as Error).message}`);
          continue;
        }
      }

      // Review makan waktu; bot bisa sudah di-stop, setting berubah, atau akun dihapus selama itu.
      const latest = await this.settings.get(accountId).catch(() => null);
      if (!latest?.botEnabled) return;
      settings = latest;
      if (!(await this.trading.open(accountId, token, settings))) return;
      bought++;
    }
  }

  /** true kalau BUY akun lain dipakai ulang untuk token ini; false = token perlu direview AI sendiri. */
  private async reuseReview(accountId: number, token: HotToken, settings: BotSettings, label: string): Promise<boolean> {
    const check = await this.agent.sharedReview(accountId, token, settings);
    if (!check) return false;
    const log = this.logs.for(accountId);
    const change = `${check.changePct > 0 ? '+' : ''}${check.changePct.toFixed(1)}%`;
    if (!check.decision) {
      await log.info(`Analisa akun #${check.fromAccountId} untuk ${label} tidak dipakai (harga ${change}, ${check.why}), review ulang`);
      return false;
    }
    await this.snapshots.reviewed(accountId, token, settings.mode, check.decision);
    await log.info(`AI BUY ${label} (${check.decision.confidence}%, tanpa review): ${check.decision.reason}`);
    return true;
  }
}

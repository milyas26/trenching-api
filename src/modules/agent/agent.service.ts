import type { DeepseekClient } from '../../integrations/deepseek/deepseek.client.ts';
import type { ChatMessage, ToolCall } from '../../integrations/deepseek/deepseek.types.ts';
import type { DexscreenerClient } from '../../integrations/dexscreener/dexscreener.client.ts';
import type { PriceSource } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { GeckoterminalClient } from '../../integrations/geckoterminal/geckoterminal.client.ts';
import type { HotToken } from '../../integrations/gmgn/gmgn.types.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';
import type { AgentDecision, AgentReview, AgentVerdict, ReviewEvidence, ReviewedDecision } from './agent.interfaces.ts';
import { AGENT_TOOLS, TokenInspector } from './agent.tools.ts';
import type { ChartStats } from './agent.chart.ts';
import { ReviewTrace } from './agent.trace.ts';

/** Batas giliran model per token; habis tanpa keputusan = skip. */
const MAX_STEPS = 8;
/** Buy baru diterima setelah harga dicek minimal sebanyak ini (sampel awal + recheck). */
const MIN_PRICE_SAMPLES = 3;
/** Token yang sudah diputuskan (buy/skip) tidak ditinjau ulang selama ini, supaya scan berikutnya tidak membayar review yang sama. */
const REVIEW_COOLDOWN_MS = 30 * 60_000;
/** Review terakhir yang disimpan di memori untuk ditampilkan di app. */
const KEEP_REVIEWS = 10;
/**
 * Umur BUY akun lain yang boleh dipakai ulang diatur per akun pemakai (reuseMaxAgeMinutes, maks 24 jam),
 * jadi entri disimpan selama batas maksimal itu lalu dibuang.
 */
const SHARED_REVIEW_KEEP_MS = 24 * 60 * 60_000;

const SYSTEM_PROMPT = `Kamu analis token memecoin Solana untuk bot auto-trade. Tugasmu memutuskan apakah token layak dibeli SEKARANG.

Cara kerja:
1. Panggil get_market_data, get_holder_distribution, dan get_chart_stats.
2. Panggil recheck_price beberapa kali (minimal ${MIN_PRICE_SAMPLES - 1}x) untuk melihat arah harga dari waktu ke waktu.
3. Panggil submit_decision.

Pertimbangkan:
- Mint authority atau freeze authority aktif adalah tanda bahaya besar.
- Konsentrasi holder: top 10 di atas ~30% atau satu holder di atas ~10% (di luar bonding curve/pool) berisiko dump.
- Data holder dari GMGN: rugRatio tinggi, sniper banyak, atau wash trading adalah tanda bahaya; dev yang sudah keluar (creator_close) berarti tidak ada lagi risiko dev dump.
- Rasio buy/sell dan volume 5 menit terakhir: tekanan jual dominan berarti skip.
- Likuiditas sangat tipis dibanding market cap berarti slippage besar dan mudah rug.
- Chart yang naik terlalu mulus (candle hijau beruntun dengan body kecil yang rata, hampir tanpa candle merah) atau rata-rata trade hanya beberapa dolar adalah volume buatan bot yang biasanya diakhiri rug. Chart organik punya koreksi dan ukuran trade yang bervariasi.
- Harga yang sudah naik sangat tinggi dalam waktu singkat lalu mulai turun di sampel recheck berarti momentum habis.
- Momentum GMGN (change1mPct, change5mPct, buys vs sells) harus searah dengan recheck. change5mPct negatif tajam berarti sedang dijual.
- belowAthPct = seberapa jauh market cap di bawah ATH-nya. Jauh di bawah ATH (mis. >50%) setelah pump biasanya fase distribusi; dekat ATH dengan momentum naik lebih sehat.
- dumpRisk: bundlerPct, botDegenPct, top70SniperHoldPct, ratTraderPct, dan devTeamHoldPct tinggi berarti banyak supply di tangan yang siap jual. entrapmentPct tinggi berarti banyak trader sudah nyangkut dan akan jual saat harga naik.
- duplicateLogoCount > 0 berarti logo dipakai token lain (copycat). xRenameCount > 0 berarti akun X pernah ganti nama (akun daur ulang).
- promotion (boost/iklan/profil berbayar DexScreener) berarti ada yang membayar promosi: bisa menarik pembeli, tapi bukan tanda aman.
- Bot memakai take profit dan stop loss yang tertera; beli hanya kalau peluang mencapai take profit lebih besar dari kena stop loss.
- Kalau strategy.minRecheckGainPct diisi, buy otomatis ditolak sistem bila changeSinceFirstSamplePct di recheck terakhir di bawah angka itu.

Kalau ragu, skip. Modal lebih penting daripada peluang yang terlewat.`;

const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

interface SharedReview {
  accountId: number;
  decision: ReviewedDecision;
  /** Harga terakhir yang dilihat agent sebelum memutuskan buy. */
  priceUsd: number;
  at: number;
}

/** Hasil cek analisa akun lain: decision null = harga sudah keluar rentang atau syarat akun ini tidak terpenuhi. */
export interface SharedReviewCheck {
  fromAccountId: number;
  changePct: number;
  decision: ReviewedDecision | null;
  why: string;
}

/** Agent DeepSeek yang meninjau satu token lewat beberapa putaran tool call sebelum bot buy. */
export class AgentService {
  /** "akun:mint" -> waktu (ms) token boleh ditinjau lagi oleh akun itu */
  private readonly cooldown = new Map<string, number>();
  private readonly reviews = new Map<number, AgentReview[]>();
  /** mint -> BUY terbaru dari akun mana pun */
  private readonly shared = new Map<string, SharedReview>();

  constructor(
    private readonly deepseek: DeepseekClient,
    private readonly dexscreener: DexscreenerClient,
    private readonly gecko: GeckoterminalClient,
    private readonly prices: PriceSource,
  ) {}

  get isConfigured() {
    return this.deepseek.isConfigured;
  }

  /** true kalau token ini sudah diputuskan agent kurang dari 30 menit lalu. Review yang error boleh dicoba lagi. */
  recentlyReviewed(accountId: number, mint: string): boolean {
    const key = `${accountId}:${mint}`;
    const until = this.cooldown.get(key);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.cooldown.delete(key);
    return false;
  }

  /** Terbaru dulu; review yang sedang berjalan ikut dengan status running. */
  recentReviews(accountId: number): AgentReview[] {
    return this.reviews.get(accountId) ?? [];
  }

  async review(accountId: number, token: HotToken, settings: BotSettings): Promise<ReviewedDecision> {
    const trace = this.startTrace(accountId, token);
    const inspector = new TokenInspector(token.mint, token.safety, token.signals, this.dexscreener, this.gecko, this.prices);
    try {
      const decision = await this.loop(`${accountId}:${token.mint}`, token, settings, trace, inspector);
      trace.finish(decision);
      const reviewed = { ...decision, evidence: await evidenceOf(inspector) };
      const priceUsd = inspector.samples.at(-1)?.priceUsd ?? token.price;
      if (reviewed.decision === 'buy' && priceUsd) {
        this.pruneShared();
        this.shared.set(token.mint, { accountId, decision: reviewed, priceUsd, at: Date.now() });
      }
      return reviewed;
    } catch (e) {
      trace.fail((e as Error).message);
      throw e;
    }
  }

  /**
   * BUY akun lain untuk token ini dalam reuseMaxAgeMinutes terakhir, dicek terhadap harga sekarang.
   * null = tidak ada analisa yang bisa dipakai (atau harga gagal diambil), review seperti biasa.
   */
  async sharedReview(accountId: number, token: HotToken, settings: BotSettings): Promise<SharedReviewCheck | null> {
    const entry = this.shared.get(token.mint);
    if (!entry || entry.accountId === accountId) return null;
    if (Date.now() - entry.at > settings.reuseMaxAgeMinutes * 60_000) return null;
    const price = await this.prices.getPrice(token.mint).catch(() => null);
    if (!price) return null;

    const changePct = ((price - entry.priceUsd) / entry.priceUsd) * 100;
    const base = { fromAccountId: entry.accountId, changePct };
    if (changePct < -settings.reuseMaxDropPct) return { ...base, decision: null, why: `turun lebih dari ${settings.reuseMaxDropPct}%` };
    if (changePct > settings.reuseMaxRisePct) return { ...base, decision: null, why: `naik lebih dari ${settings.reuseMaxRisePct}%` };
    // Gate kenaikan recheck milik akun ini tetap berlaku pada sampel harga analisa asal.
    const gain = entry.decision.evidence.recheckGainPct;
    if (settings.minRecheckGainPct > 0 && (gain ?? 0) < settings.minRecheckGainPct) {
      return { ...base, decision: null, why: `kenaikan recheck ${(gain ?? 0).toFixed(1)}% < ${settings.minRecheckGainPct}%` };
    }

    const decision = {
      ...entry.decision,
      reason: `Analisa akun #${entry.accountId} (${Math.round((Date.now() - entry.at) / 1000)} dtk lalu, harga ${pct(changePct)}): ${entry.decision.reason}`,
    };
    const trace = this.startTrace(accountId, token);
    trace.reused(`Dari akun #${entry.accountId}, harga ${pct(changePct)} sejak analisa`);
    trace.finish(this.finish(`${accountId}:${token.mint}`, decision));
    return { ...base, decision, why: '' };
  }

  private pruneShared() {
    const cutoff = Date.now() - SHARED_REVIEW_KEEP_MS;
    for (const [mint, entry] of this.shared) if (entry.at < cutoff) this.shared.delete(mint);
  }

  private startTrace(accountId: number, token: HotToken): ReviewTrace {
    const trace = new ReviewTrace(token, MAX_STEPS);
    const reviews = this.reviews.get(accountId) ?? [];
    reviews.unshift(trace.review);
    reviews.splice(KEEP_REVIEWS);
    this.reviews.set(accountId, reviews);
    return trace;
  }

  private async loop(cooldownKey: string, token: HotToken, settings: BotSettings, trace: ReviewTrace, inspector: TokenInspector): Promise<AgentDecision> {

    // Gate sistem sebelum DeepSeek: chart bot sudah jelas dari angka, tidak perlu bayar review.
    trace.toolStarted('get_chart_stats');
    const chart = (await inspector.load('chart')) as Partial<ChartStats>;
    trace.toolFinished('get_chart_stats', chart);
    if (chart.botFlags?.length) {
      const decision = { decision: 'skip' as const, confidence: 100, reason: `Chart buatan bot: ${chart.botFlags.join('; ')}.`, steps: 0 };
      return this.finish(cooldownKey, decision);
    }

    await inspector.samplePrice().catch(() => null);

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ token: describe(token), strategy: strategyOf(settings) }) },
    ];

    for (let step = 1; step <= MAX_STEPS; step++) {
      // Langkah terakhir: paksa keputusan supaya review tidak habis tanpa hasil.
      const toolChoice = step === MAX_STEPS ? { type: 'function' as const, function: { name: 'submit_decision' } } : undefined;
      trace.thinking(step);
      const reply = await this.deepseek.chat({ messages, tools: AGENT_TOOLS, toolChoice });
      if (reply.content?.trim()) trace.note(reply.content);
      messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.tool_calls });
      if (!reply.tool_calls?.length) {
        messages.push({ role: 'user', content: 'Lanjutkan dengan memanggil tool. Akhiri dengan submit_decision.' });
        continue;
      }

      for (const call of reply.tool_calls) {
        if (call.function.name === 'submit_decision') {
          const decision = parseDecision(call);
          const missing = MIN_PRICE_SAMPLES - inspector.samples.length;
          if (decision?.decision === 'buy' && missing > 0) {
            trace.decisionRejected(`Harga baru dicek ${inspector.samples.length}x, minimal ${MIN_PRICE_SAMPLES}x`);
            messages.push(toolResult(call, { error: `Belum cukup data harga. Panggil recheck_price ${missing}x lagi sebelum buy.` }));
            continue;
          }
          const gain = priceGainPct(inspector);
          if (decision?.decision === 'buy' && settings.minRecheckGainPct > 0 && gain < settings.minRecheckGainPct) {
            const reason = `Harga cuma naik ${gain.toFixed(1)}% saat recheck, minimal ${settings.minRecheckGainPct}%. Alasan AI: ${decision.reason}`;
            trace.decisionRejected(`Kenaikan recheck ${gain.toFixed(1)}% < ${settings.minRecheckGainPct}%`);
            return this.finish(cooldownKey, { ...decision, decision: 'skip', reason, steps: step });
          }
          if (decision) return this.finish(cooldownKey, { ...decision, steps: step });
          messages.push(toolResult(call, { error: 'argumen submit_decision tidak valid' }));
          continue;
        }
        const wait = Number((safeJson(call.function.arguments) as { wait_seconds?: number } | null)?.wait_seconds) || undefined;
        trace.toolStarted(call.function.name, wait);
        const result = await runTool(inspector, call);
        trace.toolFinished(call.function.name, result);
        messages.push(toolResult(call, result));
      }
    }
    return this.finish(cooldownKey, { decision: 'skip', confidence: 0, reason: `tidak ada keputusan dalam ${MAX_STEPS} langkah`, steps: MAX_STEPS });
  }

  private finish<D extends AgentDecision>(cooldownKey: string, decision: D): D {
    this.cooldown.set(cooldownKey, Date.now() + REVIEW_COOLDOWN_MS);
    return decision;
  }
}

/** Error tool dikembalikan ke model sebagai data, bukan menggagalkan seluruh review. */
async function runTool(inspector: TokenInspector, call: ToolCall): Promise<unknown> {
  try {
    switch (call.function.name) {
      case 'get_market_data':
        return await inspector.cached('market');
      case 'get_holder_distribution':
        return await inspector.cached('holders');
      case 'get_chart_stats':
        return await inspector.cached('chart');
      case 'recheck_price': {
        const args = safeJson(call.function.arguments) as { wait_seconds?: number } | null;
        return await inspector.recheckPrice(Number(args?.wait_seconds));
      }
      default:
        return { error: `tool ${call.function.name} tidak dikenal` };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Dihitung dari sampel pertama (sebelum model mulai) ke sampel terakhir; sama dengan changeSinceFirstSamplePct yang dilihat model. */
function priceGainPct(inspector: TokenInspector): number {
  const first = inspector.samples[0];
  const last = inspector.samples.at(-1);
  if (!first || !last) return 0;
  return ((last.priceUsd - first.priceUsd) / first.priceUsd) * 100;
}

/** Market memakai pair DexScreener yang sudah diambil gate chart, jadi tidak menambah request. */
async function evidenceOf(inspector: TokenInspector): Promise<ReviewEvidence> {
  const [market, chart] = await Promise.all([inspector.load('market'), inspector.load('chart')]);
  return {
    market,
    chart,
    priceSamples: inspector.samples,
    recheckGainPct: inspector.samples.length >= 2 ? priceGainPct(inspector) : null,
  };
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

function parseDecision(call: ToolCall): Omit<AgentDecision, 'steps'> | null {
  const args = safeJson(call.function.arguments) as { decision?: string; confidence?: number; reason?: string } | null;
  if (args?.decision !== 'buy' && args?.decision !== 'skip') return null;
  return {
    decision: args.decision as AgentVerdict,
    confidence: Math.min(Math.max(Math.round(Number(args.confidence) || 0), 0), 100),
    reason: String(args.reason ?? '').trim() || '-',
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

const toolResult = (call: ToolCall, result: unknown): ChatMessage => ({
  role: 'tool',
  tool_call_id: call.id,
  content: JSON.stringify(result),
});

function describe(t: HotToken) {
  return {
    mint: t.mint,
    symbol: t.symbol ?? shortMint(t.mint),
    name: t.name,
    launchpad: t.launchpad,
    priceUsd: t.price,
    marketCapUsd: t.mc,
    liquidityUsd: t.liquidity,
    volumeUsd: t.volume,
    change1mPct: t.signals.change1mPct,
    change5mPct: t.signals.change5mPct,
    change1hPct: t.change1h,
    buys: t.signals.buys,
    sells: t.signals.sells,
    athMarketCapUsd: t.signals.athMc,
    belowAthPct: t.signals.belowAthPct,
    ageMinutes: t.createdAt ? Math.round((Date.now() / 1000 - t.createdAt) / 60) : null,
  };
}

function strategyOf(s: BotSettings) {
  return {
    buyAmountSol: s.buyAmountSol,
    takeProfitPct: s.takeProfitPct,
    stopLossPct: s.stopLossPct,
    trailingStopPct: s.trailingStopPct || null,
    maxHoldMinutes: s.maxHoldMinutes || null,
    minRecheckGainPct: s.minRecheckGainPct || null,
  };
}

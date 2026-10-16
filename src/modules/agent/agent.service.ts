import type { DeepseekClient } from '../../integrations/deepseek/deepseek.client.ts';
import type { ChatMessage, ToolCall } from '../../integrations/deepseek/deepseek.types.ts';
import type { DexscreenerClient } from '../../integrations/dexscreener/dexscreener.client.ts';
import type { PriceSource } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { HotToken } from '../../integrations/gmgn/gmgn.types.ts';
import type { SolanaClient } from '../../integrations/solana/solana.client.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';
import type { AgentDecision, AgentReview, AgentVerdict } from './agent.interfaces.ts';
import { AGENT_TOOLS, TokenInspector } from './agent.tools.ts';
import { ReviewTrace } from './agent.trace.ts';

/** Batas giliran model per token; habis tanpa keputusan = skip. */
const MAX_STEPS = 8;
/** Buy baru diterima setelah harga dicek minimal sebanyak ini (sampel awal + recheck). */
const MIN_PRICE_SAMPLES = 3;
/** Token yang di-skip tidak ditinjau ulang selama ini, supaya scan berikutnya tidak membayar review yang sama. */
const SKIP_TTL_MS = 30 * 60_000;
/** Review terakhir yang disimpan di memori untuk ditampilkan di app. */
const KEEP_REVIEWS = 10;

const SYSTEM_PROMPT = `Kamu analis token memecoin Solana untuk bot auto-trade. Tugasmu memutuskan apakah token layak dibeli SEKARANG.

Cara kerja:
1. Panggil get_market_data dan get_holder_distribution.
2. Panggil recheck_price beberapa kali (minimal ${MIN_PRICE_SAMPLES - 1}x) untuk melihat arah harga dari waktu ke waktu.
3. Panggil submit_decision.

Pertimbangkan:
- Mint authority atau freeze authority aktif adalah tanda bahaya besar.
- Konsentrasi holder: top 10 di atas ~30% atau satu holder di atas ~10% (di luar bonding curve/pool) berisiko dump.
- Rasio buy/sell dan volume 5 menit terakhir: tekanan jual dominan berarti skip.
- Likuiditas sangat tipis dibanding market cap berarti slippage besar dan mudah rug.
- Harga yang sudah naik sangat tinggi dalam waktu singkat lalu mulai turun di sampel recheck berarti momentum habis.
- Bot memakai take profit dan stop loss yang tertera; beli hanya kalau peluang mencapai take profit lebih besar dari kena stop loss.

Kalau ragu, skip. Modal lebih penting daripada peluang yang terlewat.`;

const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** Agent DeepSeek yang meninjau satu token lewat beberapa putaran tool call sebelum bot buy. */
export class AgentService {
  private readonly skipped = new Map<string, number>();
  private readonly reviews: AgentReview[] = [];

  constructor(
    private readonly deepseek: DeepseekClient,
    private readonly dexscreener: DexscreenerClient,
    private readonly prices: PriceSource,
    private readonly solana: SolanaClient,
  ) {}

  get isConfigured() {
    return this.deepseek.isConfigured;
  }

  /** true kalau token ini di-skip agent belum lama ini. */
  recentlySkipped(mint: string): boolean {
    const until = this.skipped.get(mint);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.skipped.delete(mint);
    return false;
  }

  /** Terbaru dulu; review yang sedang berjalan ikut dengan status running. */
  recentReviews(): AgentReview[] {
    return this.reviews;
  }

  async review(token: HotToken, settings: BotSettings): Promise<AgentDecision> {
    const trace = new ReviewTrace(token, MAX_STEPS);
    this.reviews.unshift(trace.review);
    this.reviews.splice(KEEP_REVIEWS);
    try {
      const decision = await this.loop(token, settings, trace);
      trace.finish(decision);
      return decision;
    } catch (e) {
      trace.fail((e as Error).message);
      throw e;
    }
  }

  private async loop(token: HotToken, settings: BotSettings, trace: ReviewTrace): Promise<AgentDecision> {
    const inspector = new TokenInspector(token.mint, this.dexscreener, this.prices, this.solana);
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
          if (decision) return this.finish(token.mint, { ...decision, steps: step });
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
    return this.finish(token.mint, { decision: 'skip', confidence: 0, reason: `tidak ada keputusan dalam ${MAX_STEPS} langkah`, steps: MAX_STEPS });
  }

  private finish(mint: string, decision: AgentDecision): AgentDecision {
    if (decision.decision === 'skip') this.skipped.set(mint, Date.now() + SKIP_TTL_MS);
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
    change1hPct: t.change1h,
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
  };
}

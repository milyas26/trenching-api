import { setTimeout as sleep } from 'node:timers/promises';
import type { ToolDefinition } from '../../integrations/deepseek/deepseek.types.ts';
import type { DexscreenerClient } from '../../integrations/dexscreener/dexscreener.client.ts';
import type { DexPair } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { GeckoterminalClient } from '../../integrations/geckoterminal/geckoterminal.client.ts';
import type { PriceSource } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { TokenSafety, TokenSignals } from '../../integrations/gmgn/gmgn.types.ts';
import type { PriceSample } from './agent.interfaces.ts';
import { analyzeChart, CHART_WINDOW, type ChartStats } from './agent.chart.ts';

export const MIN_WAIT_SEC = 5;
export const MAX_WAIT_SEC = 30;

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_market_data',
      description: 'Data pasar DexScreener: harga, perubahan harga, volume, jumlah transaksi buy/sell per window (m5, h1, h6, h24), likuiditas, umur pair, link sosial.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_holder_distribution',
      description: 'Distribusi holder, keamanan, dan sinyal risiko dari GMGN: top 10 holder, jumlah holder, mint/freeze authority, status dev, rug ratio, sniper, smart money, KOL, wash trading, bundler, bot degen, entrapment, sniper yang masih pegang, insider, logo copycat, dan promosi berbayar DexScreener.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chart_stats',
      description: `Statistik candle 1 menit (${CHART_WINDOW} menit terakhir) dan ukuran rata-rata trade: streak candle hijau, jumlah candle merah, rata-rata volume, body 10 candle terakhir, dan botFlags kalau chart terlihat dibuat bot.`,
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recheck_price',
      description: `Tunggu beberapa detik lalu ambil harga on-chain lagi. Mengembalikan semua sampel harga sejauh ini untuk melihat momentum.`,
      parameters: {
        type: 'object',
        properties: {
          wait_seconds: { type: 'integer', minimum: MIN_WAIT_SEC, maximum: MAX_WAIT_SEC },
        },
        required: ['wait_seconds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_decision',
      description: 'Keputusan akhir. Panggil sekali setelah data cukup.',
      parameters: {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['buy', 'skip'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          reason: { type: 'string', description: 'Alasan singkat, maksimal 2 kalimat, bahasa Indonesia.' },
        },
        required: ['decision', 'confidence', 'reason'],
      },
    },
  },
];

export type InspectorData = 'market' | 'holders' | 'chart';

const round = (n: number | null | undefined, digits = 2) => (n == null ? null : Number(n.toFixed(digits)));

/** Data yang bisa diminta model. Satu instance per review token, menyimpan sampel harga selama review. */
export class TokenInspector {
  readonly samples: PriceSample[] = [];
  private readonly loaded = new Map<InspectorData, Promise<unknown>>();
  private readonly served = new Set<InspectorData>();
  private pairs: Promise<DexPair[]> | null = null;

  constructor(
    private readonly mint: string,
    private readonly safety: TokenSafety,
    private readonly signals: TokenSignals,
    private readonly dexscreener: DexscreenerClient,
    private readonly gecko: GeckoterminalClient,
    private readonly prices: PriceSource,
  ) {}

  /** Diambil sekali per review; gate chart sistem dan tool model memakai hasil yang sama. */
  load(name: InspectorData): Promise<unknown> {
    let result = this.loaded.get(name);
    if (!result) {
      const fetchers = { market: () => this.marketData(), holders: () => this.holderDistribution(), chart: () => this.chartStats() };
      result = fetchers[name]().catch((e: Error) => ({ error: e.message, note: 'data tidak tersedia, nilai risiko dari data lain' }));
      this.loaded.set(name, result);
    }
    return result;
  }

  /** Data market/holder/chart tidak berubah berarti dalam satu review; panggilan ulang model dapat hasil yang sama. */
  async cached(name: InspectorData): Promise<unknown> {
    const result = await this.load(name);
    if (this.served.has(name)) {
      return { note: 'data ini sudah diberikan sebelumnya dan tidak akan berubah, jangan panggil lagi', result };
    }
    this.served.add(name);
    return result;
  }

  private getPairs() {
    this.pairs ??= this.dexscreener.getPairs(this.mint);
    return this.pairs;
  }

  /** Candle gagal diambil tidak menggagalkan stats; ukuran trade cukup dari DexScreener. */
  private async chartStats(): Promise<ChartStats> {
    const [pair] = await this.getPairs();
    if (!pair) throw new Error('token belum punya pair di DexScreener');
    let candleError: string | undefined;
    const candles = pair.pairAddress
      ? await this.gecko.getMinuteCandles(pair.pairAddress, CHART_WINDOW + 1).catch((e: Error) => { candleError = e.message; return null; })
      : null;
    const stats = analyzeChart(candles, pair, Date.now() / 1000);
    if (candleError) stats.candleError = candleError;
    return stats;
  }

  private async marketData() {
    const [pair, ...others] = await this.getPairs();
    if (!pair) return { error: 'token belum punya pair di DexScreener' };
    return {
      dex: pair.dexId,
      priceUsd: Number(pair.priceUsd),
      marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
      liquidityUsd: pair.liquidity?.usd ?? null,
      pairAgeMinutes: pair.pairCreatedAt ? Math.round((Date.now() - pair.pairCreatedAt) / 60_000) : null,
      priceChangePct: pair.priceChange,
      volumeUsd: pair.volume,
      txns: pair.txns,
      otherPairs: others.length,
      websites: pair.info?.websites?.map((w) => w.url) ?? [],
      socials: pair.info?.socials?.map((s) => `${s.type}: ${s.url}`) ?? [],
      activeBoosts: pair.boosts?.active ?? 0,
    };
  }

  /** Diambil dari hasil scan GMGN, jadi tidak butuh RPC Solana yang rate limit-nya ketat. */
  private async holderDistribution() {
    const g = this.safety;
    const s = this.signals;
    if (g.top10HolderPct === null && g.holderCount === null) throw new Error('GMGN tidak mengirim data holder untuk token ini');
    return {
      top10HoldersPct: g.top10HolderPct,
      holderCount: g.holderCount,
      mintAuthorityActive: g.mintRenounced === null ? null : !g.mintRenounced,
      freezeAuthorityActive: g.freezeRenounced === null ? null : !g.freezeRenounced,
      creatorStatus: g.creatorStatus,
      rugRatio: g.rugRatio,
      sniperCount: g.sniperCount,
      smartMoneyCount: g.smartMoneyCount,
      kolCount: g.kolCount,
      washTrading: g.washTrading,
      communityTakeover: g.communityTakeover,
      dumpRisk: {
        bundlerPct: s.bundlerPct,
        botDegenPct: s.botDegenPct,
        entrapmentPct: s.entrapmentPct,
        top70SniperHoldPct: s.top70SniperHoldPct,
        ratTraderPct: s.ratTraderPct,
        devTeamHoldPct: s.devTeamHoldPct,
      },
      duplicateLogoCount: s.duplicateLogoCount,
      xRenameCount: s.xRenameCount,
      promotion: {
        dexscreenerBoosts: s.dexscreenerBoosts,
        dexscreenerPaidProfile: s.dexscreenerPaidProfile,
        dexscreenerAd: s.dexscreenerAd,
      },
    };
  }

  /** Sampel harga diambil dari sumber yang sama (on-chain) supaya momentum tidak tercampur selisih antar sumber. */
  async samplePrice(): Promise<PriceSample | null> {
    const quote = (await this.prices.getQuotes([this.mint])).get(this.mint);
    if (!quote || quote.priceUsd <= 0) return null;
    const sample = { at: Date.now(), priceUsd: quote.priceUsd, marketCap: quote.marketCap };
    this.samples.push(sample);
    return sample;
  }

  async recheckPrice(waitSeconds: number) {
    const wait = Math.min(Math.max(Math.round(waitSeconds) || MIN_WAIT_SEC, MIN_WAIT_SEC), MAX_WAIT_SEC);
    await sleep(wait * 1000);
    const latest = await this.samplePrice();
    if (!latest) return { error: 'harga tidak tersedia' };

    const first = this.samples[0]!;
    return {
      waitedSeconds: wait,
      changeSinceFirstSamplePct: round(((latest.priceUsd - first.priceUsd) / first.priceUsd) * 100),
      samples: this.samples.map((s) => ({
        secondsFromStart: Math.round((s.at - first.at) / 1000),
        priceUsd: s.priceUsd,
        marketCapUsd: round(s.marketCap, 0),
      })),
    };
  }
}

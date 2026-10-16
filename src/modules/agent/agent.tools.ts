import { setTimeout as sleep } from 'node:timers/promises';
import type { ToolDefinition } from '../../integrations/deepseek/deepseek.types.ts';
import type { DexscreenerClient } from '../../integrations/dexscreener/dexscreener.client.ts';
import type { PriceSource } from '../../integrations/dexscreener/dexscreener.types.ts';
import type { TokenSafety } from '../../integrations/gmgn/gmgn.types.ts';
import type { PriceSample } from './agent.interfaces.ts';

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
      description: 'Distribusi holder dan keamanan token dari GMGN: persentase supply di 10 holder teratas, jumlah holder, status mint/freeze authority, status dev, rug ratio, sniper, smart money, KOL, wash trading.',
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

const round = (n: number | null | undefined, digits = 2) => (n == null ? null : Number(n.toFixed(digits)));

/** Data yang bisa diminta model. Satu instance per review token, menyimpan sampel harga selama review. */
export class TokenInspector {
  readonly samples: PriceSample[] = [];
  private readonly once = new Map<string, unknown>();

  constructor(
    private readonly mint: string,
    private readonly safety: TokenSafety,
    private readonly dexscreener: DexscreenerClient,
    private readonly prices: PriceSource,
  ) {}

  /** Data market/holder tidak berubah berarti dalam satu review; panggilan ulang dapat hasil yang sama. */
  async cached(name: 'market' | 'holders'): Promise<unknown> {
    if (this.once.has(name)) {
      return { note: 'data ini sudah diberikan sebelumnya dan tidak akan berubah, jangan panggil lagi', result: this.once.get(name) };
    }
    const result = await (name === 'market' ? this.marketData() : this.holderDistribution())
      .catch((e: Error) => ({ error: e.message, note: 'data tidak tersedia, nilai risiko dari data lain' }));
    this.once.set(name, result);
    return result;
  }

  private async marketData() {
    const [pair, ...others] = await this.dexscreener.getPairs(this.mint);
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

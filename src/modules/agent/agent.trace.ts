import type { HotToken } from '../../integrations/gmgn/gmgn.types.ts';
import type { AgentDecision, AgentReview, AgentStepKind } from './agent.interfaces.ts';

const usd = (v: unknown) => {
  if (typeof v !== 'number') return '–';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const pct = (v: unknown) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '–');

type Result = Record<string, any>;

/** Ringkasan satu baris hasil tool untuk timeline di app. */
function summarize(kind: AgentStepKind, raw: unknown): { detail: string; failed: boolean } {
  const r = (raw ?? {}) as Result;
  const data = (r.result ?? r) as Result;
  if (data.error) return { detail: `Gagal: ${data.error}`, failed: true };

  if (kind === 'market') {
    const m5 = data.txns?.m5;
    return {
      failed: false,
      detail: [
        `MC ${usd(data.marketCapUsd)}`,
        `likuiditas ${usd(data.liquidityUsd)}`,
        m5 ? `5m ${m5.buys} buy / ${m5.sells} sell` : null,
        `harga 5m ${pct(data.priceChangePct?.m5)}`,
      ].filter(Boolean).join(' · '),
    };
  }
  if (kind === 'holders') {
    const auth = [data.mintAuthorityActive && 'mint authority AKTIF', data.freezeAuthorityActive && 'freeze authority AKTIF']
      .filter(Boolean).join(', ')
      || (data.mintAuthorityActive === null && data.freezeAuthorityActive === null ? 'authority tidak diketahui' : 'authority aman');
    const g = data;
    return {
      failed: false,
      detail: [
        `Top 10 ${data.top10HoldersPct}%`,
        g.holderCount != null ? `${g.holderCount} holder` : null,
        auth,
        g.creatorStatus === 'creator_close' ? 'dev sudah keluar' : g.creatorStatus === 'creator_hold' ? 'dev masih pegang' : null,
        typeof g.rugRatio === 'number' ? `rug ${Math.round(g.rugRatio * 100)}%` : null,
      ].filter(Boolean).join(' · '),
    };
  }
  if (kind === 'recheck') {
    return {
      failed: false,
      detail: `${pct(data.changeSinceFirstSamplePct)} sejak sampel pertama (${data.samples?.length ?? 0} sampel)`,
    };
  }
  return { detail: '', failed: false };
}

const TITLES: Record<string, { kind: AgentStepKind; title: string; activity: string }> = {
  get_market_data: { kind: 'market', title: 'Data pasar', activity: 'Mengambil data pasar DexScreener' },
  get_holder_distribution: { kind: 'holders', title: 'Distribusi holder', activity: 'Membaca holder on-chain' },
  recheck_price: { kind: 'recheck', title: 'Cek ulang harga', activity: 'Menunggu lalu cek harga on-chain' },
};

let nextId = 1;

/** Mencatat jalannya satu review supaya app bisa menampilkan loop agent secara live. */
export class ReviewTrace {
  readonly review: AgentReview;

  constructor(token: HotToken, maxLoops: number) {
    this.review = {
      id: nextId++,
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      logo: token.logo,
      status: 'running',
      activity: 'Mengambil harga awal',
      loop: 0,
      maxLoops,
      confidence: null,
      reason: null,
      steps: [],
      startedAt: new Date(),
      finishedAt: null,
    };
  }

  thinking(loop: number) {
    this.review.loop = loop;
    this.review.activity = `Putaran ${loop}: DeepSeek menimbang langkah berikutnya`;
  }

  note(text: string) {
    this.push('note', 'Catatan agent', text.trim(), false);
  }

  toolStarted(name: string, waitSeconds?: number) {
    const meta = TITLES[name];
    if (!meta) return;
    this.review.activity = name === 'recheck_price' && waitSeconds
      ? `Menunggu ${waitSeconds} dtk lalu cek harga on-chain`
      : meta.activity;
  }

  toolFinished(name: string, result: unknown) {
    const meta = TITLES[name] ?? { kind: 'note' as const, title: name };
    const { detail, failed } = summarize(meta.kind, result);
    this.push(meta.kind, meta.title, detail, failed);
  }

  decisionRejected(message: string) {
    this.push('decision', 'Buy ditolak sistem', message, true);
  }

  finish(d: AgentDecision) {
    // Alasan lengkap sudah tampil di atas timeline; baris keputusan cukup memuat keyakinan.
    this.push('decision', d.decision === 'buy' ? 'Keputusan: BUY' : 'Keputusan: SKIP', `Keyakinan ${d.confidence}%`, false);
    Object.assign(this.review, {
      status: d.decision, confidence: d.confidence, reason: d.reason, activity: null, finishedAt: new Date(),
    });
  }

  fail(message: string) {
    this.push('note', 'Review gagal', message, true);
    Object.assign(this.review, { status: 'error', reason: message, activity: null, finishedAt: new Date() });
  }

  private push(kind: AgentStepKind, title: string, detail: string, failed: boolean) {
    this.review.steps.push({ at: new Date(), loop: this.review.loop, kind, title, detail, failed });
  }
}

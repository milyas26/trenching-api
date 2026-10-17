import { execFile } from 'node:child_process';
import { env } from '../../config/env.ts';
import type { HotScan, HotSearchFilter, HotToken, RawHotToken, TokenSource } from './gmgn.types.ts';

const OPTIONAL_FLAGS = {
  minMc: '--min-mc',
  maxMc: '--max-mc',
  minAge: '--min-age',
  maxAge: '--max-age',
} as const satisfies Partial<Record<keyof HotSearchFilter, string>>;

/** gmgn_hot_searches.py: MC dalam ribu USD, umur dalam menit, flag dilewati kalau tidak dibatasi. */
function hotSearchArgs(filter: HotSearchFilter): string[] {
  const args = [env.gmgnScript, '--response', '--chain', filter.chain, '--interval', filter.interval, '--limit', String(filter.limit)];
  for (const [key, flag] of Object.entries(OPTIONAL_FLAGS) as [keyof typeof OPTIONAL_FLAGS, string][]) {
    const value = filter[key];
    if (value !== null) args.push(flag, String(Math.trunc(value)));
  }
  return args;
}

/**
 * gmgn_trending.py: MC dalam USD, umur sebagai "<n>m". Script punya default sendiri
 * (umur 5-40 menit, MC min $20K), jadi batas yang kosong dikirim eksplisit sebagai "tanpa batas".
 */
function trendingArgs(filter: HotSearchFilter): string[] {
  const age = (minutes: number | null) => (minutes === null ? '' : `${Math.trunc(minutes)}m`);
  const args = [
    env.gmgnTrendingScript, '--response',
    '--chain', filter.chain,
    '--interval', filter.interval,
    '--limit', String(filter.limit),
    `--min-created=${age(filter.minAge)}`,
    `--max-created=${age(filter.maxAge)}`,
    '--min-mcap', String(filter.minMc === null ? 0 : filter.minMc * 1000),
  ];
  if (filter.maxMc !== null) args.push('--max-mcap', String(filter.maxMc * 1000));
  return args;
}

const pct = (ratio: number | undefined) => (ratio == null ? null : Number((ratio * 100).toFixed(2)));
const flag = (v: number | undefined) => (v == null ? null : v > 0);

function toHotToken(t: RawHotToken): HotToken {
  return {
    mint: t.a,
    symbol: t.s ?? null,
    name: t.nm ?? null,
    logo: t.l ?? null,
    price: t.p ?? null,
    mc: t.mc ?? null,
    liquidity: t.lq ?? null,
    volume: t.v ?? null,
    change1h: t.pcp1h ?? null,
    createdAt: t.ct ?? null,
    launchpad: t.lpp ?? null,
    safety: {
      top10HolderPct: t.t10 == null ? null : Number((t.t10 * 100).toFixed(2)),
      holderCount: t.hd ?? null,
      mintRenounced: t.s_nm == null ? null : t.s_nm === 1,
      freezeRenounced: t.s_blk == null ? null : t.s_blk === 1,
      creatorStatus: t.d_ts || null,
      rugRatio: t.rug ?? null,
      sniperCount: t.snp ?? null,
      smartMoneyCount: t.smt ?? null,
      kolCount: t.kol ?? null,
      washTrading: t.iwt ?? null,
      communityTakeover: t.cto == null ? null : t.cto === 1,
    },
    signals: {
      change1mPct: t.pcp1m ?? null,
      change5mPct: t.pcp5m ?? null,
      buys: t.bu ?? null,
      sells: t.se ?? null,
      athMc: t.hhmc ?? null,
      belowAthPct: t.hhmc && t.mc ? Number(((1 - t.mc / t.hhmc) * 100).toFixed(1)) : null,
      bundlerPct: pct(t.bdrr),
      botDegenPct: pct(t.bdr),
      entrapmentPct: pct(t.etpr),
      top70SniperHoldPct: pct(t.t70_shr),
      ratTraderPct: pct(t.rat),
      devTeamHoldPct: pct(t.d_br),
      duplicateLogoCount: t.img_dup == null || t.img_dup === '' ? null : Number(t.img_dup),
      dexscreenerBoosts: t.dx_bf ?? null,
      dexscreenerPaidProfile: flag(t.dx_ul),
      dexscreenerAd: flag(t.dx_ad),
      xRenameCount: t.xcc ?? null,
    },
    info: {
      top10Pct: pct(t.t10),
      devHoldPct: pct(t.d_br),
      devSold: t.d_ts ? t.d_ts === 'creator_close' : null,
      insiderPct: pct(t.rat),
      bundlerPct: pct(t.bdrr),
      phishingPct: pct(t.etpr),
      sniperPct: pct(t.t70_shr),
      dexPaid: flag(t.dx_ul),
      communityTakeover: t.cto == null ? null : t.cto === 1,
      botDegenCount: t.bdc ?? null,
      botDegenPct: pct(t.bdr),
    },
    raw: t as unknown as Record<string, unknown>,
  };
}

/**
 * GMGN ada di belakang Cloudflare yang cek TLS fingerprint, jadi fetch tetap
 * lewat script Python (curl_cffi, impersonate Chrome). Kedua endpoint mengembalikan
 * token dengan field yang sama.
 */
export class GmgnClient {
  fetchTokens(source: TokenSource, filter: HotSearchFilter): Promise<HotScan> {
    const args = source === 'trending' ? trendingArgs(filter) : hotSearchArgs(filter);
    return new Promise((resolve, reject) => {
      execFile(env.pythonBin, args, { timeout: 45_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim()));
        try {
          const { data, ...rest } = JSON.parse(stdout) as { data: { tokens: RawHotToken[] }[] };
          const { tokens, ...block } = data[0]!;
          resolve({ response: { ...rest, ...block }, tokens: tokens.filter((t) => t.a).map(toHotToken) });
        } catch (e) {
          reject(new Error(`output script bukan JSON: ${(e as Error).message}`));
        }
      });
    });
  }
}

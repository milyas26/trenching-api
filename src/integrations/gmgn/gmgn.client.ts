import { execFile } from 'node:child_process';
import { env } from '../../config/env.ts';
import type { HotScan, HotSearchFilter, HotToken, RawHotToken } from './gmgn.types.ts';

const OPTIONAL_FLAGS = {
  minMc: '--min-mc',
  maxMc: '--max-mc',
  minAge: '--min-age',
  maxAge: '--max-age',
} as const satisfies Partial<Record<keyof HotSearchFilter, string>>;

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
      devTeamHoldPct: pct(t.dhr),
      duplicateLogoCount: t.img_dup == null || t.img_dup === '' ? null : Number(t.img_dup),
      dexscreenerBoosts: t.dx_bf ?? null,
      dexscreenerPaidProfile: flag(t.dx_ul),
      dexscreenerAd: flag(t.dx_ad),
      xRenameCount: t.xcc ?? null,
    },
    raw: t as unknown as Record<string, unknown>,
  };
}

/**
 * GMGN ada di belakang Cloudflare yang cek TLS fingerprint, jadi fetch tetap
 * lewat gmgn_hot_searches.py (curl_cffi, impersonate Chrome).
 */
export class GmgnClient {
  fetchHotTokens(filter: HotSearchFilter): Promise<HotScan> {
    const args = [
      env.gmgnScript, '--response',
      '--chain', filter.chain,
      '--interval', filter.interval,
      '--limit', String(filter.limit),
    ];
    for (const [key, flag] of Object.entries(OPTIONAL_FLAGS) as [keyof typeof OPTIONAL_FLAGS, string][]) {
      const value = filter[key];
      if (value !== null) args.push(flag, String(Math.trunc(value)));
    }

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

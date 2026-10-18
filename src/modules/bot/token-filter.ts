import type { HotToken, TokenInfo } from '../../integrations/gmgn/gmgn.types.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';

type TokenFilter = BotSettings['tokenFilter'];
type NumberKey = { [K in keyof TokenFilter]: TokenFilter[K] extends number | null ? K : never }[keyof TokenFilter];
type Rule = { key: NumberKey; field: keyof TokenInfo; label: string; unit: string };

const MAX_RULES: Rule[] = [
  { key: 'maxTop10Pct', field: 'top10Pct', label: 'Top 10', unit: '%' },
  { key: 'maxDevHoldPct', field: 'devHoldPct', label: 'Dev hold', unit: '%' },
  { key: 'maxInsiderPct', field: 'insiderPct', label: 'Insider', unit: '%' },
  { key: 'maxBundlerPct', field: 'bundlerPct', label: 'Bundler', unit: '%' },
  { key: 'maxPhishingPct', field: 'phishingPct', label: 'Phishing', unit: '%' },
  { key: 'maxSniperPct', field: 'sniperPct', label: 'Sniper', unit: '%' },
  { key: 'maxBotDegenCount', field: 'botDegenCount', label: 'Bot degen', unit: '' },
  { key: 'maxBotDegenPct', field: 'botDegenPct', label: 'Bot degen', unit: '%' },
  { key: 'maxRugPct', field: 'rugPct', label: 'Rug', unit: '%' },
];

const MIN_RULES: Rule[] = [
  { key: 'minSells1h', field: 'sells1h', label: 'Sells 1h', unit: '' },
  { key: 'minSwaps1h', field: 'swaps1h', label: 'Swaps 1h', unit: '' },
  { key: 'minKol', field: 'kolCount', label: 'KOL', unit: '' },
  { key: 'minSmartMoney', field: 'smartMoneyCount', label: 'Smart money', unit: '' },
];

/** Alasan token ditolak filter Token Info; kosong = lolos. */
export function tokenFilterRejections(info: TokenInfo, filter: TokenFilter): string[] {
  const reasons: string[] = [];
  for (const { key, field, label, unit } of MAX_RULES) {
    const max = filter[key];
    if (max === null) continue;
    const value = info[field] as number | null;
    if (value === null) reasons.push(`${label} tidak ada data`);
    else if (value > max) reasons.push(`${label} ${value}${unit} > ${max}${unit}`);
  }
  for (const { key, field, label, unit } of MIN_RULES) {
    const min = filter[key];
    if (min === null) continue;
    const value = info[field] as number | null;
    if (value === null) reasons.push(`${label} tidak ada data`);
    else if (value < min) reasons.push(`${label} ${value}${unit} < ${min}${unit}`);
  }
  if (filter.devSoldOnly && info.devSold !== true) reasons.push('Dev belum jual');
  if (filter.dexPaidOnly && info.dexPaid !== true) reasons.push('Dex belum paid');
  if (filter.ogOnly && info.isOg !== true) reasons.push('Bukan OG');
  return reasons;
}

export function applyTokenFilter(tokens: HotToken[], filter: TokenFilter) {
  const passed: HotToken[] = [];
  const rejected = new Map<string, string[]>();
  for (const token of tokens) {
    const reasons = tokenFilterRejections(token.info, filter);
    if (reasons.length === 0) passed.push(token);
    else rejected.set(token.mint, reasons);
  }
  return { passed, rejected };
}

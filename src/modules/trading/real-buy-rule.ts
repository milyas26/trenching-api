import type { TokenInfo } from '../../integrations/gmgn/gmgn.types.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Alasan token tidak boleh dibeli real menurut settings.realBuy; kosong = boleh.
 * Batas yang diisi tapi datanya tidak ada di GMGN dihitung tidak cocok, supaya wallet asli tidak dipakai tanpa data.
 */
export function realBuyMisses(info: TokenInfo | null, settings: BotSettings, now = Date.now()): string[] {
  const { minBundlerPct, maxBundlerPct, minAgeMinutes, maxAgeMinutes } = settings.realBuy;
  const misses: string[] = [];

  if (minBundlerPct !== null || maxBundlerPct !== null) {
    const bundler = info?.bundlerPct ?? null;
    if (bundler === null) misses.push('bundler tidak diketahui');
    else if (minBundlerPct !== null && bundler < minBundlerPct) misses.push(`bundler ${fmt(bundler)}% < min ${minBundlerPct}%`);
    else if (maxBundlerPct !== null && bundler > maxBundlerPct) misses.push(`bundler ${fmt(bundler)}% > max ${maxBundlerPct}%`);
  }

  if (minAgeMinutes !== null || maxAgeMinutes !== null) {
    const createdAt = info?.createdAt ?? null;
    if (createdAt === null) misses.push('umur token tidak diketahui');
    else {
      const age = (now / 1000 - createdAt) / 60;
      if (minAgeMinutes !== null && age < minAgeMinutes) misses.push(`umur ${fmt(age)} menit < min ${minAgeMinutes}`);
      else if (maxAgeMinutes !== null && age > maxAgeMinutes) misses.push(`umur ${fmt(age)} menit > max ${maxAgeMinutes}`);
    }
  }
  return misses;
}

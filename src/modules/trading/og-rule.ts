import type { TokenInfo } from '../../integrations/gmgn/gmgn.types.ts';
import type { BotSettings } from '../settings/settings.interfaces.ts';

/**
 * Take profit khusus token OG (settings.ogRule): berlaku kalau token bertag OG dan market cap
 * saat beli <= ogRule.maxMc (ribu USD; null = berapa pun). null = pakai take profit biasa.
 */
export function ogTakeProfit(info: TokenInfo | null, mcUsd: number | null, settings: BotSettings): number | null {
  const { maxMc, takeProfitPct } = settings.ogRule;
  if (takeProfitPct === null || info?.isOg !== true) return null;
  if (maxMc !== null && (mcUsd === null || mcUsd > maxMc * 1000)) return null;
  return takeProfitPct;
}

/** Settings dengan take profit yang benar-benar dipakai untuk token ini (dikirim ke AI agent). */
export function settingsForToken(token: { info: TokenInfo | null; mc: number | null }, settings: BotSettings): BotSettings {
  const tp = ogTakeProfit(token.info, token.mc, settings);
  return tp === null ? settings : { ...settings, takeProfitPct: tp };
}

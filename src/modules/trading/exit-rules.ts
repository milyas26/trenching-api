import type { BotSettings } from '../settings/settings.interfaces.ts';
import type { ExitReason } from '../positions/positions.interfaces.ts';

export interface ExitInput {
  entryPrice: number;
  highPrice: number;
  openedAt: Date;
  price: number;
}

export type ExitRules = Pick<BotSettings, 'takeProfitPct' | 'stopLossPct' | 'trailingStopPct' | 'maxHoldMinutes'>;

export const pnlPct = (entry: number, price: number) => (price / entry - 1) * 100;

/** Urutan cek: TP, SL, trailing stop, max hold. */
export function evaluateExit(p: ExitInput, rules: ExitRules, now = Date.now()): ExitReason | null {
  const pnl = pnlPct(p.entryPrice, p.price);
  if (pnl >= rules.takeProfitPct) return 'take_profit';
  if (pnl <= -rules.stopLossPct) return 'stop_loss';
  if (rules.trailingStopPct > 0 && p.highPrice > p.entryPrice
      && p.price <= p.highPrice * (1 - rules.trailingStopPct / 100)) return 'trailing_stop';
  if (rules.maxHoldMinutes > 0 && now - p.openedAt.getTime() >= rules.maxHoldMinutes * 60_000) return 'max_hold';
  return null;
}

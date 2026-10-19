import type { BotSettings } from '../settings/settings.interfaces.ts';
import type { ExitReason } from '../positions/positions.interfaces.ts';

export interface ExitInput {
  entryPrice: number;
  highPrice: number;
  openedAt: Date;
  price: number;
  /** Market cap USD di harga `price` dan saat entry; null kalau supply token tidak diketahui. */
  mc: number | null;
  entryMc: number | null;
}

export type ExitRules = Pick<BotSettings, 'takeProfitPct' | 'stopLossPct' | 'stopLossMc' | 'trailingStopPct' | 'maxHoldMinutes'>;

export const pnlPct = (entry: number, price: number) => (price / entry - 1) * 100;

/**
 * Urutan cek: TP, SL, SL market cap, trailing stop, max hold.
 * SL market cap hanya berlaku kalau entry di atas batasnya; token yang dibeli di bawah batas tidak langsung dijual.
 * Trailing stop aktif: TP tidak langsung jual, tapi jadi titik mulai trailing. Setelah harga tertinggi
 * mencapai TP, posisi dijual saat harga turun X% dari harga tertinggi.
 */
export function evaluateExit(p: ExitInput, rules: ExitRules, now = Date.now()): ExitReason | null {
  const pnl = pnlPct(p.entryPrice, p.price);
  const trailing = rules.trailingStopPct > 0;
  if (!trailing && pnl >= rules.takeProfitPct) return 'take_profit';
  if (pnl <= -rules.stopLossPct) return 'stop_loss';
  const mcFloor = rules.stopLossMc * 1000;
  if (mcFloor > 0 && p.mc !== null && p.entryMc !== null && p.entryMc > mcFloor && p.mc <= mcFloor) return 'stop_loss_mc';
  if (trailing && pnlPct(p.entryPrice, p.highPrice) >= rules.takeProfitPct
      && p.price <= p.highPrice * (1 - rules.trailingStopPct / 100)) return 'trailing_stop';
  if (rules.maxHoldMinutes > 0 && now - p.openedAt.getTime() >= rules.maxHoldMinutes * 60_000) return 'max_hold';
  return null;
}

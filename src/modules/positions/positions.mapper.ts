import type { Position, PositionDto } from './positions.interfaces.ts';

/** Posisi lama (sebelum kolom supply) memakai market cap GMGN saat scan sebagai acuan. */
function supplyOf(p: Position): number | null {
  if (p.supply) return p.supply;
  if (p.entryMc && p.entryPrice) return p.entryMc / p.entryPrice;
  return null;
}

export function toPositionDto(p: Position): PositionDto {
  const supply = supplyOf(p);
  const mc = (price: number | null) => (supply && price ? price * supply : null);
  return {
    ...p,
    entryMc: mc(p.entryPrice) ?? p.entryMc,
    currentMc: mc(p.currentPrice),
    highMc: mc(p.highPrice),
    lowMc: mc(p.lowPrice),
    exitMc: mc(p.exitPrice),
  };
}

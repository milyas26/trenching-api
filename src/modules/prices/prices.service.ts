import type { PriceEvent, PriceEventListener, PriceTick } from './prices.interfaces.ts';

/** Hub in-memory: MonitorService publish, setiap koneksi SSE subscribe. */
export class PricesService {
  private readonly listeners = new Set<PriceEventListener>();
  /** Tick terakhir per posisi, dikirim sebagai snapshot ke koneksi baru. */
  private readonly latest = new Map<number, PriceTick>();

  subscribe(listener: PriceEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): PriceTick[] {
    return [...this.latest.values()];
  }

  publishTick(tick: PriceTick) {
    this.latest.set(tick.id, tick);
    this.emit({ type: 'price', tick });
  }

  /** Buang tick posisi yang sudah tidak open (mis. ditutup manual dari app). */
  retain(openIds: Set<number>) {
    for (const id of this.latest.keys()) if (!openIds.has(id)) this.latest.delete(id);
  }

  publishClosed(id: number) {
    this.latest.delete(id);
    this.emit({ type: 'closed', id });
  }

  private emit(event: PriceEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

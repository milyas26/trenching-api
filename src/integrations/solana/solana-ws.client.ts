import { env } from '../../config/env.ts';

export type AccountListener = (data: Buffer, slot: number) => void;

interface Subscription {
  listener: AccountListener;
  /** Id dari server; null selama subscribe belum dibalas atau socket belum terhubung. */
  subId: number | null;
}

interface WsMessage {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
  params?: {
    subscription: number;
    result: { context: { slot: number }; value: { data: [string, 'base64'] } | null };
  };
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Server RPC menutup koneksi yang diam; pesan apa pun dari klien menahan timer itu. */
const KEEPALIVE_MS = 30_000;
/** Feed Pyth berubah tiap slot, jadi 30 detik tanpa pesan berarti koneksi macet. */
const STALE_MS = 30_000;

/**
 * accountSubscribe Solana lewat WebSocket bawaan Node (commitment confirmed).
 * Socket hanya dibuka selama ada subscription, reconnect dengan backoff, dan semua akun
 * di-subscribe ulang setiap kali tersambung kembali.
 */
export class SolanaWsClient {
  private ws: WebSocket | null = null;
  private readonly subs = new Map<string, Subscription>();
  private readonly bySubId = new Map<number, string>();
  /** id request accountSubscribe -> alamat. */
  private readonly pending = new Map<number, string>();
  private nextId = 1;
  private backoffMs = RECONNECT_MIN_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;

  constructor(private readonly url = env.solanaWsUrl) {}

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  subscribe(address: string, listener: AccountListener) {
    if (this.subs.has(address)) {
      this.subs.get(address)!.listener = listener;
      return;
    }
    this.subs.set(address, { listener, subId: null });
    if (this.connected) this.sendSubscribe(address);
    else this.connect();
  }

  unsubscribe(address: string) {
    const sub = this.subs.get(address);
    if (!sub) return;
    this.subs.delete(address);
    if (sub.subId !== null) {
      this.bySubId.delete(sub.subId);
      if (this.connected) this.send('accountUnsubscribe', [sub.subId]);
    }
    if (this.subs.size === 0) this.disconnect();
  }

  close() {
    this.subs.clear();
    this.disconnect();
  }

  private connect() {
    if (this.ws || this.reconnectTimer) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.lastMessageAt = Date.now();
      for (const address of this.subs.keys()) this.sendSubscribe(address);
      this.keepaliveTimer = setInterval(() => this.keepalive(), KEEPALIVE_MS);
    });
    ws.addEventListener('message', (ev) => {
      this.lastMessageAt = Date.now();
      this.backoffMs = RECONNECT_MIN_MS;
      this.handle(String(ev.data));
    });
    // Event error selalu diikuti close, jadi reconnect cukup diatur di close.
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.resetSocket();
      if (this.subs.size > 0) this.scheduleReconnect();
    });
  }

  private disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.resetSocket();
    ws?.close();
  }

  private resetSocket() {
    this.ws = null;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    this.pending.clear();
    this.bySubId.clear();
    for (const sub of this.subs.values()) sub.subId = null;
  }

  private scheduleReconnect() {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subs.size > 0) this.connect();
    }, delay);
  }

  private keepalive() {
    if (Date.now() - this.lastMessageAt > STALE_MS) {
      this.ws?.close();
      return;
    }
    // Method tidak dikenal dibalas error oleh server; cukup untuk menjaga koneksi tetap hidup.
    this.send('ping', []);
  }

  private sendSubscribe(address: string) {
    const id = this.send('accountSubscribe', [address, { encoding: 'base64', commitment: 'confirmed' }]);
    this.pending.set(id, address);
  }

  private send(method: string, params: unknown[]): number {
    const id = this.nextId++;
    this.ws?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return id;
  }

  private handle(raw: string) {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw) as WsMessage;
    } catch {
      return;
    }

    if (msg.method === 'accountNotification' && msg.params) {
      const address = this.bySubId.get(msg.params.subscription);
      const value = msg.params.result.value;
      if (address && value) this.subs.get(address)?.listener(Buffer.from(value.data[0], 'base64'), msg.params.result.context.slot);
      return;
    }

    if (msg.id === undefined) return;
    const address = this.pending.get(msg.id);
    if (address === undefined) return;
    this.pending.delete(msg.id);
    if (typeof msg.result !== 'number') return;

    const sub = this.subs.get(address);
    // Sudah di-unsubscribe sebelum server membalas.
    if (!sub) {
      this.send('accountUnsubscribe', [msg.result]);
      return;
    }
    sub.subId = msg.result;
    this.bySubId.set(msg.result, address);
  }
}

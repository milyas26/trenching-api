import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PricesService } from './prices.service.ts';
import type { PriceEvent } from './prices.interfaces.ts';

/** Komentar SSE berkala supaya proxy tidak memutus koneksi yang sepi. */
const KEEPALIVE_MS = 15_000;

export class PricesController {
  constructor(private readonly prices: PricesService) {}

  stream = (req: FastifyRequest, reply: FastifyReply) => {
    // hijack melewati serializer Fastify; header CORS dari plugin tetap ikut lewat getHeaders().
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: PriceEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.type === 'price' ? event.tick : { id: event.id })}\n\n`);
    };

    for (const tick of this.prices.snapshot()) send({ type: 'price', tick });
    const unsubscribe = this.prices.subscribe(send);
    const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), KEEPALIVE_MS);

    req.raw.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  };
}

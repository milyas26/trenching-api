import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);

export function errorHandler(err: FastifyError | Error, _req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return reply.status(400).send({ error: message });
  }
  if (err instanceof AppError) return reply.status(err.statusCode).send({ error: err.message });

  const status = 'statusCode' in err && err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  if (status === 500) reply.log.error(err);
  return reply.status(status).send({ error: err.message });
}

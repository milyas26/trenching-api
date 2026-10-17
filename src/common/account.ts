import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest } from './errors.ts';

const accountHeader = z.coerce.number().int().positive();

/** Akun yang sedang dipakai app, dikirim lewat header X-Account-Id di setiap request. */
export function accountIdOf(req: FastifyRequest): number {
  const raw = req.headers['x-account-id'];
  const parsed = accountHeader.safeParse(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed.success) throw badRequest('Header X-Account-Id wajib berisi id akun');
  return parsed.data;
}

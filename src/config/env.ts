import path from 'node:path';
import dotenv from 'dotenv';

/** Root folder api/ (semua path dan .env relatif ke sini, tidak bergantung folder lain). */
export const API_DIR = path.resolve(import.meta.dirname, '../..');

dotenv.config({ path: path.join(API_DIR, '.env'), quiet: true });

/** CORS_ORIGIN: daftar origin dipisah koma. Kosong = izinkan semua (cocok untuk dev). */
function parseOrigins(value: string | undefined): string[] | true {
  const list = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : true;
}

export const env = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: parseOrigins(process.env.CORS_ORIGIN),
  databaseUrl: process.env.DATABASE_URL ?? `postgresql://${process.env.USER}@localhost:5432/micin-agent`,
  pythonBin: process.env.PYTHON_BIN ?? 'python3',
  gmgnScript: process.env.GMGN_SCRIPT ?? path.join(API_DIR, 'scripts', 'gmgn_hot_searches.py'),
  pumpportalApiKey: process.env.PUMPPORTAL_API_KEY ?? '',
  walletPublicKey: process.env.WALLET_PUBLIC_KEY ?? '',
} as const;

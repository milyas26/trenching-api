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

const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
/** Boleh lebih dari satu endpoint dipisah koma; dicoba berurutan kalau yang sebelumnya mati/rate limit. */
const solanaRpcUrls = (process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (solanaRpcUrls.length === 0) solanaRpcUrls.push(DEFAULT_SOLANA_RPC);
const solanaRpcUrl = solanaRpcUrls[0] ?? DEFAULT_SOLANA_RPC;

export const env = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: parseOrigins(process.env.CORS_ORIGIN),
  databaseUrl: process.env.DATABASE_URL ?? `postgresql://${process.env.USER}@localhost:5432/micin-agent`,
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 5),
  pythonBin: process.env.PYTHON_BIN ?? 'python3',
  gmgnScript: process.env.GMGN_SCRIPT ?? path.join(API_DIR, 'scripts', 'gmgn_hot_searches.py'),
  gmgnTrendingScript: process.env.GMGN_TRENDING_SCRIPT ?? path.join(API_DIR, 'scripts', 'gmgn_trending.py'),
  pumpportalApiKey: process.env.PUMPPORTAL_API_KEY ?? '',
  walletPublicKey: process.env.WALLET_PUBLIC_KEY ?? '',
  solanaRpcUrl,
  solanaRpcUrls,
  /** Default: URL RPC dengan skema http(s) diganti ws(s), sama seperti konvensi provider RPC umumnya. */
  solanaWsUrl: process.env.SOLANA_WS_URL ?? solanaRpcUrl.replace(/^http/, 'ws'),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
} as const;

import { createHash } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]));

export function base58Decode(value: string): Buffer {
  let n = 0n;
  for (const c of value) {
    const digit = INDEX.get(c);
    if (digit === undefined) throw new Error(`Base58 tidak valid: ${value}`);
    n = n * 58n + digit;
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  const zeros = value.length - value.replace(/^1+/, '').length;
  return Buffer.from([...new Array(zeros).fill(0), ...bytes]);
}

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET.charAt(Number(n % 58n)) + out;
    n /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + out;
}

export function isPubkey(value: string): boolean {
  try {
    return base58Decode(value).length === 32;
  } catch {
    return false;
  }
}

/** Pubkey 32 byte di offset tertentu dari data akun. */
export function readPubkey(data: Buffer, offset: number): string {
  return base58Encode(data.subarray(offset, offset + 32));
}

// Ed25519: p = 2^255 - 19, d = -121665/121666 mod p.
const P = 2n ** 255n - 19n;

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  base %= P;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % P;
    base = (base * base) % P;
    exp >>= 1n;
  }
  return result;
}

const D = (((-121665n * modPow(121666n, P - 2n)) % P) + P) % P;

/**
 * PDA harus berada di luar kurva ed25519. Titik valid jika y < p dan
 * x^2 = (y^2 - 1) / (d*y^2 + 1) punya akar kuadrat (kriteria Euler).
 */
function isOnCurve(bytes: Buffer): boolean {
  const le = Buffer.from(bytes);
  le.writeUInt8(le.readUInt8(31) & 0x7f, 31);
  const y = BigInt('0x' + Buffer.from(le).reverse().toString('hex'));
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const x2 = (u * modPow(v, P - 2n)) % P;
  return x2 === 0n || modPow(x2, (P - 1n) / 2n) === 1n;
}

/** Sama dengan PublicKey.findProgramAddressSync dari @solana/web3.js. */
export function findProgramAddress(seeds: Buffer[], programId: string): string {
  const program = base58Decode(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash('sha256')
      .update(Buffer.concat([...seeds, Buffer.from([bump]), program, Buffer.from('ProgramDerivedAddress')]))
      .digest();
    if (!isOnCurve(hash)) return base58Encode(hash);
  }
  throw new Error('PDA tidak ditemukan');
}

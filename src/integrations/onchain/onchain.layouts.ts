import { base58Decode, findProgramAddress, readPubkey } from '../solana/pubkey.ts';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
/** Pyth push feed SOL/USD (shard 0), di-update terus oleh Pyth. */
export const PYTH_SOL_USD = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE';

export const SOL_DECIMALS = 9;

export function bondingCurveAddress(mint: string): string {
  return findProgramAddress([Buffer.from('bonding-curve'), base58Decode(mint)], PUMP_PROGRAM);
}

/**
 * Pool PumpSwap kanonik hasil migrasi pump.fun: creator = PDA pool-authority, index 0, quote = quote curve-nya
 * (WSOL untuk curve biasa, mis. PSOL untuk curve yang di-quote token lain).
 */
export function pumpSwapPoolAddress(mint: string, quoteMint = WSOL_MINT): string {
  const authority = findProgramAddress([Buffer.from('pool-authority'), base58Decode(mint)], PUMP_PROGRAM);
  return findProgramAddress(
    [Buffer.from('pool'), Buffer.alloc(2), base58Decode(authority), base58Decode(mint), base58Decode(quoteMint)],
    PUMP_AMM_PROGRAM,
  );
}

/** Mint SPL Token / Token-2022: supply u64 @36, decimals u8 @44. */
export function decodeMint(data: Buffer) {
  return { supply: data.readBigUInt64LE(36), decimals: data.readUInt8(44) };
}

/** Token account SPL Token / Token-2022: amount u64 @64. */
export function decodeTokenAmount(data: Buffer): bigint {
  return data.readBigUInt64LE(64);
}

/**
 * BondingCurve pump.fun: discriminator 8 byte, lalu virtual token/quote reserves, ..., complete @48, creator @49.
 * Quote mint @83: nol berarti SOL; curve baru bisa di-quote token lain (mis. PUMP) dan reserve-nya dalam token itu.
 */
export function decodeBondingCurve(data: Buffer) {
  const quote = data.length >= 115 ? data.subarray(83, 115) : null;
  return {
    virtualTokenReserves: data.readBigUInt64LE(8),
    virtualSolReserves: data.readBigUInt64LE(16),
    complete: data.readUInt8(48) === 1,
    quotedInSol: !quote || quote.every((b) => b === 0),
    quoteMint: !quote || quote.every((b) => b === 0) ? WSOL_MINT : readPubkey(data, 83),
  };
}

/** Pool PumpSwap: bump u8, index u16, creator, lalu base_mint @43, quote_mint @75, lp_mint, vault base @139, vault quote @171. */
export function decodePumpSwapPool(data: Buffer) {
  return {
    baseMint: readPubkey(data, 43),
    quoteMint: readPubkey(data, 75),
    baseVault: readPubkey(data, 139),
    quoteVault: readPubkey(data, 171),
  };
}

/**
 * Virtual quote reserve i64 @245 (setelah coin_creator @211 dan dua flag bool).
 * Swap PumpSwap memakai (saldo vault quote + nilai ini) sebagai reserve SOL; tanpa ini harga
 * spot meleset puluhan persen di pool kecil. Offset diverifikasi dari event Buy/Sell on-chain.
 * Signed: nilainya bisa negatif. Dibaca sebagai u64, -5,9 SOL jadi ~1,8e19 lamport dan harga
 * meledak jutaan kali lipat (kasus rebond 7Tr69P...pump, MC terbaca $14.735 miliar).
 */
export function decodePumpSwapVirtualQuote(data: Buffer): bigint {
  return data.length >= 253 ? data.readBigInt64LE(245) : 0n;
}

/**
 * Batas atas market cap yang masih mungkin untuk token pump.fun. Quote di atas ini pasti hasil
 * baca akun yang salah, jadi dibuang (polling lalu jatuh ke Dexscreener).
 */
export const MAX_SANE_MC_USD = 10_000_000_000;

/**
 * PriceUpdateV2 Pyth: discriminator 8, write_authority 32, verification_level
 * (Partial = 2 byte, Full = 1 byte), lalu feed_id 32, price i64, conf u64, exponent i32, publish_time i64.
 */
export function decodePythPrice(data: Buffer) {
  const msg = data.readUInt8(40) === 0 ? 42 : 41;
  const price = data.readBigInt64LE(msg + 32);
  const exponent = data.readInt32LE(msg + 48);
  const publishTime = Number(data.readBigInt64LE(msg + 52));
  return { price: Number(price) * 10 ** exponent, publishTime };
}

/** Harga spot dalam token quote (default SOL) per 1 token, sudah memperhitungkan desimal keduanya. */
export function spotPriceSol(
  solReserve: bigint, tokenReserve: bigint, tokenDecimals: number, quoteDecimals = SOL_DECIMALS,
): number | null {
  if (solReserve <= 0n || tokenReserve <= 0n) return null;
  return (Number(solReserve) / 10 ** quoteDecimals) / (Number(tokenReserve) / 10 ** tokenDecimals);
}

-- Harga terendah selama posisi open.
ALTER TABLE "positions" ADD COLUMN "low_price" DOUBLE PRECISION;

-- Posisi yang masih berjalan mulai dilacak dari harga terendah yang tercatat; posisi lama tidak punya riwayat harga, jadi tetap null.
UPDATE "positions"
SET "low_price" = LEAST("entry_price", "current_price")
WHERE "status" IN ('open', 'closing') AND "entry_price" IS NOT NULL;

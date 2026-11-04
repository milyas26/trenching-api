-- Semua posisi baru paper; token yang cocok syarat buy real juga dibeli di wallet asli, dicatat di posisi paper yang sama.
CREATE TYPE "RealLegStatus" AS ENUM ('open', 'closed', 'failed');

ALTER TABLE "positions"
  ADD COLUMN "real_status" "RealLegStatus",
  ADD COLUMN "real_amount_sol" DOUBLE PRECISION,
  ADD COLUMN "real_buy_signature" TEXT,
  ADD COLUMN "real_sell_signature" TEXT,
  ADD COLUMN "real_pnl_sol" DOUBLE PRECISION,
  ADD COLUMN "real_error" TEXT;

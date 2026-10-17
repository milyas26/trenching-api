-- CreateEnum
CREATE TYPE "SnapshotDecision" AS ENUM ('buy', 'skip', 'error', 'no_ai');

-- CreateTable
CREATE TABLE "token_snapshots" (
    "id" SERIAL NOT NULL,
    "mode" "TradeMode" NOT NULL,
    "mint" TEXT NOT NULL,
    "symbol" TEXT,
    "decision" "SnapshotDecision" NOT NULL,
    "confidence" INTEGER,
    "reason" TEXT,
    "recheck_gain_pct" DOUBLE PRECISION,
    "gmgn" JSONB NOT NULL,
    "market" JSONB,
    "chart" JSONB,
    "price_samples" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_snapshots_mint_idx" ON "token_snapshots"("mint");

-- CreateIndex
CREATE INDEX "token_snapshots_created_at_idx" ON "token_snapshots"("created_at");

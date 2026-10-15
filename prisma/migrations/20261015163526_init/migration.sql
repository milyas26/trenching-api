-- CreateEnum
CREATE TYPE "TradeMode" AS ENUM ('paper', 'real');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('opening', 'open', 'closing', 'closed', 'failed');

-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('take_profit', 'stop_loss', 'trailing_stop', 'max_hold', 'manual');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('info', 'warn', 'error', 'buy', 'sell');

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" SERIAL NOT NULL,
    "mode" "TradeMode" NOT NULL,
    "mint" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "logo" TEXT,
    "status" "PositionStatus" NOT NULL,
    "amount_sol" DOUBLE PRECISION NOT NULL,
    "entry_price" DOUBLE PRECISION,
    "entry_mc" DOUBLE PRECISION,
    "current_price" DOUBLE PRECISION,
    "high_price" DOUBLE PRECISION,
    "pnl_pct" DOUBLE PRECISION,
    "exit_price" DOUBLE PRECISION,
    "exit_reason" "ExitReason",
    "pnl_sol" DOUBLE PRECISION,
    "buy_signature" TEXT,
    "sell_signature" TEXT,
    "sell_attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "price_updated_at" TIMESTAMP(3),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" BIGSERIAL NOT NULL,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "positions_status_idx" ON "positions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "positions_mode_mint_key" ON "positions"("mode", "mint");

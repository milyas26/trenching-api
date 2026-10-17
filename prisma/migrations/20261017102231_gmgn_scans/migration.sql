-- CreateTable
CREATE TABLE "gmgn_scans" (
    "id" SERIAL NOT NULL,
    "filter" JSONB NOT NULL,
    "response" JSONB NOT NULL,
    "token_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmgn_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmgn_tokens" (
    "id" SERIAL NOT NULL,
    "scan_id" INTEGER NOT NULL,
    "mint" TEXT NOT NULL,
    "symbol" TEXT,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmgn_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gmgn_scans_created_at_idx" ON "gmgn_scans"("created_at");

-- CreateIndex
CREATE INDEX "gmgn_tokens_mint_idx" ON "gmgn_tokens"("mint");

-- CreateIndex
CREATE INDEX "gmgn_tokens_scan_id_idx" ON "gmgn_tokens"("scan_id");

-- AddForeignKey
ALTER TABLE "gmgn_tokens" ADD CONSTRAINT "gmgn_tokens_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "gmgn_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

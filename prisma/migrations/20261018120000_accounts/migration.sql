-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "pumpportal_api_key" TEXT,
    "wallet_public_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- Pengaturan lama (satu baris) menjadi akun pertama; semua data lama milik akun ini.
INSERT INTO "accounts" ("id", "name", "settings", "updated_at")
SELECT 1, 'Akun 1', "data", "updated_at" FROM "settings" WHERE "id" = 1;
INSERT INTO "accounts" ("id", "name", "settings", "updated_at")
SELECT 1, 'Akun 1', '{}'::jsonb, CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "accounts");
SELECT setval(pg_get_serial_sequence('accounts', 'id'), (SELECT MAX("id") FROM "accounts"));

-- DropTable
DROP TABLE "settings";

-- DropIndex
DROP INDEX "positions_mode_mint_key";

-- AlterTable
ALTER TABLE "gmgn_scans" ADD COLUMN "account_id" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'hot_searches';
ALTER TABLE "gmgn_scans" ALTER COLUMN "account_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "logs" ADD COLUMN "account_id" INTEGER;
UPDATE "logs" SET "account_id" = 1;

-- AlterTable
ALTER TABLE "positions" ADD COLUMN "account_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "positions" ALTER COLUMN "account_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "token_snapshots" ADD COLUMN "account_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "token_snapshots" ALTER COLUMN "account_id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "gmgn_scans_account_id_idx" ON "gmgn_scans"("account_id");

-- CreateIndex
CREATE INDEX "logs_account_id_idx" ON "logs"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_account_id_mode_mint_key" ON "positions"("account_id", "mode", "mint");

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_snapshots" ADD CONSTRAINT "token_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmgn_scans" ADD CONSTRAINT "gmgn_scans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

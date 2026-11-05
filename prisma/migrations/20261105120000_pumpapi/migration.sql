-- PumpPortal diganti PumpAPI. Nilai lama dipertahankan supaya akun yang punya wallet sendiri tidak
-- jatuh ke wallet api/.env; key PumpPortal tidak berlaku di PumpAPI, jadi order real gagal sampai diganti.
ALTER TABLE "accounts" RENAME COLUMN "pumpportal_api_key" TO "pumpapi_api_key";

-- Setting pool PumpPortal tidak dipakai lagi (diganti quoteRoute, default auto).
UPDATE "accounts" SET "settings" = "settings" - 'pool' WHERE "settings" ? 'pool';

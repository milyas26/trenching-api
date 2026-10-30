-- Dipakai RetentionScheduler untuk menghapus token GMGN lama yang tidak pernah dibeli.
CREATE INDEX "gmgn_tokens_created_at_idx" ON "gmgn_tokens"("created_at");

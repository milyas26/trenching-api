-- AlterTable
ALTER TABLE "positions" ADD COLUMN "token_info" JSONB;

-- Isi posisi lama dari data GMGN yang disimpan saat keputusan buy (token_snapshots).
-- Pemetaan sama dengan toHotToken() di gmgn.client.ts: rasio 0-1 jadi persen 2 desimal.
UPDATE "positions" p
SET "token_info" = jsonb_build_object(
  'top10Pct', round((s.g->>'t10')::numeric * 100, 2),
  'devHoldPct', round((s.g->>'dhr')::numeric * 100, 2),
  'devSold', CASE WHEN coalesce(s.g->>'d_ts', '') = '' THEN NULL ELSE s.g->>'d_ts' = 'creator_close' END,
  'insiderPct', round((s.g->>'rat')::numeric * 100, 2),
  'bundlerPct', round((s.g->>'bdrr')::numeric * 100, 2),
  'phishingPct', round((s.g->>'etpr')::numeric * 100, 2),
  'sniperPct', round((s.g->>'t70_shr')::numeric * 100, 2),
  'dexPaid', CASE WHEN s.g ? 'dx_ul' THEN (s.g->>'dx_ul')::numeric > 0 END,
  'communityTakeover', CASE WHEN s.g ? 'cto' THEN (s.g->>'cto')::numeric = 1 END,
  'botDegenCount', (s.g->>'bdc')::numeric,
  'botDegenPct', round((s.g->>'bdr')::numeric * 100, 2)
)
FROM (
  -- Snapshot terakhir sebelum (atau sesaat setelah) posisi dibuka.
  SELECT DISTINCT ON (pos.id) pos.id AS position_id, ts.gmgn AS g
  FROM "positions" pos
  JOIN "token_snapshots" ts
    ON ts.account_id = pos.account_id AND ts.mode = pos.mode AND ts.mint = pos.mint
  ORDER BY pos.id, (ts.created_at <= pos.opened_at + interval '5 minutes') DESC, ts.created_at DESC
) s
WHERE p.id = s.position_id;

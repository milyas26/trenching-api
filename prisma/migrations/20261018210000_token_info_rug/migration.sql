-- Tambah rugPct ("Rug %" di gmgn.ai, field mentah rug 0-1) ke token_info posisi lama.
UPDATE "positions" p
SET "token_info" = p."token_info" || jsonb_build_object('rugPct', round((s.g->>'rug')::numeric * 100, 2))
FROM (
  SELECT DISTINCT ON (pos.id) pos.id AS position_id, ts.gmgn AS g
  FROM "positions" pos
  JOIN "token_snapshots" ts
    ON ts.account_id = pos.account_id AND ts.mode = pos.mode AND ts.mint = pos.mint
  ORDER BY pos.id, (ts.created_at <= pos.opened_at + interval '5 minutes') DESC, ts.created_at DESC
) s
WHERE p.id = s.position_id
  AND p."token_info" IS NOT NULL;

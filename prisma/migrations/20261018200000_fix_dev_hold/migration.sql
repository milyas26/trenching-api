-- Dev hold diambil dari field GMGN d_br (kolom DEV di gmgn.ai), bukan dhr.
-- dhr ternyata hampir sama dengan t70_shr (sniper) dan tetap besar walau dev sudah jual.
UPDATE "positions" p
SET "token_info" = jsonb_set(p."token_info", '{devHoldPct}', to_jsonb(round((s.g->>'d_br')::numeric * 100, 2)))
FROM (
  SELECT DISTINCT ON (pos.id) pos.id AS position_id, ts.gmgn AS g
  FROM "positions" pos
  JOIN "token_snapshots" ts
    ON ts.account_id = pos.account_id AND ts.mode = pos.mode AND ts.mint = pos.mint
  ORDER BY pos.id, (ts.created_at <= pos.opened_at + interval '5 minutes') DESC, ts.created_at DESC
) s
WHERE p.id = s.position_id
  AND p."token_info" IS NOT NULL
  AND s.g ? 'd_br';

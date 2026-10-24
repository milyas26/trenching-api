-- Isi change1hPct (perubahan harga 1 jam, field mentah GMGN `pcp1h`) ke token_info posisi lama.
-- Dipakai filter "Naik 1 jam max" saat scan, filter riwayat, dan chip di kartu posisi.
--
-- Sumber: token_snapshots.gmgn, snapshot yang paling dekat dengan waktu posisi dibuka
-- (maksimal 5 menit setelah buy, kalau tidak ada ambil yang terbaru). Posisi tanpa snapshot
-- atau tanpa pcp1h dibiarkan kosong dan tidak ikut tersaring saat filter diisi.
UPDATE "positions" p
SET "token_info" = p."token_info" || jsonb_build_object('change1hPct', round((s.g->>'pcp1h')::numeric, 2))
FROM (
  SELECT DISTINCT ON (pos.id) pos.id AS position_id, ts.gmgn AS g
  FROM "positions" pos
  JOIN "token_snapshots" ts
    ON ts.account_id = pos.account_id AND ts.mode = pos.mode AND ts.mint = pos.mint
  ORDER BY pos.id, (ts.created_at <= pos.opened_at + interval '5 minutes') DESC, ts.created_at DESC
) s
WHERE p.id = s.position_id
  AND p."token_info" IS NOT NULL
  AND NOT (p."token_info" ? 'change1hPct')
  AND jsonb_typeof(s.g->'pcp1h') = 'number';

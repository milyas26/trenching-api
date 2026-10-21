-- Isi token_info.createdAt (unix detik) untuk posisi lama dari field `ct` GMGN di token_snapshots.
-- Posisi baru sudah menyimpannya saat buy. Aman dijalankan berulang: hanya mengisi yang belum punya.
begin;

with created as (
  select distinct on (mint) mint, (gmgn->>'ct')::numeric::bigint as ct
  from token_snapshots
  -- ct bisa tersimpan sebagai angka atau string angka.
  where gmgn->>'ct' ~ '^[0-9]+(\.0+)?$'
  order by mint, created_at
)
update positions p
set token_info = p.token_info || jsonb_build_object('createdAt', c.ct)
from created c
where c.mint = p.mint
  and p.token_info is not null
  and not p.token_info ? 'createdAt';

-- Cek hasil sebelum commit: umur token saat dibeli, dalam menit.
select p.id, p.symbol, round((extract(epoch from p.opened_at) - (p.token_info->>'createdAt')::bigint) / 60) as umur_mnt
from positions p
where p.token_info ? 'createdAt'
order by p.opened_at desc
limit 20;

commit;

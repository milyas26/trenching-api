-- Isi data transaksi buy/sell 1 jam untuk posisi lama.
--
-- Sumber utama: token_snapshots.market.txns.h1 dari snapshot buy (DexScreener saat entry).
-- Fallback: token_snapshots.gmgn.bu/se dari snapshot no_ai (GMGN 1 jam saat entry), untuk database
-- lama yang belum punya snapshot buy ber-market.
--
-- Aman dijalankan berulang: hanya mengisi field yang belum punya nilai.
begin;

-- 1. DexScreener: posisi yang punya snapshot buy dengan data market h1.
with snapshots as (
  select distinct on (account_id, mode, mint)
    account_id,
    mode,
    mint,
    (market->'txns'->'h1'->>'buys')::int as buys,
    (market->'txns'->'h1'->>'sells')::int as sells
  from token_snapshots
  where decision = 'buy'
    and market->'txns'->'h1'->>'buys' is not null
    and market->'txns'->'h1'->>'sells' is not null
  order by account_id, mode, mint, created_at desc
)
update positions p
set token_info = coalesce(p.token_info, '{}'::jsonb) || jsonb_build_object(
  'dexTxns1h', jsonb_build_object('buys', s.buys, 'sells', s.sells)
)
from snapshots s
where s.account_id = p.account_id
  and s.mode = p.mode
  and s.mint = p.mint
  and (
    p.token_info is null
    or not p.token_info ? 'dexTxns1h'
    or p.token_info->'dexTxns1h' = 'null'::jsonb
  );

-- 2. GMGN fallback: posisi lama tanpa DexScreener, ambil bu/se dari snapshot no_ai.
with snapshots as (
  select distinct on (account_id, mode, mint)
    account_id,
    mode,
    mint,
    (gmgn->>'bu')::int as buys,
    (gmgn->>'se')::int as sells
  from token_snapshots
  where decision = 'no_ai'
    and gmgn->>'bu' ~ '^[0-9]+$'
    and gmgn->>'se' ~ '^[0-9]+$'
  order by account_id, mode, mint, created_at desc
)
update positions p
set token_info = coalesce(p.token_info, '{}'::jsonb) || jsonb_build_object(
  'gmgnTxns1h', jsonb_build_object('buys', s.buys, 'sells', s.sells)
)
from snapshots s
where s.account_id = p.account_id
  and s.mode = p.mode
  and s.mint = p.mint
  and (
    p.token_info->'dexTxns1h' is null
    or p.token_info->'dexTxns1h' = 'null'::jsonb
  )
  and (
    p.token_info is null
    or not p.token_info ? 'gmgnTxns1h'
    or p.token_info->'gmgnTxns1h' = 'null'::jsonb
  );

-- Verifikasi: berapa posisi yang sudah punya data DexScreener / GMGN.
select
  count(*) as total_positions,
  count(*) filter (where p.token_info->'dexTxns1h' is not null) as dex_filled,
  count(*) filter (where p.token_info->'gmgnTxns1h' is not null) as gmgn_filled,
  count(*) filter (where p.token_info is null) as token_info_null
from positions p;

-- Cek hasil: rasio memakai DexScreener kalau ada, lalu fallback GMGN.
select
  p.id,
  p.account_id,
  p.symbol,
  p.mode,
  p.pnl_pct,
  p.exit_reason,
  case
    when p.token_info->'dexTxns1h' is not null then 'dexscreener'
    else 'gmgn'
  end as source,
  coalesce(nullif(p.token_info->'dexTxns1h', 'null'::jsonb), p.token_info->'gmgnTxns1h')->>'buys' as buys_h1,
  coalesce(nullif(p.token_info->'dexTxns1h', 'null'::jsonb), p.token_info->'gmgnTxns1h')->>'sells' as sells_h1,
  round(
    (coalesce(nullif(p.token_info->'dexTxns1h', 'null'::jsonb), p.token_info->'gmgnTxns1h')->>'buys')::numeric
    / nullif((coalesce(nullif(p.token_info->'dexTxns1h', 'null'::jsonb), p.token_info->'gmgnTxns1h')->>'sells')::numeric, 0),
    2
  ) as ratio
from positions p
where coalesce(nullif(p.token_info->'dexTxns1h', 'null'::jsonb), p.token_info->'gmgnTxns1h') is not null
order by p.opened_at desc
limit 20;

commit;

#!/usr/bin/env python3
import argparse
import csv
import json
import sys
import time

try:
    from curl_cffi import requests as creq
except ImportError:
    sys.exit("curl_cffi belum terpasang. Jalankan: pip install curl-cffi")

API = "https://gmgn.ai/rrs/api/v1/trending_multichain"

CLIENT_ID = "gmgn_web_20261017-5594-69ec31fe"
APP_VER = "20261017-5594-69ec31fe"
DEVICE_ID = "ea1c3a56-4232-4c01-aaf9-1f3e7ff704d9"
FP_DID = "37a1c870769ace5cb32b2771952cd2ed"
TAB_ID = "mvcnappsps3i"

PLATFORMS = [
    "Pump.fun", "pump_mayhem", "letsbonk", "bonkers", "bags_v2", "bags",
    "stonkfun", "stonkfun_cc", "hookedpad", "hookd", "tren_ch", "virtuals",
    "stoxes", "kickstart", "orynth", "swarms", "memoo", "liquid", "bankr",
    "zora", "surge", "anoncoin", "moonshot_app", "wendotdev", "heaven",
    "sugar", "token_mill", "believe", "trendsfun", "trends_fun", "jup_studio",
    "Moonshot", "boop", "ray_launchpad", "xstocks", "meteora_virtual_curve",
]


def build_url(args):
    q = {
        "device_id": args.device_id,
        "tab_id": args.tab_id,
        "fp_did": args.fp_did,
        "client_id": args.client_id,
        "from_app": "gmgn",
        "app_ver": args.app_ver,
        "tz_name": args.tz_name,
        "tz_offset": args.tz_offset,
        "app_lang": args.app_lang,
        "os": "web",
        "worker": "0",
    }
    return API + "?" + "&".join(f"{k}={v}" for k, v in q.items())


def build_body(args):
    filters = {
        "filters": args.filters,
        "limit": args.limit,
        "launchpad_platform": args.platform,
    }
    if args.min_created:
        filters["min_created"] = args.min_created
    if args.max_created:
        filters["max_created"] = args.max_created
    if args.min_mcap is not None:
        filters["min_marketcap"] = args.min_mcap
    if args.max_mcap is not None:
        filters["max_marketcap"] = args.max_mcap
    return {
        "meta": {},
        "params": [
            {
                "chain": args.chain,
                "interval": args.interval,
                "filter": filters,
            }
        ],
    }


def headers(args):
    h = {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "origin": "https://gmgn.ai",
        "referer": "https://gmgn.ai/trend?chain=sol&ref=41vyVWuj&tab=trending",
    }
    if args.cookie:
        h["cookie"] = args.cookie
    return h


def fetch_payload(args):
    r = creq.post(
        build_url(args),
        data=json.dumps(build_body(args)),
        headers=headers(args),
        impersonate=args.impersonate,
        timeout=args.timeout,
    )
    if r.status_code == 403:
        sys.exit(
            "403 dari Cloudflare. Pakai --impersonate chrome (default), "
            "atau salin cookie browser lewat --cookie / env GMGN_COOKIE."
        )
    r.raise_for_status()
    payload = r.json()
    if payload.get("code") != 0:
        sys.exit(f"API error: {payload.get('code')} {payload.get('message')}")
    return payload


def fetch(args):
    payload = fetch_payload(args)
    rows = []
    for block in payload.get("data", []):
        for t in block.get("tokens", []):
            rows.append(
                {
                    "symbol": t.get("s"),
                    "name": t.get("nm"),
                    "address": t.get("a"),
                    "age_min": round((time.time() - t.get("ct", 0)) / 60, 1),
                    "mc": t.get("mc"),
                    "liq": t.get("lq"),
                    "vol": t.get("v"),
                    "swaps": t.get("sw"),
                    "buys": t.get("bu"),
                    "sells": t.get("se"),
                    "holders": t.get("hd"),
                    "price": t.get("p"),
                    "chg_5m": t.get("pcp5m"),
                    "chg_1h": t.get("pcp1h"),
                    "launchpad": t.get("lpp"),
                }
            )
    rows.sort(key=lambda x: x["mc"] or 0, reverse=True)
    return rows


def fmt_money(v):
    if v is None:
        return "-"
    for unit, div in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if abs(v) >= div:
            return f"${v / div:.2f}{unit}"
    return f"${v:.2f}"


def fmt_pct(v):
    return "-" if v is None else f"{v:+.2f}%"


def print_table(rows):
    if not rows:
        print("Tidak ada token yang cocok dengan filter.")
        return
    head = ["SYMBOL", "AGE", "MC", "LIQ", "VOL", "SWAPS", "HOLD", "5M"]
    widths = [14, 7, 10, 9, 9, 7, 6, 9]
    print("  ".join(h.ljust(w) for h, w in zip(head, widths)))
    print("  ".join("-" * w for w in widths))
    for r in rows:
        cells = [
            (r["symbol"] or "?")[:14],
            f"{r['age_min']}m",
            fmt_money(r["mc"]),
            fmt_money(r["liq"]),
            fmt_money(r["vol"]),
            str(r["swaps"] or "-"),
            str(r["holders"] or "-"),
            fmt_pct(r["chg_5m"]),
        ]
        print("  ".join(str(c).ljust(w) for c, w in zip(cells, widths)))
    print(f"\n{len(rows)} token")


def main():
    p = argparse.ArgumentParser(description="Ambil token trending GMGN sesuai filter.")
    p.add_argument("--chain", default="sol")
    p.add_argument("--interval", default="5m")
    p.add_argument("--min-created", default="5m")
    p.add_argument("--max-created", default="40m")
    p.add_argument("--min-mcap", type=float, default=20000)
    p.add_argument("--max-mcap", type=float)
    p.add_argument("--limit", type=int, default=500)
    p.add_argument("--filters", nargs="*", default=["frozen"])
    p.add_argument("--platform", nargs="*", default=PLATFORMS)
    p.add_argument("--cookie", default=None, help="cookie header mentah dari browser")
    p.add_argument("--impersonate", default="chrome")
    p.add_argument("--timeout", type=float, default=30)
    p.add_argument("--json", action="store_true", help="cetak JSON mentah hasil olahan")
    p.add_argument("--response", action="store_true", help="cetak seluruh response API apa adanya")
    p.add_argument("--out", help="simpan hasil ke file CSV")
    p.add_argument("--device-id", default=DEVICE_ID)
    p.add_argument("--tab-id", default=TAB_ID)
    p.add_argument("--fp-did", default=FP_DID)
    p.add_argument("--client-id", default=CLIENT_ID)
    p.add_argument("--app-ver", default=APP_VER)
    p.add_argument("--tz-name", default="Asia/Jakarta")
    p.add_argument("--tz-offset", default="25200")
    p.add_argument("--app-lang", default="en-US")
    args = p.parse_args()

    if args.response:
        print(json.dumps(fetch_payload(args), ensure_ascii=False))
        return

    rows = fetch(args)

    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    else:
        print_table(rows)

    if args.out:
        with open(args.out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
            w.writeheader()
            w.writerows(rows)
        print(f"disimpan: {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()

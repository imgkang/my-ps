#!/usr/bin/env python3
"""
Collect KRX ETF distribution (분배금) history → etf_distributions.json.

The pension web app computes "실수령 배당 = 보유수량 × 주당분배금 × (1 − 0.154)".
Holdings quantity is manual (localStorage); the *per-share distribution* is
collected here from the KRX Information Data System (data.krx.co.kr) and
committed as a static JSON the PWA fetches — mirroring scripts/update_tickers.py
→ tickers.json (GitHub Actions cron commits the result).

KRX serves this data from an internal endpoint, not the official OpenAPI:
  POST http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd
  body: bld=<screen id>&<date params>&locale=ko_KR&csvxls_isNo=false
The `bld` identifies the screen ("분배금 내역"). It is NOT a stable public API,
so it must be *captured* from the live site (F12 → Network → getJsonData.cmd)
and confirmed with `--discover` before `--run` can map columns correctly.

Subcommands:
  --discover YYYYMMDD [--bld BLD]
        POST the screen for that date and dump the raw top-level keys + the
        first row's keys/values, so BLD and FIELD_MAP can be pinned to the
        real response. With no --bld/BLD set, probes CANDIDATE_BLDS.
  --run [--days N] [--bld BLD]
        Collect the trailing window (default: this year), map via FIELD_MAP,
        merge into etf_distributions.json keyed by (ticker, record_date).
  --show TICKER
        Print stored records for one ticker from etf_distributions.json.

Once BLD/FIELD_MAP are confirmed, set the BLD constant (or pass --bld / the
KRX_ETF_DIST_BLD env var) so the cron workflow runs unattended.
"""
import argparse
import json
import re
import sys
import os
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone, date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "etf_distributions.json"

KRX_JSON_URL = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
KRX_REFERER = "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
TIMEOUT = 60

# The confirmed screen id. Fill in after --discover pins it down (or pass
# --bld / set env KRX_ETF_DIST_BLD). Left empty on purpose so an unconfigured
# --run fails loudly instead of silently hitting the wrong screen.
BLD = os.environ.get("KRX_ETF_DIST_BLD", "").strip()

# Best-effort candidates to probe with --discover when BLD is unset. These are
# starting guesses for the KRX "분배금 내역"/ETF distribution screens; --discover
# reports which (if any) return rows. Update once the real one is captured.
CANDIDATE_BLDS = [
    "dbms/MDC/STAT/standard/MDCSTAT06901",
    "dbms/MDC/STAT/standard/MDCSTAT05001",
    "dbms/MDC/STAT/standard/MDCSTAT04801",
]

# Maps our internal keys → KRX response column keys. KRX uses codes like
# ISU_SRT_CD / ISU_ABBRV; the date/amount keys vary per screen, so confirm
# each against --discover output before trusting --run. Multiple candidates
# per field are tried in order (first present wins).
FIELD_MAP = {
    "t":   ["ISU_SRT_CD", "SHRT_ISU_CD"],          # short ticker code
    "name": ["ISU_ABBRV", "ISU_NM", "ISU_KOR_ABBRV"],
    "rd":  ["RGHT_STD_DD", "SETL_STD_DD", "STD_DD", "BAS_DD"],  # record date
    "pay": ["PAY_DD", "DIST_PAY_DD", "PAYM_DD"],   # payment date
    "ps":  ["DIST_AMT", "PER_STK_DIST_AMT", "ALOT_AMT", "DVDN_AMT"],  # /share
}

# Request-param templates tried in order during --discover. Distribution-history
# screens key off either a single trade date or a start/end range; we don't yet
# know which, so probe both shapes.
PARAM_TEMPLATES = [
    lambda d1, d2: {"trdDd": d2},
    lambda d1, d2: {"strtDd": d1, "endDd": d2},
    lambda d1, d2: {"strtDd": d1, "endDd": d2, "trdDd": d2},
]

# Sanity floor: a full-year run should surface many distributing ETFs. Below
# this the response is almost certainly partial/blocked — refuse to commit.
THRESHOLD_ROWS = 30


def post_json(bld, params):
    """POST to getJsonData.cmd and return the parsed JSON dict."""
    body = {"bld": bld, "locale": "ko_KR", "csvxls_isNo": "false"}
    body.update(params)
    data = urllib.parse.urlencode(body).encode("utf-8")
    req = urllib.request.Request(
        KRX_JSON_URL,
        data=data,
        headers={
            "User-Agent": UA,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "ko,en;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": KRX_REFERER,
            "Origin": "http://data.krx.co.kr",
        },
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def extract_rows(payload):
    """KRX wraps rows under a screen-specific key (OutBlock_1, output, ...).

    Return the first top-level value that is a list of dicts.
    """
    if not isinstance(payload, dict):
        return []
    for val in payload.values():
        if isinstance(val, list) and val and isinstance(val[0], dict):
            return val
    # Some screens return an empty list under a known key — surface [].
    for val in payload.values():
        if isinstance(val, list):
            return val
    return []


def pick(row, keys):
    """First present, non-empty value among candidate keys."""
    for k in keys:
        if k in row and str(row[k]).strip() not in ("", "-"):
            return str(row[k]).strip()
    return ""


def to_number(s):
    """KRX numbers arrive as strings with thousands separators."""
    s = str(s).replace(",", "").strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def norm_date(s):
    """Normalize 'YYYY/MM/DD' or 'YYYYMMDD' → 'YYYY-MM-DD' (or '' if unknown)."""
    digits = re.sub(r"\D", "", str(s))
    if len(digits) == 8:
        return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}"
    return ""


def map_row(row):
    """Map one KRX row → our record, or None if required fields are missing."""
    t = pick(row, FIELD_MAP["t"]).upper()
    rd = norm_date(pick(row, FIELD_MAP["rd"]))
    ps = to_number(pick(row, FIELD_MAP["ps"]))
    if not t or not rd or ps is None:
        return None
    rec = {"t": t, "rd": rd, "ps": ps, "cur": "KRW"}
    name = pick(row, FIELD_MAP["name"])
    pay = norm_date(pick(row, FIELD_MAP["pay"]))
    if name:
        rec["name"] = name
    if pay:
        rec["pay"] = pay
    return rec


def load_existing():
    if OUTPUT_PATH.exists():
        try:
            data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
            items = data.get("items", [])
            return {(it["t"], it["rd"]): it for it in items if it.get("t") and it.get("rd")}
        except (json.JSONDecodeError, KeyError):
            pass
    return {}


def resolve_bld(cli_bld):
    return (cli_bld or BLD or "").strip()


def cmd_discover(args):
    bld = resolve_bld(args.bld)
    blds = [bld] if bld else CANDIDATE_BLDS
    d2 = re.sub(r"\D", "", args.date)
    if len(d2) != 8:
        print(f"bad date '{args.date}' — expected YYYYMMDD", file=sys.stderr)
        return 2
    d1 = re.sub(r"\D", "", (date(int(d2[:4]), 1, 1)).strftime("%Y%m%d"))

    any_rows = False
    for b in blds:
        print(f"\n=== bld: {b} ===", file=sys.stderr)
        for tmpl in PARAM_TEMPLATES:
            params = tmpl(d1, d2)
            try:
                payload = post_json(b, params)
            except (urllib.error.URLError, urllib.error.HTTPError,
                    json.JSONDecodeError) as e:
                print(f"  params={params}  ERROR: {e}", file=sys.stderr)
                continue
            rows = extract_rows(payload)
            top_keys = list(payload.keys()) if isinstance(payload, dict) else []
            print(f"  params={params}  top_keys={top_keys}  rows={len(rows)}",
                  file=sys.stderr)
            if rows:
                any_rows = True
                print("  first row keys: "
                      + ", ".join(rows[0].keys()), file=sys.stderr)
                print("  first row: "
                      + json.dumps(rows[0], ensure_ascii=False), file=sys.stderr)
                break  # found a working param shape for this bld
    if not any_rows:
        print("\nNo rows from any candidate. Capture the real bld via F12 "
              "(Network → getJsonData.cmd) and pass it with --bld.",
              file=sys.stderr)
        return 1
    print("\nSet BLD (or KRX_ETF_DIST_BLD) and align FIELD_MAP to the keys "
          "above, then run --run.", file=sys.stderr)
    return 0


def cmd_run(args):
    bld = resolve_bld(args.bld)
    if not bld:
        print("BLD not set. Confirm it with --discover, then set the BLD "
              "constant / KRX_ETF_DIST_BLD env / pass --bld.", file=sys.stderr)
        return 2

    end = date.today()
    start = end - timedelta(days=args.days) if args.days else date(end.year, 1, 1)
    d1, d2 = start.strftime("%Y%m%d"), end.strftime("%Y%m%d")

    payload = None
    for tmpl in PARAM_TEMPLATES:
        try:
            payload = post_json(bld, tmpl(d1, d2))
        except (urllib.error.URLError, urllib.error.HTTPError,
                json.JSONDecodeError) as e:
            print(f"request failed: {e}", file=sys.stderr)
            continue
        if extract_rows(payload):
            break
    rows = extract_rows(payload) if payload else []
    mapped = [m for m in (map_row(r) for r in rows) if m]
    print(f"KRX returned {len(rows)} rows → {len(mapped)} usable records "
          f"({d1}~{d2})", file=sys.stderr)

    if len(mapped) < THRESHOLD_ROWS:
        print(f"\nFAIL — only {len(mapped)} records (< {THRESHOLD_ROWS}). "
              "Likely a wrong bld/FIELD_MAP or a block; refusing to write.",
              file=sys.stderr)
        return 2

    merged = load_existing()
    added = 0
    for rec in mapped:
        key = (rec["t"], rec["rd"])
        if key not in merged:
            added += 1
        merged[key] = rec  # upsert — latest wins

    items = sorted(merged.values(), key=lambda x: (x["t"], x["rd"]))
    now = datetime.now(timezone.utc).replace(microsecond=0)
    output = {
        "version": now.strftime("%Y-%m-%d"),
        "updated_at": now.isoformat().replace("+00:00", "Z"),
        "count": len(items),
        "items": items,
    }
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_PATH.name}: {len(items)} records "
          f"(+{added} new, {OUTPUT_PATH.stat().st_size:,} bytes)",
          file=sys.stderr)
    return 0


def cmd_show(args):
    if not OUTPUT_PATH.exists():
        print(f"{OUTPUT_PATH.name} not found — run --run first.", file=sys.stderr)
        return 1
    data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    tkr = args.ticker.upper()
    recs = [it for it in data.get("items", []) if it.get("t") == tkr]
    if not recs:
        print(f"no records for {tkr}", file=sys.stderr)
        return 1
    for r in sorted(recs, key=lambda x: x["rd"]):
        print(json.dumps(r, ensure_ascii=False))
    return 0


def main():
    p = argparse.ArgumentParser(description="KRX ETF distribution collector")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--discover", metavar="YYYYMMDD", dest="date",
                   help="probe the screen for a date and dump raw columns")
    g.add_argument("--run", action="store_true", help="collect & merge JSON")
    g.add_argument("--show", metavar="TICKER", dest="ticker",
                   help="print stored records for one ticker")
    p.add_argument("--bld", default="", help="override the screen id")
    p.add_argument("--days", type=int, default=0,
                   help="trailing window in days (default: since Jan 1)")
    args = p.parse_args()

    if args.date:
        return cmd_discover(args)
    if args.run:
        return cmd_run(args)
    if args.ticker:
        return cmd_show(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())

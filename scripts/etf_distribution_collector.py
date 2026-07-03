#!/usr/bin/env python3
"""
Collect ETF distribution (분배금) history from SEIBRO → etf_distributions.json.

The pension web app computes "실수령 배당 = 보유수량 × 주당분배금 × (1 − 0.154)".
Holdings quantity is manual (localStorage); the *per-share distribution* is
collected here from SEIBRO (한국예탁결제원, seibro.or.kr) — the authoritative
source for ETF distributions — and committed as a static JSON the PWA fetches,
mirroring scripts/update_tickers.py → tickers.json (GitHub Actions cron commits
the result).

Source: SEIBRO 「ETF 권리행사정보 > 분배금지급현황」(screen BIP_CNTS06030V).
  POST https://seibro.or.kr/websquare/engine/proworks/callServletService.jsp
  body: <reqParam action="exerInfoDtramtPayStatPlist"
          task="ksd.safe.bip.cnts.etf.process.EtfExerInfoPTask"> ...filters... </reqParam>
  → <vector><data><result><ISIN value=".."/><ESTM_STDPRC value=".."/>...</result></data></vector>
An empty `isin`/`mngco_custno`/sort filter returns *all* ETFs for the date
range in one call (verified reachable from GitHub runners without login).

KRX was evaluated first but does not publish ETF distributions; a free official
open-API for per-share ETF distribution does not exist, so SEIBRO's internal
WebSquare servlet is used. It can break if SEIBRO changes the screen; re-run
`--raw` to re-confirm the action/fields if parsing ever goes empty.

Subcommands:
  --run [--days N]   Collect the trailing window (default 400 days), map to our
                     schema, merge into etf_distributions.json keyed by
                     (ticker, record_date).
  --show TICKER      Print stored records for one ticker.
  --raw [--days N]   Dump the first raw <result> records (for re-confirming
                     field names when SEIBRO changes).
"""
import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "etf_distributions.json"

SEIBRO_URL = "https://seibro.or.kr/websquare/engine/proworks/callServletService.jsp"
SEIBRO_REFERER = (
    "https://seibro.or.kr/websquare/control.jsp"
    "?w2xPath=/IPORTAL/user/etf/BIP_CNTS06030V.xml&menuNo=179"
)
ACTION = "exerInfoDtramtPayStatPlist"
ACTION_CNT = "exerInfoDtramtPayStatPlistCnt"
TASK = "ksd.safe.bip.cnts.etf.process.EtfExerInfoPTask"

# SEIBRO caps each list response at 30 rows; START_PAGE is the 1-based row
# offset, so page by stepping the offset by PAGE_SIZE. A daily full year is
# ~4.5k rows → ~150 calls.
PAGE_SIZE = 30
MAX_PAGES = 1000  # safety guard (~30k rows)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
TIMEOUT = 60

# SEIBRO response field → our internal key. Confirmed against a live CI call.
F_ISIN = "ISIN"                    # full ISIN, e.g. KR7316300003
F_NAME = "KOR_SECN_NM"             # 종목명
F_RECORD_DT = "RGT_STD_DT"         # 지급기준일  → rd
F_PAY_DT = "TH1_PAY_TERM_BEGIN_DT"  # 실지급일    → pay
F_PER_SHARE = "ESTM_STDPRC"        # 주당분배금(원) → ps
F_RGT_KIND = "RGT_RSN_DTAIL_NM"    # 배당구분(이익분배/청산분배)

# Sanity floor: a full year of ETF distributions across the market is in the
# thousands. Well below this the response is almost certainly partial/blocked —
# refuse to commit so a bad file is not pushed.
THRESHOLD_ROWS = 100


def _filters(d1, d2):
    return (
        '<etf_big_sort_cd value=""/>'
        '<etf_sort_cd value=""/>'
        '<isin value=""/>'
        '<mngco_custno value=""/>'
        '<RGT_RSN_DTAIL_SORT_CD value=""/>'
        f'<fromRGT_STD_DT value="{d1}"/>'
        f'<toRGT_STD_DT value="{d2}"/>'
    )


def _post(body_xml):
    """POST a reqParam XML to SEIBRO, return the raw XML bytes."""
    req = urllib.request.Request(
        SEIBRO_URL,
        data=body_xml.encode("utf-8"),
        headers={
            "User-Agent": UA,
            "Accept": "application/xml, text/xml, */*",
            "Content-Type": "application/xml; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": SEIBRO_REFERER,
            "Origin": "https://seibro.or.kr",
        },
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def fetch_count(d1, d2):
    """Total distribution rows for the window (LIST_CNT), or None on failure."""
    body = (f'<reqParam action="{ACTION_CNT}" task="{TASK}">'
            f'{_filters(d1, d2)}</reqParam>')
    try:
        raw = _post(body)
        m = re.search(r'LIST_CNT value="(\d+)"', raw.decode("utf-8", "replace"))
        return int(m.group(1)) if m else None
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError):
        return None


def fetch_page(d1, d2, start):
    """Fetch one page (<=PAGE_SIZE rows) starting at 1-based row offset."""
    body = (f'<reqParam action="{ACTION}" task="{TASK}">'
            f'<START_PAGE value="{start}"/>'
            f'<END_PAGE value="{start + PAGE_SIZE - 1}"/>'
            f'{_filters(d1, d2)}</reqParam>')
    return parse_rows(_post(body))


def fetch_all(d1, d2):
    """Page through the full result set, return (rows, total_count)."""
    total = fetch_count(d1, d2)
    rows = []
    start = 1
    for _ in range(MAX_PAGES):
        page = fetch_page(d1, d2, start)
        if not page:
            break
        rows.extend(page)
        start += PAGE_SIZE
        if total and len(rows) >= total:
            break
        time.sleep(0.12)  # be polite to SEIBRO
    return rows, total


def parse_rows(raw):
    """Parse the <vector><data><result>...</result> XML into row dicts.

    Each <result> holds children like <ISIN value=".."/>; return a list of
    {tag: value} dicts.
    """
    rows = []
    root = ET.fromstring(raw)
    for result in root.iter("result"):
        row = {}
        for child in result:
            row[child.tag] = (child.get("value") or "").strip()
        if row:
            rows.append(row)
    return rows


def norm_date(s):
    """'YYYYMMDD' or 'YYYY/MM/DD' → 'YYYY-MM-DD' (or '' if unknown)."""
    digits = re.sub(r"\D", "", str(s))
    if len(digits) == 8:
        return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}"
    return ""


def to_number(s):
    s = str(s).replace(",", "").strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def isin_to_ticker(isin):
    """KR ISIN → 6-char KRX short code (chars 3..9). e.g. KR7316300003→316300."""
    isin = (isin or "").strip().upper()
    if len(isin) >= 9 and isin.startswith("KR"):
        return isin[3:9]
    return ""


def map_row(row):
    """SEIBRO row → our record, or None if required fields missing."""
    isin = row.get(F_ISIN, "")
    t = isin_to_ticker(isin)
    rd = norm_date(row.get(F_RECORD_DT, ""))
    ps = to_number(row.get(F_PER_SHARE, ""))
    if not t or not rd or ps is None:
        return None
    rec = {"t": t, "isin": isin, "rd": rd, "ps": ps, "cur": "KRW"}
    name = row.get(F_NAME, "")
    pay = norm_date(row.get(F_PAY_DT, ""))
    kind = row.get(F_RGT_KIND, "")
    if name:
        rec["name"] = name
    if pay:
        rec["pay"] = pay
    if kind:
        rec["kind"] = kind
    return rec


def load_existing():
    if OUTPUT_PATH.exists():
        try:
            data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
            items = data.get("items", [])
            return {(it["t"], it["rd"]): it
                    for it in items if it.get("t") and it.get("rd")}
        except (json.JSONDecodeError, KeyError):
            pass
    return {}


def _window(days):
    end = date.today()
    start = end - timedelta(days=days or 400)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


def cmd_run(args):
    d1, d2 = _window(args.days)
    try:
        rows, total = fetch_all(d1, d2)
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"SEIBRO request failed: {e}", file=sys.stderr)
        return 2
    except ET.ParseError as e:
        print(f"XML parse failed: {e}", file=sys.stderr)
        return 2

    mapped = [m for m in (map_row(r) for r in rows) if m]
    print(f"SEIBRO: total={total} fetched={len(rows)} → {len(mapped)} usable "
          f"({d1}~{d2})", file=sys.stderr)

    if len(mapped) < THRESHOLD_ROWS:
        print(f"\nFAIL — only {len(mapped)} records (< {THRESHOLD_ROWS}). "
              "Likely a changed SEIBRO screen or a block; refusing to write. "
              "Re-run with --raw to re-confirm fields.", file=sys.stderr)
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
        "source": "seibro",
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


def cmd_raw(args):
    d1, d2 = _window(args.days)
    total = fetch_count(d1, d2)
    rows = fetch_page(d1, d2, 1)
    print(f"total={total}  first page rows={len(rows)} ({d1}~{d2})",
          file=sys.stderr)
    for r in rows[:5]:
        print(json.dumps(r, ensure_ascii=False))
    return 0


def main():
    p = argparse.ArgumentParser(description="SEIBRO ETF distribution collector")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--run", action="store_true", help="collect & merge JSON")
    g.add_argument("--show", metavar="TICKER", dest="ticker",
                   help="print stored records for one ticker")
    g.add_argument("--raw", action="store_true",
                   help="dump first raw SEIBRO records (field re-confirm)")
    p.add_argument("--days", type=int, default=0,
                   help="trailing window in days (default 400)")
    args = p.parse_args()

    if args.run:
        return cmd_run(args)
    if args.ticker:
        return cmd_show(args)
    if args.raw:
        return cmd_raw(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())

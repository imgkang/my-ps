#!/usr/bin/env python3
"""
Generate tickers.json: master ticker DB for MyPM/NonK/KDeal client-side search.

Sources:
  - KRX (kind.krx.co.kr): KOSPI + KOSDAQ via corpList.do download endpoint
  - SEC EDGAR (sec.gov): US tickers (CIK + ticker + name)
  - NASDAQ Trader (nasdaqtrader.com): exchange classification (NYSE/NASDAQ/AMEX)
  - scripts/curated_etf.json: hand-curated indices, FX, futures, crypto

Output schema:
  {
    "version": "YYYY-MM-DD",
    "updated_at": "ISO-8601 Z",
    "count": int,
    "items": [
      {"t": ticker, "n": english_name, "k": korean_name (opt),
       "e": exchange, "c": country, "y": type (EQ/ETF/IDX/FUT/CRY/FX)}
    ]
  }

Stdlib only, no third-party deps — keeps the GitHub Actions workflow light.
"""
import json
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATED_PATH = ROOT / "scripts" / "curated_etf.json"
OUTPUT_PATH = ROOT / "tickers.json"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
SEC_UA = "my-ps tickers updater (https://github.com/imgkang/my-ps)"
TIMEOUT = 60


def fetch(url, decode="utf-8", extra_headers=None):
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "ko,en;q=0.8",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = r.read()
    if decode is None:
        return data
    return data.decode(decode, errors="replace")


def parse_krx_html(html):
    """Extract (code, name) from KRX corpList.do HTML table."""
    items = []
    for m in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL | re.IGNORECASE):
        row = m.group(1)
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.DOTALL | re.IGNORECASE)
        if len(cells) < 2:
            continue
        name = re.sub(r"<[^>]+>", "", cells[0]).strip()
        name = re.sub(r"\s+", " ", name)
        code = re.sub(r"<[^>]+>", "", cells[1]).strip()
        if re.fullmatch(r"\d{6}", code) and name:
            items.append((code, name))
    return items


def fetch_krx(market_type):
    """market_type: 'stockMkt' (KOSPI) or 'kosdaqMkt' (KOSDAQ)."""
    url = (
        "https://kind.krx.co.kr/corpgeneral/corpList.do"
        f"?method=download&searchType=13&marketType={market_type}"
    )
    html = fetch(url, decode="euc-kr")
    rows = parse_krx_html(html)
    exchange = "KOSPI" if market_type == "stockMkt" else "KOSDAQ"
    return [
        {"t": code, "k": name, "e": exchange, "c": "KR", "y": "EQ"}
        for code, name in rows
    ]


def fetch_sec_us():
    """SEC EDGAR company_tickers.json → US listed companies."""
    raw = fetch(
        "https://www.sec.gov/files/company_tickers.json",
        extra_headers={"User-Agent": SEC_UA},
    )
    data = json.loads(raw)
    items = []
    for _, row in data.items():
        ticker = str(row.get("ticker", "")).strip().upper()
        name = str(row.get("title", "")).strip()
        if ticker and name and re.fullmatch(r"[A-Z0-9.\-]+", ticker):
            items.append(
                {"t": ticker, "n": name, "e": "US", "c": "US", "y": "EQ"}
            )
    return items


def fetch_nasdaq_exchange_map():
    """nasdaqlisted.txt + otherlisted.txt → {ticker: exchange}."""
    em = {}
    try:
        txt = fetch("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt")
        for line in txt.splitlines()[1:]:
            if line.startswith("File Creation Time"):
                continue
            parts = line.split("|")
            if len(parts) < 2:
                continue
            sym = parts[0].strip().upper()
            if sym:
                em[sym] = "NASDAQ"
    except Exception as e:
        print(f"  ! nasdaqlisted fetch failed: {e}", file=sys.stderr)
    try:
        txt = fetch("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt")
        # Column layout: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|...
        # Exchange codes: A=AMEX, N=NYSE, P=NYSE ARCA, Z=BATS
        ex_map = {"A": "AMEX", "N": "NYSE", "P": "NYSE_ARCA", "Z": "BATS"}
        for line in txt.splitlines()[1:]:
            if line.startswith("File Creation Time"):
                continue
            parts = line.split("|")
            if len(parts) < 3:
                continue
            sym = parts[0].strip().upper()
            ex_code = parts[2].strip().upper()
            if sym:
                em[sym] = ex_map.get(ex_code, "NYSE")
    except Exception as e:
        print(f"  ! otherlisted fetch failed: {e}", file=sys.stderr)
    return em


def load_curated():
    if CURATED_PATH.exists():
        return json.loads(CURATED_PATH.read_text(encoding="utf-8"))
    return []


def main():
    print("Fetching KRX KOSPI ...", file=sys.stderr)
    kospi = fetch_krx("stockMkt")
    print(f"  → {len(kospi)} items", file=sys.stderr)

    print("Fetching KRX KOSDAQ ...", file=sys.stderr)
    kosdaq = fetch_krx("kosdaqMkt")
    print(f"  → {len(kosdaq)} items", file=sys.stderr)

    print("Fetching SEC EDGAR US tickers ...", file=sys.stderr)
    us = fetch_sec_us()
    print(f"  → {len(us)} items", file=sys.stderr)

    print("Fetching NASDAQ Trader exchange map ...", file=sys.stderr)
    ex_map = fetch_nasdaq_exchange_map()
    print(f"  → {len(ex_map)} symbols mapped", file=sys.stderr)

    for item in us:
        item["e"] = ex_map.get(item["t"], item["e"])

    print("Loading curated list ...", file=sys.stderr)
    curated = load_curated()
    print(f"  → {len(curated)} items", file=sys.stderr)

    all_items = kospi + kosdaq + us + curated
    seen = set()
    deduped = []
    for it in all_items:
        key = (it["t"], it.get("c", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(it)

    deduped.sort(key=lambda x: (x.get("c", ""), x["t"]))

    now = datetime.now(timezone.utc).replace(microsecond=0)
    output = {
        "version": now.strftime("%Y-%m-%d"),
        "updated_at": now.isoformat().replace("+00:00", "Z"),
        "count": len(deduped),
        "items": deduped,
    }

    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"\nWritten {OUTPUT_PATH.name} "
        f"({OUTPUT_PATH.stat().st_size:,} bytes, {len(deduped):,} items)",
        file=sys.stderr,
    )
    if len(deduped) < 5000:
        print(
            "  ! WARNING: total items < 5000 — a data source may have failed.",
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Generate tickers.json: master ticker DB for MyPM/NonK/KDeal client-side search.

Sources:
  - FinanceDataReader: KRX listings (KOSPI + KOSDAQ) — single bulk call
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

Per-market minimum-count guards prevent partially-empty data from being
committed: if any source returns suspiciously few rows, the script fails and
GitHub Actions skips the commit.
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

# Per-source sanity thresholds. Below these, abort without committing —
# the data is almost certainly partial (IP block, format change, etc.).
THRESHOLD_KOSPI = 700
THRESHOLD_KOSDAQ = 1200
THRESHOLD_US = 5000


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


def fetch_krx_all():
    """KOSPI + KOSDAQ from FinanceDataReader in one shot.

    Returns (items, counts_per_market). KONEX is excluded (out of scope).
    """
    import FinanceDataReader as fdr  # heavy dep, import lazily

    df = fdr.StockListing("KRX")

    # Column names have shifted across versions; pick whichever exists.
    code_col = "Code" if "Code" in df.columns else (
        "Symbol" if "Symbol" in df.columns else None
    )
    name_col = "Name" if "Name" in df.columns else None
    market_col = "Market" if "Market" in df.columns else None
    if not (code_col and name_col and market_col):
        raise RuntimeError(
            f"FinanceDataReader columns unexpected: {list(df.columns)}"
        )

    items = []
    counts = {"KOSPI": 0, "KOSDAQ": 0}
    for _, row in df.iterrows():
        code = str(row[code_col]).strip()
        name = str(row[name_col]).strip()
        market = str(row[market_col]).strip().upper()
        if not code or not name or not market:
            continue
        # Normalize 6-digit KR codes (pad if needed, reject non-numeric)
        if not code.isdigit() or len(code) > 6:
            continue
        code = code.zfill(6)
        if market not in ("KOSPI", "KOSDAQ"):
            continue
        items.append(
            {"t": code, "k": name, "e": market, "c": "KR", "y": "EQ"}
        )
        counts[market] += 1
    return items, counts


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
    print("Fetching KRX (FinanceDataReader, single call) ...", file=sys.stderr)
    kr_items, kr_counts = fetch_krx_all()
    print(
        f"  → KOSPI: {kr_counts['KOSPI']}, KOSDAQ: {kr_counts['KOSDAQ']}",
        file=sys.stderr,
    )

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

    # Per-source thresholds — fail loudly if any source under-delivered.
    errors = []
    if kr_counts["KOSPI"] < THRESHOLD_KOSPI:
        errors.append(
            f"KOSPI count {kr_counts['KOSPI']} < {THRESHOLD_KOSPI} (expected ~850)"
        )
    if kr_counts["KOSDAQ"] < THRESHOLD_KOSDAQ:
        errors.append(
            f"KOSDAQ count {kr_counts['KOSDAQ']} < {THRESHOLD_KOSDAQ} (expected ~1700)"
        )
    if len(us) < THRESHOLD_US:
        errors.append(
            f"US count {len(us)} < {THRESHOLD_US} (expected ~10,000)"
        )
    if errors:
        print("\nFAIL — per-source sanity thresholds:", file=sys.stderr)
        for e in errors:
            print(f"  ✗ {e}", file=sys.stderr)
        print(
            "Refusing to write tickers.json so a bad commit is not pushed.",
            file=sys.stderr,
        )
        sys.exit(2)

    all_items = kr_items + us + curated
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


if __name__ == "__main__":
    main()

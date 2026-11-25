"""Read-only non-sitewide SKU report, including shopSmart (600000013)."""
import argparse, csv, datetime as dt, io, json, pathlib, sys
from decimal import Decimal, ROUND_HALF_UP
from concurrent.futures import ThreadPoolExecutor
from jzt_fee_probe import access_pin, read_api
from runtime import workbench_root
from report_dates import as_date

METHOD = "jingdong.ads.ibg.UniversalJosService.custom.query.v2"
OVERVIEW = "jingdong.ads.ibg.UniversalJosService.index.trend"
CST = dt.timezone(dt.timedelta(hours=8))
ADDITIVE = ["cost", "impressions", "clicks", "totalOrderCnt", "totalOrderSum", "totalCartCnt",
            "directOrderCnt", "directOrderSum", "directCartCnt",
            "indirectOrderCnt", "indirectOrderSum", "indirectCartCnt"]
METRICS = "cost,impressions,clicks,CTR,CPC,CPM,totalOrderCnt,totalOrderSum,totalCartCnt,orderROI,directOrderCnt,directOrderSum,directCartCnt,indirectOrderCnt,indirectOrderSum,indirectCartCnt"

def unpack(method, response):
    outer = response.get(method.replace(".", "_") + "_responce", {})
    rt = outer.get("returnType", {})
    if str(outer.get("code")) != "0" or rt.get("success") is not True:
        raise RuntimeError(json.dumps(response, ensure_ascii=False))
    return rt["data"], outer.get("request_id")

def query_source(start, end, source):
    legacy = source == "legacy"
    types = ["2", "134217728", "16777216", "256"] if legacy else ["600000013"]
    # A combined old/new filter silently omits shopSmart; keep the calls separate.
    params = {"authType": "0", "accessPin": access_pin(), "startDay": start.isoformat(),
              "endDay": end.isoformat(), "dimensions": "skuDocId" if legacy else "pin,businessType,skuDocId",
              "granularity": 0, "pageSize": 1000, "isDownload": False, "normalMetrics": METRICS,
              "clickOrOrderDay": 15, "clickOrOrderCaliber": 0, "orderStatusCategory": 1, "giftFlag": 0,
              "customFilters": json.dumps([{"column": "businessType", "enumOp": "FO_IN", "values": types}], separators=(",", ":"))}
    rows, ids, expected = [], [], None
    for page in range(1, 11):
        data, request_id = unpack(METHOD, read_api(METHOD, {**params, "page": page}))
        count = int(data["paginator"]["items"])
        if expected is None:
            expected = count
        elif count != expected:
            raise RuntimeError("Source row count changed while paging")
        if count > 10000:
            raise RuntimeError("Use an official asynchronous download above 10,000 rows")
        chunk = data.get("datas", [])
        for row in chunk:
            if row.get("pin") not in [None, access_pin()]:
                raise RuntimeError("Unexpected account")
            if not legacy and str(row.get("businessType")) != "600000013":
                raise RuntimeError("Unexpected shopSmart product line")
            row["skuDocId"] = str(row["skuDocId"])
            if "skuId" in row:
                row["skuId"] = str(row["skuId"])
            for key in ADDITIVE:
                if key not in row or row[key] is None:
                    raise RuntimeError("Missing requested metric: " + key)
        rows.extend(chunk)
        ids.append(request_id)
        if len(rows) >= expected:
            break
        if not chunk:
            raise RuntimeError("Incomplete source pagination")
    if len(rows) != expected or len({r["skuDocId"] for r in rows}) != len(rows):
        raise RuntimeError("Duplicate SKU or incomplete source")
    return {"source": source, "business_types": types, "parameters": params,
            "request_ids": ids, "row_count": len(rows), "rows": rows}

def formatted(value, field):
    return format(value, ".2f") if field in ["cost", "totalOrderSum", "directOrderSum", "indirectOrderSum"] else str(value)

def rate(a, b, scale=1):
    if not b:
        return None
    return format((a / b * scale).quantize(Decimal(".01"), rounding=ROUND_HALF_UP), ".2f")

def collect(start, end):
    if end < start or (end - start).days > 31:
        raise ValueError("Use a date interval of at most 31 days")
    started = dt.datetime.now(CST).isoformat(timespec="seconds")
    with ThreadPoolExecutor(max_workers=2) as pool:
        sources = list(pool.map(lambda kind: query_source(start, end, kind), ["legacy", "shopSmart"]))
    merged = {}
    for source in sources:
        for row in source["rows"]:
            sku = row["skuDocId"]
            target = merged.setdefault(sku, {"skuDocId": sku, "skuName": row.get("skuName", ""),
                                            "components": {}, "_totals": {k: Decimal(0) for k in ADDITIVE}})
            target["components"][source["source"]] = {k: str(row[k]) for k in ADDITIVE}
            for key in ADDITIVE:
                target["_totals"][key] += Decimal(str(row[key]))
    rows = []
    for sku in sorted(merged):
        row = merged[sku]
        values = row.pop("_totals")
        row.update({key: formatted(value, key) for key, value in values.items()})
        row.update({"CTR": rate(values["clicks"], values["impressions"], 100),
                    "CPC": rate(values["cost"], values["clicks"]),
                    "CPM": rate(values["cost"], values["impressions"], 1000),
                    "orderROI": rate(values["totalOrderSum"], values["cost"]),
                    "conversionRatePercent": rate(values["totalOrderCnt"], values["clicks"], 100),
                    "cartRatePercent": rate(values["totalCartCnt"], values["clicks"], 100),
                    "orderCPA": rate(values["cost"], values["totalOrderCnt"])})
        rows.append(row)
    totals = {key: sum(Decimal(row[key]) for row in rows) for key in ADDITIVE}
    overview_params = {"authType": "0", "accessPin": access_pin(),
                       "startDay": start.isoformat(), "endDay": end.isoformat(),
                       "clickOrOrderDay": 15, "clickOrOrderCaliber": 0,
                       "orderStatusCategory": 1, "giftFlag": 0, "businessTypes": "-4,256"}
    overview, overview_id = unpack(OVERVIEW, read_api(OVERVIEW, overview_params))
    checks = {}
    for key in ["cost", "impressions", "clicks"]:
        value = sum(Decimal(str(row[key])) for row in overview["datas"])
        checks[key] = {"sku_total": str(totals[key]), "overview_total": str(value),
                       "difference": str(totals[key] - value), "matched": totals[key] == value}
    source_summary = [{key: source[key] for key in ["source", "business_types", "parameters", "request_ids", "row_count"]}
                      for source in sources]
    for summary, source in zip(source_summary, sources):
        summary["totals"] = {key: formatted(sum(Decimal(str(row[key])) for row in source["rows"]), key) for key in ADDITIVE}
    return {"metadata": {"account": access_pin(), "start_date": start.isoformat(), "end_date": end.isoformat(),
                         "started_at": started, "fetched_at": dt.datetime.now(CST).isoformat(timespec="seconds"),
                         "conversion_window_days": 15, "attribution": "click", "exclude_gifts": True,
                         "order_scope": "completed", "amount_unit": "yuan", "source_method": METHOD,
                         "pagination_complete": True, "merged_sku_count": len(rows),
                         "overview_basic_metrics_matched": all(x["matched"] for x in checks.values()),
                         "order_and_cart_scope_note": "Conversion metrics are actual API values and may differ from the downloaded CSV; do not overwrite the CSV.",
                         "today_note": "Today reflects the API responses at the query times; separate calls are not an atomic snapshot."},
            "sources": source_summary, "overview_request_id": overview_id, "overview_checks": checks,
            "additive_metric_totals": {key: formatted(value, key) for key, value in totals.items()}, "rows": rows}

def compare_csv(result, path):
    data = [row for row in csv.reader(io.StringIO(path.read_text(encoding="utf-8-sig"))) if row]
    header = data[1]
    interval = result["metadata"]["start_date"].replace("-", "") + "~" + result["metadata"]["end_date"].replace("-", "")
    current = data[2][3]
    source = {r[0]: r for r in data[2:] if len(r) == len(header) and r[0].isdigit()
              and r[0] != "0" and r[2] == interval and r[3] == current}
    if not source:
        raise ValueError("No matching current-period CSV rows")
    fetched = {r["skuDocId"]: r for r in result["rows"]}
    fields = [(4, "cost"), (5, "impressions"), (6, "clicks"), (10, "totalOrderCnt"), (11, "totalOrderSum"), (12, "totalCartCnt")]
    checks = {}
    for col, key in fields:
        differences = [{"sku": sku, "csv": row[col], "api": fetched.get(sku, {}).get(key)}
                       for sku, row in source.items() if sku not in fetched or Decimal(row[col]) != Decimal(fetched[sku][key])]
        checks[key] = {"equal_count": len(source) - len(differences), "mismatch_count": len(differences),
                       "csv_total": str(sum(Decimal(r[col]) for r in source.values())),
                       "api_total": result["additive_metric_totals"][key], "differences": differences}
    return {"source_csv": str(path), "csv_sku_count": len(source), "api_sku_count": len(fetched),
            "missing_skus": sorted(set(source) - set(fetched)), "extra_skus": sorted(set(fetched) - set(source)), "checks": checks}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="YYYY-MM-DD / today / yesterday / before-yesterday")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--compare-csv", type=pathlib.Path)
    args = parser.parse_args()
    output_root = workbench_root()
    args.output = args.output.resolve()
    if not args.output.is_relative_to(output_root) or args.output == output_root:
        parser.error('Output must stay inside JD_REPORT_WORKDIR')
    if args.date and (args.start or args.end):
        parser.error("--date cannot be combined with --start/--end")
    if bool(args.start) != bool(args.end):
        parser.error("--start and --end must be supplied together")
    start = as_date(args.start or args.date or "yesterday")
    end = as_date(args.end) if args.end else start
    result = collect(start, end)
    if args.compare_csv:
        result["csv_comparison"] = compare_csv(result, args.compare_csv)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "metadata": result["metadata"],
                      "totals": result["additive_metric_totals"],
                      "source_summary": [{"source": x["source"], "row_count": x["row_count"], "cost": x["totals"]["cost"]} for x in result["sources"]],
                      "overview_checks": result["overview_checks"],
                      "csv_comparison": {k: v for k, v in result.get("csv_comparison", {}).items() if k != "checks"},
                      "csv_metric_matches": {k: {"equal_count": v["equal_count"], "mismatch_count": v["mismatch_count"]}
                                             for k, v in result.get("csv_comparison", {}).get("checks", {}).items()}}, ensure_ascii=False))

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

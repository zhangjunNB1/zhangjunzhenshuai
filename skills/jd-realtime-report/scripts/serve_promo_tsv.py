import json


FIELDS = [
    "cost",
    "impressions",
    "clicks",
    "CTR",
    "CPC",
    "CPM",
    "totalOrderCnt",
    "totalOrderSum",
    "totalCartCnt",
    "conversionRatePercent",
    "cartRatePercent",
    "orderCPA",
    "orderROI",
    "directOrderCnt",
    "directOrderSum",
    "directCartCnt",
    "indirectOrderCnt",
    "indirectOrderSum",
    "indirectCartCnt",
]


def clean(value):
    if value is None:
        return "0"
    return str(value).replace("\t", " ").replace("\r", " ").replace("\n", " ")


def build_tsv(source, minimum_rows=0):
    payload = json.loads(source.read_text(encoding="utf-8"))
    day = payload["metadata"]["start_date"].replace("-", "")
    output = []
    for row in payload["rows"]:
        values = [
            clean(row["skuDocId"]),
            clean(row.get("skuName", "")),
            f"{day}~{day}",
            "当前时间",
        ]
        values.extend(clean(row.get(field)) for field in FIELDS)
        output.append("\t".join(values))
    output.extend("\t" * 22 for _ in range(max(0, minimum_rows - len(output))))
    return "\n".join(output).encode("utf-8")

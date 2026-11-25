import datetime as dt
CST = dt.timezone(dt.timedelta(hours=8))

def as_date(value):
    aliases = {"today": 0, "今天": 0, "yesterday": 1, "昨天": 1,
               "before-yesterday": 2, "前天": 2}
    if value in aliases:
        return dt.datetime.now(CST).date() - dt.timedelta(days=aliases[value])
    return dt.date.fromisoformat(value)

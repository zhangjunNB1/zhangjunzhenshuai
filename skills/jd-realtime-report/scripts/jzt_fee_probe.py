import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

METHODS = {
    "jingdong.ads.ibg.UniversalJosService.custom.query.v2",
    "jingdong.ads.ibg.UniversalJosService.index.trend",
}
SENSITIVE_KEYS = {"app_key", "app_secret", "access_token", "refresh_token", "password", "sign", "authorization", "cookie"}

def access_pin():
    value = os.environ.get("JZT_ACCESS_PIN", "").strip()
    if not value:
        raise RuntimeError("Set JZT_ACCESS_PIN in the local environment")
    return value

def load_account():
    pin = access_pin()
    config_path = os.environ.get("JZT_CONFIG_PATH")
    if config_path:
        config = json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
        account = config.get("accounts", {}).get(pin, config if config.get("access_pin") == pin else {})
    else:
        account = {
            "access_pin": pin, "app_key": os.environ.get("JZT_APP_KEY"),
            "app_secret": os.environ.get("JZT_APP_SECRET"), "access_token": os.environ.get("JZT_ACCESS_TOKEN"),
        }
    if account.get("access_pin") != pin:
        raise RuntimeError("Configured API account mismatch")
    if any(not isinstance(account.get(key), str) or not account[key].strip()
           for key in ("app_key", "app_secret", "access_token")):
        raise RuntimeError("Missing local JD API credentials")
    return account

def redact(value, account):
    if isinstance(value, dict):
        return {key: "[REDACTED]" if key.lower() in SENSITIVE_KEYS else redact(item, account)
                for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, account) for item in value]
    if isinstance(value, str):
        for key in ("app_key", "app_secret", "access_token", "refresh_token"):
            secret = account.get(key)
            if secret:
                value = value.replace(secret, "[REDACTED]")
    return value

def read_api(method, business):
    if method not in METHODS:
        raise RuntimeError("Only the two report API methods are enabled")
    account = load_account()
    if business.get("accessPin") != account["access_pin"]:
        raise RuntimeError("API request account mismatch")
    params = {
        "method": method, "app_key": account["app_key"], "access_token": account["access_token"],
        "timestamp": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S"),
        "format": "json", "v": "2.0",
        "360buy_param_json": json.dumps(business, separators=(",", ":"), ensure_ascii=False),
    }
    signature = account["app_secret"] + "".join(key + str(params[key]) for key in sorted(params)) + account["app_secret"]
    params["sign"] = hashlib.md5(signature.encode("utf-8")).hexdigest().upper()
    request = urllib.request.Request("https://api.jd.com/routerjson",
        data=urllib.parse.urlencode(params).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, ValueError) as error:
        raise RuntimeError("JD report request failed (" + type(error).__name__ + ")") from None
    return redact(result, account)

# 配置与运行

使用 Node.js 20.6 及以上、Python 3.10 及以上、Google Chrome。进入技能目录执行 `npm install` 和 `python -m pip install -r requirements.txt`。优先复用当前环境已经安装的依赖。

将 `settings.example.env` 复制到仓库外的本机目录并填写，示例使用空值。执行命令时传该本机文件的绝对路径。

| 环境变量 | 用途 |
| --- | --- |
| JD_KDOCS_URL | 用户授权的 `https://www.kdocs.cn/l/文档标识` 链接 |
| JD_SHOP_NAME | 商智页面显示的店铺名称，完整模式必填 |
| JD_REPORT_WORKDIR | 快照、回执和日志的输出根目录，默认用户主目录下 `.jd-reports` |
| JD_AUTOMATION_PROFILE | 专用 Chrome 配置目录，包含用户本机登录状态 |
| JD_PYTHON | 已安装 openpyxl 的 Python 可执行文件 |
| JZT_ACCESS_PIN | 本次授权的京准通账号 |
| JZT_CONFIG_PATH | 仓库外的已有凭证 JSON 文件 |
| JZT_APP_KEY / JZT_APP_SECRET / JZT_ACCESS_TOKEN | 未使用凭证文件时从本机环境读取 |

凭证文件支持单账号结构和 `accounts` 映射。单账号包含 `access_pin`、`app_key`、`app_secret` 和 `access_token`。映射结构使用账号作为键。运行时核对所选账号与凭证中的账号。

```powershell
node --env-file="本机配置文件的绝对路径" scripts/run_realtime_update.cjs --scope all
node --env-file="本机配置文件的绝对路径" scripts/run_realtime_update.cjs --scope promo
```

工作表约定为「商智实时」「实时推广费」「SPU投产小时投产」。运行前确认底版已经使用 schema 中的列顺序。商智下载达到 1000 条时检查下载截断问题。推广数据保留分页、账号、字段和基础汇总校验。小额差额须在交付中列明，较大差额需核对覆盖范围。

每轮输出在 `JD_REPORT_WORKDIR/临时/实时投产表运行/日期_时刻`。`回执.jsonl` 记录实际操作，`运行记录.md` 记录来源时间和完成结果。数据包含店铺经营信息，按本机资料保管。

## 恢复

先读失败阶段及回执。如果推广费和查询说明都完成，商智在设置 SKU 格式前发生剪贴板校验失败，可以传当天最新运行目录名。

```powershell
node --env-file="本机配置文件的绝对路径" scripts/run_realtime_update.cjs --resume 本轮目录名
```

恢复器核对本轮回执及推广费 B1，再补写商智。其他失败阶段使用 `jd_browser_host.cjs` 的分步命令定位后恢复。剪贴板内容写入前读回核对，失败后最多重写一次。A1 仅在全部所需回执成功时更新。

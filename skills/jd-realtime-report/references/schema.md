# 字段与口径

## 新版商智实时：A1:AA

| 列 | 字段 | 列 | 字段 | 列 | 字段 |
|---|---|---|---|---|---|
| A | 时间 | J | 成交单量 | S | 加购商品件数 |
| B | SKU | K | 成交客户数 | T | 加购客户数 |
| C | SKU名称 | L | 成交转化率 | U | 加购商品件数（正向） |
| D | 一级类目 | M | 客单价 | V | 加购商品件数（负向） |
| E | 二级类目 | N | 件单价 | W | 加购转化率 |
| F | 三级类目 | O | UV价值 | X | 加购金额 |
| G | 货号 | P | 商品浏览量 | Y | 取消订单金额 |
| H | 成交金额 | Q | 商品访客数 | Z | 取消订单商品件数 |
| I | 成交商品件数 | R | 商品人均浏览量 | AA | 取消订单单量 |

完整原始结构导入，不重排列、不删辅助列、不套旧版18列转换；百分号和“-”按导出保留。SKU保持完整数字字符，不引入引号、科学计数法或舍入。下载文件的工作表dimension可能错误标为A1，读取时必须 `reset_dimensions()` 再遍历实际数据。

## 实时推广费：A3:W（不带表头）

| 列 | 表字段 | API或来源 |
|---|---|---|
| A | SKU ID | skuDocId |
| B | SKU 名称 | skuName |
| C | 点击时间 | YYYYMMDD~YYYYMMDD |
| D | 当前时间 | 沿用“当前时间”标记；实际抓取时刻写第1行说明/运行记录 |
| E | 花费 | cost，单位元 |
| F | 展现数 | impressions |
| G | 点击数 | clicks |
| H | 点击率(%) | CTR |
| I | 平均点击成本 | CPC |
| J | 千次展现成本 | CPM |
| K | 总订单行 | totalOrderCnt |
| L | 总订单金额 | totalOrderSum |
| M | 总加购数 | totalCartCnt |
| N | 转化率(%) | conversionRatePercent |
| O | 加购率(%) | cartRatePercent |
| P | 平均订单成本 | orderCPA |
| Q | 投产比 | orderROI |
| R | 直接订单行 | directOrderCnt |
| S | 直接订单金额 | directOrderSum |
| T | 直接加购数 | directCartCnt |
| U | 间接订单行 | indirectOrderCnt |
| V | 间接订单金额 | indirectOrderSum |
| W | 间接加购数 | indirectCartCnt |

本表以 skuDocId 为合并键。旧渠道 2、134217728、16777216、256 按 dimensions=skuDocId 查询。shopSmart 600000013 单独按 dimensions=pin,businessType,skuDocId 查询并用 customFilters 过滤。

`clickOrOrderDay=15, clickOrOrderCaliber=0, giftFlag=0, orderStatusCategory=1`。花费、展现和点击等可加，ROI、CPC 和 CTR 由合并分子分母重算。账户汇总使用 index.trend，businessTypes=-4,256。分别记录账户与 SKU 抓取的实际差额。

使用者应确认当前店铺已授权京准通报告接口。本包的 API 客户端只开放 SKU 报告和账户汇总两种查询。

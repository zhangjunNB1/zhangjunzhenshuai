# 小米电视经营利润看板

分享网址：https://zhangjunnb1.github.io/zhangjunzhenshuai/

页面、代码和历史数据统一维护在本仓库，不再运行本地站点。静态发布文件位于根目录、assets和data。

新五页工作台的商品维护、成本调整、网页上传、售价试算及GitHub保存说明见[WORKBENCH.md](WORKBENCH.md)。下面记录原始Excel归档口径；新上传数据使用独立的可编辑成本规则。

## 原云表归档数据口径

唯一主表为工作簿第一个Sheet“SPU投产测算表”。全店销售额、推广前利润、推广费、经营利润分别读取Y1、U1、W1、X1；利润口径成本为Y1−U1。底板/大板的卡片分别读取第2、3行相应单元格。SKU明细读取首表第5行起的B/C/D/P/Q/R/S/W列；分组SUMPRODUCT范围决定是否纳入SKU毛利贡献。

“商智SKU商品明细”和“推广费”日表仅校验业务日期、真实成交以及广告归因；禁止回退到“SPU投产小时投产”“商智实时”或“实时推广费”。无成交时，实际成交价、单件利润和利润率留空，促销价不生成实际单件利润；保留已发生广告费用。

业务日期来自首表对应日表，不能按上传日推测。日表没有精确来源截止时刻时保持缺失，归档时刻单独保存。当前来自已上传Excel的11月5日数据，尚未自动抓取金山文档。

全店推广费包含S1京挑客费用2350.10元，未强行分摊到商品。首表全店/分类汇总与SKU明细的公式范围和缓存精度差额保留并说明。未列入投产表的已成交SKU不能被虚构成本及利润。

## 历史留存

活动档案清单位于data/manifest.json，当前basis固定为first-sheet。同一天不同归档版本取最新，不重复叠加。之前的实时快照文件不删除，列入retiredSnapshots供追溯，排除在本口径统计之外。请保留历史快照文件。

## 维护

项目源码在src，导入与构建脚本在scripts，验证在tests。维护时安装package.json中的依赖，Node >=22.18，然后运行npm test和npm run build，提交assets及数据文件即可由main分支根目录发布。无需网站服务器。

导入Excel：先安装requirements.txt中的openpyxl，运行python scripts/read-workbook.py 输入.xlsx 输出.json，再运行node scripts/import-first-sheet.mjs 输出.json。输出的完整工作簿JSON仅作临时输入，不要提交到公开仓库。金额统一为整数分，原始Excel不修改。

当前五页工作台支持归档浏览、明细筛选导出、前端商品维护、成本及套装规则维护、Excel/CSV报表上传和独立售价试算。网页内修改先保存草稿，经用户使用GitHub细粒度令牌可发布到data/workbench.json。推广API和金山自动抓取尚未接入。GitHub提交历史保留页面及发布资料版本，原始归档文件继续保留。

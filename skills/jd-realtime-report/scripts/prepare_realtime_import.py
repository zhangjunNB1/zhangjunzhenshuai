"""Prepare clipboard TSV without changing the new Shangzhi column order."""
import argparse
import csv
import datetime as dt
import json
from pathlib import Path
from openpyxl import load_workbook
from serve_promo_tsv import build_tsv
from runtime import workbench_root

HEADERS = ['时间','SKU','SKU名称','一级类目','二级类目','三级类目','货号','成交金额','成交商品件数','成交单量','成交客户数','成交转化率','客单价','件单价','UV价值','商品浏览量','商品访客数','商品人均浏览量','加购商品件数','加购客户数','加购商品件数（正向）','加购商品件数（负向）','加购转化率','加购金额','取消订单金额','取消订单商品件数','取消订单单量']

def main():
    if hasattr(__import__('sys').stdout, 'reconfigure'):
        __import__('sys').stdout.reconfigure(encoding='utf-8')
    p=argparse.ArgumentParser()
    p.add_argument('kind',choices=['shangzhi','promo'])
    p.add_argument('source',type=Path)
    p.add_argument('output',type=Path)
    p.add_argument('--date',required=True)
    args=p.parse_args()
    output_root=workbench_root()
    args.output=args.output.resolve()
    if not args.output.is_relative_to(output_root) or args.output==output_root:
        p.error('Output must stay inside JD_REPORT_WORKDIR')
    if args.kind=='promo':
        payload=json.loads(args.source.read_text(encoding='utf-8'))
        if payload['metadata']['start_date']!=args.date or payload['metadata']['end_date']!=args.date or not payload['metadata']['pagination_complete']:
            raise ValueError('Promotion date or pagination mismatch')
        sku_ids = [str(r.get('skuDocId', '')) for r in payload['rows']]
        if not sku_ids or any(not x.isdigit() for x in sku_ids) or len(sku_ids)!=len(set(sku_ids)):
            raise ValueError('Empty, invalid or duplicate promotion SKU data')
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_bytes(build_tsv(args.source))
        print(json.dumps({'rows':len(payload['rows']),'cost':payload['additive_metric_totals']['cost'],'fetched_at':payload['metadata']['fetched_at'],'output':str(args.output)},ensure_ascii=False))
        return
    wb=load_workbook(args.source,read_only=True,data_only=True)
    ws=wb.active
    ws.reset_dimensions()
    rows=[list(r) for r in ws.iter_rows(values_only=True) if any(v is not None for v in r)]
    if not rows or rows[0]!=HEADERS:
        raise ValueError('Unexpected Shangzhi header/order: '+str(rows[0]))
    skus=[]
    periods=set()
    for row in rows[1:]:
        if len(row)!=27:
            raise ValueError('Unexpected column count')
        row[1]=str(row[1]).lstrip("'")
        if not row[1].isdigit():
            raise ValueError('Invalid SKU')
        skus.append(row[1])
        periods.add(str(row[0]))
    if not skus or len(set(skus))!=len(skus):
        raise ValueError('Empty or duplicate SKU export')
    if len(periods)!=1 or any(len(parts:=period.split('~')) != 2 or not all(p.startswith(args.date+' ') for p in parts) for period in periods):
        raise ValueError('Wrong or mixed business date')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('w',encoding='utf-8',newline='') as f:
        csv.writer(f,delimiter='\t',lineterminator='\n').writerows(rows)
    print(json.dumps({'rows':len(skus),'columns':27,'period':list(periods),'output':str(args.output)},ensure_ascii=False))
    wb.close()

if __name__=='__main__':
    main()

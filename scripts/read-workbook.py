import hashlib
import json
import sys
from pathlib import Path
import openpyxl

if len(sys.argv) != 3:
    raise SystemExit('用法: python scripts/read-workbook.py 输入.xlsx 临时输出.json')
source, target = map(Path, sys.argv[1:])
values = openpyxl.load_workbook(source, read_only=True, data_only=True)
formulas = openpyxl.load_workbook(source, read_only=True, data_only=False)
first = values.sheetnames[0]
if first != 'SPU投产测算表':
    raise SystemExit('第一个Sheet名称不符，停止导入；禁止回退到实时表')
required = [first, '型号细分', '商智SKU商品明细', '推广费']
result = {'file': source.name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'sheets': {}, 'formulas': {}}
for name in required:
    result['sheets'][name] = [[v if v is not None else '' for v in row] for row in values[name].iter_rows(values_only=True)]
    if name in (first, '型号细分'):
        result['formulas'][name] = [[v if isinstance(v, str) and v.startswith('=') else getattr(v, 'text', None) for v in row] for row in formulas[name].iter_rows(values_only=True)]
target.write_text(json.dumps(result, ensure_ascii=False, default=str), encoding='utf-8')
print(json.dumps({'sheet': first, 'readSheets': required, 'sourceUnmodified': True}, ensure_ascii=False))

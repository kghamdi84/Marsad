"""Converts the GPR daily .xls (legacy Excel) to JSON rows on stdout.

Usage: python3 xls_to_json.py path/to/data_gpr_daily_recent.xls
Reads Sheet1 with xlrd. Output: a JSON array of objects keyed by the header row, with dates as YYYY-MM-DD.
"""
import json
import sys
from datetime import datetime

import xlrd

book = xlrd.open_workbook(sys.argv[1])
sheet = book.sheet_by_index(0)
header = [str(c.value) for c in sheet.row(0)]
rows = []
for r in range(1, sheet.nrows):
    row = {}
    for name, cell in zip(header, sheet.row(r)):
        if cell.ctype == xlrd.XL_CELL_DATE:
            row[name] = datetime(*xlrd.xldate_as_tuple(cell.value, book.datemode)).strftime("%Y-%m-%d")
        elif cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
            row[name] = None
        else:
            row[name] = cell.value
    rows.append(row)
json.dump(rows, sys.stdout)

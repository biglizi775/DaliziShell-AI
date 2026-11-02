"""Generate isolated, non-sensitive preview fixtures; never touch user files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import pymupdf as fitz
from openpyxl import Workbook
from docx import Document

root = Path(__file__).resolve().parents[1] / 'src-tauri/target/preview-smoke'
root.mkdir(parents=True, exist_ok=True)
pdf = fitz.open()
for i in range(2):
    page = pdf.new_page()
    page.insert_text((60, 70), f'Preview compatibility page {i + 1}')
pdf.save(root / 'normal.PDF')
pdf.save(root / 'password.pdf', encryption=fitz.PDF_ENCRYPT_AES_256, user_pw='preview-test', owner_pw='owner-test')
(root / 'preamble.pdf').write_bytes(b'\xef\xbb\xbf\n' + (root / 'normal.PDF').read_bytes())
word = Document()
word.add_heading('兼容性文档', 0)
word.add_paragraph('正文支持中文和符号 & < >。')
table = word.add_table(rows=2, cols=2)
table.cell(0, 0).text = '名称'
table.cell(0, 1).text = '数量'
table.cell(1, 0).text = '梨'
table.cell(1, 1).text = '12'
word.save(root / 'normal.docx')
source = ZipFile(root / 'normal.docx')
with ZipFile(root / 'relocated.dotx', 'w', ZIP_DEFLATED) as output:
    for name in source.namelist():
        data = source.read(name)
        if name == '_rels/.rels':
            data = data.replace(b'Target="word/document.xml"', b'Target="custom/main.xml"')
        output.writestr('custom/main.xml' if name == 'word/document.xml' else name, data)
wb = Workbook()
ws = wb.active
ws.title = '中文数据'
ws.append(['名称', '金额', '内容'])
for i in range(1, 560):
    ws.append([f'项目{i}', i * 1.5, '<script>alert(1)</script>' if i == 1 else '正文'])
ws2 = wb.create_sheet('第二页')
ws2.append(['切换成功', 'hello'])
wb.save(root / 'normal.xlsx')
wb2 = Workbook()
wb2.active['A1'] = 'bounded'
wb2.active['XFD1048576'] = 'far cell'
wb2.save(root / 'sparse.xlsx')
(root / '中文.csv').write_bytes('名称;说明\r\n梨;"第一行\n第二行"\r\n代码;"<img src=x onerror=alert(1)>"'.encode('gb18030'))
(root / 'normal.tsv').write_text('列1\t列2\n甲\t乙', encoding='utf-16')
(root / 'corrupt.docx').write_bytes(b'broken zip')
(root / 'legacy.xls').write_bytes(b'unsupported fixture')
print(json.dumps([str(p) for p in root.iterdir() if p.suffix.lower() in ['.pdf','.docx','.dotx','.xlsx','.csv','.tsv','.xls']], ensure_ascii=False))

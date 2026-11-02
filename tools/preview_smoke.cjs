// Real native parser results + real PDF.js/table rendering, using local fixtures.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'src-tauri/target/preview-smoke');
const results = JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8').replace(/^\uFEFF/, ''));
for (const name of ['normal.PDF', 'preamble.pdf', 'password.pdf']) assert.equal(results[name].kind, 'pdf', name);
for (const name of ['normal.docx', 'relocated.dotx']) { assert.equal(results[name].kind, 'document', name); assert.match(results[name].content, /兼容性文档/); }
for (const name of ['normal.xlsx', 'sparse.xlsx', '中文.csv', 'normal.tsv']) assert.equal(results[name].kind, 'spreadsheet', name);
if (results['date.xlsb']) assert.equal(results['date.xlsb'].kind, 'spreadsheet', 'date.xlsb');
assert.equal(results['corrupt.docx'].reason, 'invalid-document');
assert.equal(results['legacy.xls'].reason, 'legacy-sheet');
assert.equal(JSON.parse(results['sparse.xlsx'].content).sheets[0].rows.length, 1);
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/document-preview.css"><style>body{overflow:auto;padding:24px;background:#f4f5fa}#previewPanel{display:block;position:relative;width:600px;max-width:100%;margin:auto;background:white;border:1px solid #ddd}h1{font-size:18px}</style><section id="previewPanel"><h1 id="title"></h1><div id="content"></div></section><script>let locale='zh'; const $=(id)=>document.getElementById(id); const esc=(s)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');let generation=0;</script><script src="/document-preview.js"></script>`;
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  const file = path.resolve(root, 'ui', '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(path.join(root, 'ui') + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.DALIZI_BROWSER ? { executablePath: process.env.DALIZI_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const show = async (name) => page.evaluate(({ name, result }) => {
    const current = ++generation; document.querySelector('#title').textContent = name;
    document.querySelector('#content').replaceChildren();
    void renderDocumentPreview(result, document.querySelector('#content'), name, () => current === generation);
  }, { name, result: results[name] });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await show('normal.xlsx');
    await page.locator('.sheet-grid tbody tr').last().waitFor();
    assert.equal(await page.locator('.sheet-grid tbody tr').count(), 50);
    assert.equal(await page.locator('.sheet-grid script').count(), 0);
    assert.match(await page.locator('.sheet-grid').innerText(), /<script>alert/);
    await page.locator('[data-sheet-next]').click();
    assert.match(await page.locator('[data-sheet-range]').innerText(), /51–100/);
    await page.locator('[data-sheet-select]').selectOption('1');
    assert.match(await page.locator('.sheet-grid').innerText(), /切换成功/);
    await page.locator('[data-sheet-select]').selectOption('0');
    await page.screenshot({ path: path.join(output, 'spreadsheet.png') });
    await show('中文.csv');
    assert.match(await page.locator('.sheet-grid').innerText(), /第一行\n第二行/);
    assert.equal(await page.locator('.sheet-grid img').count(), 0);
    await show('normal.tsv'); assert.match(await page.locator('.sheet-grid').innerText(), /甲/);
    if (results['date.xlsb']) {
      await show('date.xlsb');
      assert.equal(await page.locator('.sheet-grid tbody tr').count(), 3);
    }
    await show('relocated.dotx'); assert.match(await page.locator('.document-body').innerText(), /梨/);
    await page.screenshot({ path: path.join(output, 'word.png') });
    await show('preamble.pdf'); await page.locator('canvas[data-page="1"]').waitFor();
    await page.locator('[data-pdf-next]').click(); await page.locator('canvas[data-page="2"]').waitFor();
    await page.screenshot({ path: path.join(output, 'pdf.png') });
    await show('password.pdf'); await page.locator('.pdf-password input').fill('wrong');
    await page.locator('.pdf-password button').click();
    await page.waitForFunction(() => document.querySelector('.pdf-status').textContent.includes('不正确'));
    await page.locator('.pdf-password input').fill('preview-test'); await page.locator('.pdf-password button').click();
    await page.locator('canvas[data-page="1"]').waitFor();
    await show('password.pdf'); await page.locator('.pdf-password input').waitFor();
    await show('normal.xlsx'); await page.locator('.sheet-grid').waitFor();
    await page.waitForTimeout(100);
    assert.deepEqual(errors, []);
    console.log('Native document compatibility + PDF password/paging + spreadsheet paging/sheets/XSS/disposal: passed');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

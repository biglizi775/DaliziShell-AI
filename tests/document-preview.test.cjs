const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../ui/document-preview.js'), 'utf8');
function harness() {
  const context = vm.createContext({ locale: 'zh', clearTimeout, console });
  vm.runInContext(source, context);
  return { context, run: (code) => vm.runInContext(code, context) };
}
test('PDF rendering fits width and caps canvas allocation for oversized pages and high DPI', () => {
  const h = harness();
  const fit = h.run("pdfCanvasGeometry(600, 800, 300, 'fit', 1)");
  assert.equal(fit.width, 300); assert.equal(fit.height, 400);
  const large = h.run("pdfCanvasGeometry(100000, 100000, 500, '2', 4)");
  assert.ok(large.width * large.height <= 4_000_000);
  assert.ok(large.cssWidth <= 4096 && large.cssHeight <= 4096);
  for (const [width, height, zoom] of [[0, 800, 'fit'], [600, -1, 'fit'], [Infinity, 800, 'fit'], [600, 800, 'invalid']]) {
    h.context.args = [width, height, 300, zoom];
    assert.throws(() => h.run('pdfCanvasGeometry(...args)'));
  }
});
test('changing documents cancels rendering, releases the PDF worker and disconnects resize work', async () => {
  const h = harness(), calls = [];
  h.context.session = { disposed: false, observer: { disconnect: () => calls.push('observer') }, renderTask: { cancel: () => calls.push('render') }, loadingTask: { destroy: async () => { calls.push('worker'); } } };
  h.run('documentPreviewSession = session; disposeDocumentPreview(); disposeDocumentPreview();');
  assert.equal(h.context.session.disposed, true);
  assert.equal(h.run('documentPreviewSession'), null);
  assert.deepEqual(calls, ['observer', 'render', 'worker']);
});

test('preview reasons distinguish formats, cloud state and parsing errors', () => {
  const h = harness();
  for (const reason of ['cloud-not-local', 'reparse-point', 'unsafe-path', 'legacy-sheet', 'text-encoding', 'encrypted-document', 'invalid-document']) {
    h.context.reason = reason;
    assert.ok(h.run('documentPreviewReason(reason)'));
    assert.notEqual(h.run('documentText(documentPreviewReason(reason))'), reason);
  }
  assert.equal(h.run('sheetColumnName(0)'), 'A');
  assert.equal(h.run('sheetColumnName(25)'), 'Z');
  assert.equal(h.run('sheetColumnName(26)'), 'AA');
  assert.equal(h.run('sheetColumnName(49)'), 'AX');
});

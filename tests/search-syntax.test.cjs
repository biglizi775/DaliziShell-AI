const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/search-syntax.js'), 'utf8');
function harness(invoke = async () => ({})) {
  let tab = {}, timer;
  const attrs = new Map(), state = { path: 'C:\\Work' }, input = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) };
  const ctx = vm.createContext({ TextEncoder, state, invoke, locale: 'zh', $: () => input, curTab: () => tab, quickMode: () => 'local', els: { scroller: {} }, renderAll() {}, renderStatus() {}, setTimeout: (fn) => { timer = fn; return 1; }, clearTimeout: () => { timer = null; } });
  vm.runInContext(source, ctx);
  return { ctx, state, attrs, run: (s) => vm.runInContext(s, ctx), flush: () => timer(), switchTab: () => { tab = {}; } };
}
test('local AST evaluates boolean, wildcard, path and metadata predicates with Unicode', () => {
  const h = harness();
  const entry = { name: '报告🌟.pdf', isDir: false, size: 2048, mtime: 123, path: 'c:\\work\\报告🌟.pdf', parent: 'c:\\work' };
  const term = (op, value) => ({ op, value });
  const cases = [
    [term('name', { text: '报告?.pdf' }), true], [term('name', { text: '报告*.docx' }), false],
    [term('path', { text: 'c:\\*\\报告?.pdf' }), true], [term('path', { text: 'c:\\*报告?.pdf' }), false],
    [term('path', { text: 'c:\\**报告?.pdf' }), true], [term('parent', 'c:\\work'), true],
    [term('extension', ['pdf', 'docx']), true], [term('kind', true), false],
    [term('size', { min: 2048, max: 4096, minInclusive: true, maxInclusive: false }), true],
    [term('size', { min: 2048, minInclusive: false }), false],
    [term('modified', { min: 123, max: 123, minInclusive: true, maxInclusive: true }), true],
    [term('and', [term('not', term('kind', true)), term('or', [term('extension', ['pdf']), term('extension', ['xlsx'])])]), true],
  ];
  for (const [tree, expected] of cases) {
    h.ctx.tree = tree; h.ctx.entry = entry;
    assert.equal(h.run('compileSearchExpression(tree)(entry)'), expected, JSON.stringify(tree));
  }
  h.ctx.entry = { ...entry, isDir: true, size: null, mtime: 0 };
  h.ctx.tree = term('size', { max: 1e12, maxInclusive: true });
  assert.equal(h.run('compileSearchExpression(tree)(entry)'), false, 'unknown size is not treated as zero');
  h.ctx.tree = term('modified', { max: 1e12, maxInclusive: true });
  assert.equal(h.run('compileSearchExpression(tree)(entry)'), false, 'missing date does not match');
});
test('plain local search needs no IPC and matches all space-separated terms', () => {
  const h = harness(() => { throw new Error('no IPC'); });
  h.run("updateLocalSearch('预算 报告')");
  assert.equal(h.run("matchLocalSearch({name:'报告2026预算.pdf'})"), true);
  assert.equal(h.run("matchLocalSearch({name:'报告.pdf'})"), false);
});
test('advanced parsing ignores stale query and tab responses', async () => {
  let resolve;
  const h = harness(() => new Promise((done) => { resolve = done; }));
  h.run("updateLocalSearch('ext:pdf')"); const pending = h.flush();
  h.run("updateLocalSearch('预算')");
  resolve({ root: { op: 'extension', value: ['pdf'] } }); await pending;
  assert.equal(h.run("matchLocalSearch({name:'预算.txt'})"), true);
  h.run("updateLocalSearch('ext:pdf')"); const tabPending = h.flush(); h.switchTab();
  resolve({ root: { op: 'extension', value: ['pdf'] } }); await tabPending;
  assert.equal(h.run("matchLocalSearch({name:'预算.txt'})"), true);
});
test('invalid or over-budget searches surface parser errors and reset cleanly', async () => {
  const h = harness(async () => { throw new Error('Invalid search'); });
  for (const query of ['regex:.*', '词'.repeat(350)]) {
    h.ctx.query = query; h.run('updateLocalSearch(query)'); await h.flush();
    assert.equal(h.attrs.get('aria-invalid'), 'true');
    assert.match(h.state.filterError, /Invalid search/);
    assert.equal(h.run("matchLocalSearch({name:'anything'})"), false);
  }
  h.run('resetLocalSearch()');
  assert.equal(h.attrs.has('aria-invalid'), false);
  assert.equal(h.state.filterError, '');
});

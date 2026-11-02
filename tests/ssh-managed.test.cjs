const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness(extra = {}) {
  const context = vm.createContext({ locale: 'en', state: { tabs: [] }, console,
    syncSshInfo() {}, renderTabs() {}, toast() {}, ...extra });
  for (const file of ['ssh.js', 'ssh-managed.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../ui', file), 'utf8'), context);
  context.syncSshInfo = () => {};
  return { context, run: code => vm.runInContext(code, context) };
}
const tab = () => ({ kind: 'term', connection: 'ssh', key: 'current', termId: 2147483648, sshConfig: { managed: true }, sshAuthenticated: true });
test('native saved profiles keep only metadata and preserve the selected engine', () => {
  const h = harness();
  h.context.input = { host: 'host.test', user: 'user', port: 22, managed: true, infoMode: 'windows', password: 'secret', auth: { secret: 'secret' }, privateKey: 'PRIVATE KEY' };
  const result = h.run('sshSafeConfig(input)');
  assert.equal(result.managed, true); assert.equal(result.infoMode, 'windows');
  assert.doesNotMatch(JSON.stringify(result), /secret|password|auth|PRIVATE KEY/);
});
test('native state and resource events reject replaced, closed and unrelated sessions', () => {
  for (const extra of [{ key: 'old' }, { termId: 42 }, { disposed: true }, { exited: true }, { sshDisconnectRequested: true }]) {
    const h = harness(), tb = { ...tab(), sshAuthenticated: false, ...extra };
    h.context.state.tabs = [tb]; h.context.event = { payload: { id: 2147483648, key: 'current', authenticated: true, info: { os: 'Linux' } } };
    h.run('onManagedSshState(event); onManagedSshStats(event)');
    assert.equal(tb.sshAuthenticated, false); assert.equal(tb.sshResources, undefined);
  }
});
test('early authenticated event can bind a starting tab and clean resource fields', () => {
  const h = harness(), tb = { ...tab(), termId: null, starting: true, sshAuthenticated: false };
  h.context.state.tabs = [tb]; h.context.event = { payload: { id: 2147483648, key: 'current', authenticated: true, info: { os: 'Linux\u0000', secret: 'not a field', user: 'x'.repeat(800) } } };
  h.run('onManagedSshState(event); onManagedSshStats(event)');
  assert.equal(tb.termId, 2147483648); assert.equal(tb.sshAuthenticated, true);
  assert.equal(tb.sshResources.os, 'Linux '); assert.equal(tb.sshResources.user.length, 512); assert.equal(tb.sshResources.secret, undefined);
});
test('late resource refresh cannot replace a reconnected tab', async () => {
  let resolve;
  const h = harness({ invoke: () => new Promise(done => { resolve = done; }) }), tb = tab();
  h.context.tb = tb; const job = h.run('refreshManagedStats(tb)');
  tb.key = 'reconnected'; tb.sshStatsBusy = false;
  resolve({ os: 'old server' }); await job;
  assert.equal(tb.sshResources, undefined); assert.equal(tb.sshStatsBusy, false);
});
test('directory navigation ignores an earlier request arriving after the new location', async () => {
  const pending = [], h = harness({ invoke: () => new Promise(done => pending.push(done)) }), tb = tab();
  tb.sshFiles = { generation: 0 }; h.context.tb = tb;
  const first = h.run('loadSshFiles(tb, "/one")'), second = h.run('loadSshFiles(tb, "/two")');
  pending[1]({ path: '/two', entries: [{ name: 'new' }] }); await second;
  pending[0]({ path: '/one', entries: [{ name: 'old' }] }); await first;
  assert.equal(tb.sshFiles.path, '/two'); assert.equal(tb.sshFiles.entries[0].name, 'new');
});
test('transfer progress accepts only the active transfer in the same session', () => {
  const h = harness(), tb = tab(); tb.sshTransfer = { transferId: 'active', status: 'running' };
  h.context.state.tabs = [tb]; h.context.event = { payload: { id: tb.termId, key: tb.key, transferId: 'previous', status: 'complete' } };
  h.run('onSshTransfer(event)'); assert.equal(tb.sshTransfer.status, 'running');
  h.context.event.payload.transferId = 'active'; h.run('onSshTransfer(event)'); assert.equal(tb.sshTransfer.status, 'complete');
});
test('partially registered native event listeners are removed and registration can retry', async () => {
  let attempts = 0, stopped = 0;
  const h = harness({ listen: async () => { if (++attempts === 2) throw Error('ACL'); return () => { stopped++; }; } });
  await assert.rejects(h.run('ensureManagedSshEvents()'), /ACL/); assert.equal(stopped, 1);
  await h.run('ensureManagedSshEvents()'); assert.equal(attempts, 5);
});

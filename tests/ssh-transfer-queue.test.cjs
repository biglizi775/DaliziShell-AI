const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ui/ssh-transfer-queue.js'), 'utf8');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const files = (n = 3) => Array.from({ length: n }, (_, i) => ({ name: `file-${i}.txt`, localPath: `C:\\source\\file-${i}.txt`, remote: '/captured', size: 10 }));
function harness(handler) {
  const calls = [], timers = new Map(); let next = 0;
  const tb = { key: 'session-key', termId: 2147483648, sshAuthenticated: true, sshConfig: { host: 'server.test', user: 'demo', port: 22, password: 'never-store' } };
  const context = vm.createContext({ tb, files: files(), locale: 'zh', crypto: { randomUUID: () => `fixture-request-${++next}` }, Date, Set, Map, console,
    state: { tabs: [tb] }, $: () => null, requestAnimationFrame: () => 1, loadSshFiles: () => {},
    setTimeout: (fn) => { const id = ++next; timers.set(id, fn); return id; },
    invoke: async (cmd, args) => { calls.push({ cmd, args }); return handler ? handler(cmd, args, context) : cmd === 'ssh_file_transfer' ? args.requestId : null; },
  });
  vm.runInContext(source, context);
  const run = (code) => vm.runInContext(code, context);
  const emit = (batch = 0, index = 0, status = 'complete', extra = {}) => { context.payload = { key: run(`sshTaskBatches[${batch}].key`), id: run(`sshTaskBatches[${batch}].sessionId`), transferId: run(`sshTaskBatches[${batch}].items[${index}].transferId`), status, bytes: 10, total: 10, ...extra }; return run('receiveSshQueuedTransfer(payload)'); };
  return { context, calls, timers, tb, run, emit, starts: () => calls.filter((c) => c.cmd === 'ssh_file_transfer') };
}

test('retry carries directory kinds and backend resume tokens only into the review', async () => {
  const h = harness(); h.run('createSshBatch(tb, [{...files[0],entryKind:"directory"},files[1]], "upload", "/captured")'); await tick();
  assert.equal(h.starts()[0].args.entryKind, 'directory');
  h.emit(); await tick(); h.emit(0, 1, 'failed', { resumeId: 'backend-checkpoint', resumedBytes: 3 }); await tick();
  assert.equal(h.run('sshTaskBatches[0].items[1].resumeId'), 'backend-checkpoint');
  h.context.review = null; h.run('showSshBatchReview = (...args) => { review = args; }; retrySshBatch(sshTaskBatches[0])');
  assert.equal(h.context.review[1][0].resumeId, 'backend-checkpoint'); assert.equal(h.context.review[1][0].entryKind, 'file');
  assert.equal(h.starts().length, 2, 'review does not start an automatic retry');
});

test('remote multi-selection includes folders but excludes links and can disable keeping partials', async () => {
  const h = harness();
  assert.equal(h.run('selectedSshFiles({entries:[{name:"dir",isDir:true},{name:"link",isLink:true},{name:"file"}],selection:new Set([0,1,2])}).length'), 2);
  h.run('createSshBatch(tb, files.slice(0,1), "download", "C:\\dest", false, false)'); await tick();
  assert.equal(h.starts()[0].args.resumable, false);
});
test('one file per connection runs at a time and a captured destination survives folder navigation', async () => {
  const h = harness(); h.run('createSshBatch(tb, files, "upload", "/captured")'); await tick();
  assert.equal(h.starts().length, 1); h.tb.sshFiles = { path: '/now-elsewhere' };
  h.emit(); await tick(); assert.equal(h.starts().length, 2); assert.equal(h.starts()[1].args.remote, '/captured');
  h.emit(0, 1); await tick(); h.emit(0, 2); await tick(); assert.equal(h.run('sshBatchDone(sshTaskBatches[0])'), true);
  assert.equal(h.run('sshBatchStats(sshTaskBatches[0]).complete'), 3);
  assert.equal(h.run('JSON.stringify(sshTaskBatches.map(({owner, ...batch}) => batch)).includes("never-store")'), false);
});
test('terminal events arriving before invoke resolves cannot overlap the next file', async () => {
  const start = deferred(); const h = harness((cmd, args) => cmd === 'ssh_file_transfer' && args.localPath.endsWith('0.txt') ? start.promise : args?.requestId);
  h.run('createSshBatch(tb, files, "upload", "/captured")'); h.emit(); await tick(); assert.equal(h.starts().length, 1);
  start.resolve(h.starts()[0].args.requestId); await tick(); assert.equal(h.starts().length, 2);
  h.emit(0, 0, 'running'); assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'complete');
});
test('cancelling while a start is pending cancels queued files and sends cancellation after acknowledgement', async () => {
  const start = deferred(); const h = harness((cmd) => cmd === 'ssh_file_transfer' ? start.promise : null);
  h.run('createSshBatch(tb, files, "download", "C:\\dest")'); await h.run('cancelSshBatch(sshTaskBatches[0])');
  assert.equal(h.calls.some((c) => c.cmd === 'ssh_transfer_cancel'), false);
  start.resolve(h.starts()[0].args.requestId); await tick(); assert.equal(h.calls.filter((c) => c.cmd === 'ssh_transfer_cancel').length, 1);
  assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'running', 'cancel request is not completion');
  h.emit(0, 0, 'cancelled'); await tick(); assert.equal(h.run('sshBatchDone(sshTaskBatches[0])'), true); assert.equal(h.starts().length, 1);
});
test('publication is allowed to finish when the remaining queue is cancelled', async () => {
  const h = harness(); h.run('createSshBatch(tb, files, "upload", "/captured")'); await tick(); h.emit(0, 0, 'finalizing');
  await h.run('cancelSshBatch(sshTaskBatches[0])'); assert.equal(h.calls.some((c) => c.cmd === 'ssh_transfer_cancel'), false);
  h.emit(); await tick(); assert.equal(h.run('sshBatchStats(sshTaskBatches[0]).complete'), 1); assert.equal(h.run('sshBatchStats(sshTaskBatches[0]).cancelled'), 2);
});
test('failed cancellation stays visible and can be requested again', async () => {
  let attempts = 0; const h = harness((cmd, args) => cmd === 'ssh_transfer_cancel' && ++attempts === 1 ? Promise.reject('busy') : cmd === 'ssh_file_transfer' ? args.requestId : null);
  h.run('createSshBatch(tb, files, "upload", "/captured")'); await tick(); await h.run('cancelSshBatch(sshTaskBatches[0])');
  assert.equal(h.run('sshTaskBatches[0].items[0].cancelError'), 'busy'); assert.equal(h.run('sshBatchDone(sshTaskBatches[0])'), false);
  await h.run('cancelSshBatch(sshTaskBatches[0])'); assert.equal(attempts, 2); assert.equal(h.starts().length, 1);
});
test('failure policy pauses pending files; the default continues and never replays completed items', async () => {
  for (const stop of [true, false]) {
    const h = harness(); h.run(`createSshBatch(tb, files, "upload", "/captured", ${stop})`); await tick(); h.emit(0, 0, 'failed', { error: 'target exists' }); await tick();
    assert.equal(h.starts().length, stop ? 1 : 2); assert.equal(h.run('sshTaskBatches[0].paused'), stop);
  }
});
test('disconnect prevents queued work and late results stay with the old connection', async () => {
  const h = harness(); h.run('createSshBatch(tb, files, "upload", "/captured")'); await tick(); h.tb.exited = true; h.run('disconnectSshQueue(tb)');
  assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'interrupted');
  h.tb.key = 'reconnected'; h.tb.termId++; h.tb.exited = false;
  h.run('createSshBatch(tb, files.slice(0,1), "upload", "/new")'); await tick(); assert.equal(h.starts().length, 2);
  h.emit(0, 0, 'running'); assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'interrupted');
  h.emit(0, 0, 'complete'); assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'complete');
  assert.equal(h.run('sshTaskBatches[1].items[0].status'), 'running'); assert.equal(h.starts().length, 2);
});
test('status polling recovers a missed completion event and advances the queue', async () => {
  const h = harness((cmd, args, c) => cmd === 'ssh_file_transfer' ? args.requestId : cmd === 'ssh_transfer_status' ? { key: c.tb.key, id: c.tb.termId, transferId: args.transferId, status: 'complete', bytes: 10, total: 10 } : null);
  h.run('createSshBatch(tb, files, "upload", "/captured")'); await tick();
  await [...h.timers.values()][0](); await tick(); assert.equal(h.starts().length, 2);
  assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'complete');
});
test('ambiguous IPC failure pauses the batch instead of automatically retrying side effects', async () => {
  const h = harness(() => Promise.reject('IPC unavailable')); h.run('createSshBatch(tb, files, "upload", "/captured")'); await tick();
  assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'interrupted'); assert.equal(h.run('sshTaskBatches[0].paused'), true); assert.equal(h.starts().length, 1);
});
test('a lost start acknowledgement with no immediate status pauses and still accepts its late result', async () => {
  const h = harness((cmd) => cmd === 'ssh_file_transfer' ? Promise.reject('start acknowledgement lost') : null);
  h.run('createSshBatch(tb, files, "upload", "/captured")'); await tick();
  assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'interrupted'); assert.equal(h.starts().length, 1);
  h.emit(0, 0, 'complete'); await tick(); assert.equal(h.run('sshTaskBatches[0].items[0].status'), 'complete'); assert.equal(h.starts().length, 1);
});
test('independent connections can progress together and queue capacity is bounded', async () => {
  const h = harness(); h.context.second = { ...h.tb, key: 'other', termId: h.tb.termId + 1 };
  h.run('createSshBatch(tb, files, "upload", "/a"); createSshBatch(second, files, "upload", "/b")'); await tick(); assert.equal(h.starts().length, 2);
  h.context.excess = files(2001); assert.throws(() => h.run('createSshBatch(tb, excess, "upload", "/a")'), /200/);
});
test('retry after closing a tab can use an explicitly connected matching host, but opens review first', async () => {
  const h = harness(); h.run('createSshBatch(tb, files.slice(0,1), "upload", "/captured")'); await tick(); h.emit(0, 0, 'failed');
  h.tb.disposed = true;
  const replacement = { ...h.tb, disposed: false, key: 'new-tab', termId: h.tb.termId + 1, sshConfig: { ...h.tb.sshConfig, managed: true } };
  h.context.state.tabs = [replacement]; h.context.review = null; h.run('showSshBatchReview = (...args) => { review = args; }; retrySshBatch(sshTaskBatches[0])');
  assert.equal(h.context.review[0], replacement); assert.equal(h.context.review[1].length, 1); assert.equal(h.starts().length, 1);
});

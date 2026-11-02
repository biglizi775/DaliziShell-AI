const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const source = readFileSync(require('node:path').join(__dirname, '../ui/app.js'), 'utf8');
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((r, fail) => { resolve = r; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(setImmediate);
function harness(invoke) {
  let key = 0;
  const calls = [], notices = [], copied = [], fields = new Map();
  const state = { navToken: 0, path: 'C:\\files', tabs: [{ path: 'C:\\files' }], tab: 0 };
  class Terminal {
    constructor() { this.cols = 80; this.rows = 25; this.output = ''; this.focusCount = 0; }
    loadAddon() {} open() {} onData(fn) { this.input = fn; }
    attachCustomKeyEventHandler(fn) { this.keyHandler = fn; }
    write(data, callback) { this.output += data; callback?.(); }
    focus() { this.focusCount++; } dispose() { this.disposed = true; }
    getSelection() { return this.selection || ''; }
  }
  const element = () => ({ style: {}, offsetParent: {}, innerHTML: '', textContent: '', handlers: {}, classList: { add() {}, toggle() {} }, setAttribute() {}, remove() {}, appendChild() {}, insertBefore() {}, addEventListener(name, callback) { this.handlers[name] = callback; }, querySelector: () => null });
  const context = vm.createContext({
    state, invoke: async (command, args) => { calls.push({ command, args }); return invoke(command, args); }, crypto: { randomUUID: () => String(++key) },
    locale: 'en', URL, navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    $: (name) => { if (!fields.has(name)) fields.set(name, element()); return fields.get(name); },
    store: { get: (_key, fallback) => fallback, set() {} }, listen: async () => () => {},
    esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    curTab: () => state.tabs[state.tab], isTermTab: (t) => t?.kind === 'term',
    isBrowserTab: () => false, navigate: async () => {},
    terminalEventsReady: Promise.resolve(),
    renderAll() {}, renderTabs() {}, renderStatus() {}, renderCrumbs() {}, toast: (...values) => notices.push(values), t: (s) => s,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    window: { Terminal, FitAddon: { FitAddon: class { fit() {} } } },
    document: { createElement: element },
    els: { termHost: { appendChild() {} } },
  });
  vm.runInContext(section('function switchTab(', '// ---- embedded terminal') + section('async function newTermTab(', 'function renderTabs()') +
    section('function onTermOutput(', 'const terminalEventsReady ='), context);
  return { state, context, calls, notices, copied, loadSsh: () => vm.runInContext(readFileSync(require('node:path').join(__dirname, '../ui/ssh.js'), 'utf8'), context), run: (s) => vm.runInContext(s, context) };
}

test('concurrent startup routes early output by key, not tab creation order', async () => {
  const pending = [];
  const h = harness((cmd, args) => {
    if (cmd === 'term_start') { const d = deferred(); pending.push({ ...d, args }); return d.promise; }
    return Promise.resolve();
  });
  const first = h.run("newTermTab('C:\\\\one')");
  const second = h.run("newTermTab('C:\\\\two')");
  await tick();
  const [a, b] = h.state.tabs.slice(1);
  h.context.event = { payload: { id: 22, key: b.key, data: 'second' } };
  h.run('onTermOutput(event)');
  h.context.event = { payload: { id: 11, key: a.key, data: 'first' } };
  h.run('onTermOutput(event)');
  pending[1].resolve(22); pending[0].resolve(11);
  await Promise.all([first, second]);
  assert.equal(a.term.output, 'first'); assert.equal(b.term.output, 'second');
  assert.equal(a.termId, 11); assert.equal(b.termId, 22);
  assert.equal(a.term.focusCount, 1); // async completion did not steal focus
});

test('closing during startup kills the late session without recreating the terminal', async () => {
  const d = deferred(), killed = [];
  const h = harness((cmd, args) => {
    if (cmd === 'term_start') return d.promise;
    if (cmd === 'term_kill') killed.push(args.id);
    return Promise.resolve();
  });
  const pending = h.run('newTermTab()'); await tick();
  const tb = h.state.tabs[1]; h.context.tb = tb;
  h.run('killTerm(tb)'); h.state.tabs.splice(1, 1); h.state.tab = 0;
  d.resolve(33); await pending;
  assert.deepEqual(killed, [33]); assert.equal(tb.term, null); assert.equal(tb.el, null);
});

test('exit before startup response is preserved', async () => {
  const d = deferred();
  const h = harness((cmd) => cmd === 'term_start' ? d.promise : Promise.resolve());
  const pending = h.run('newTermTab()'); await tick();
  h.context.event = { payload: { id: 7, key: h.state.tabs[1].key } };
  h.run('onTermClosed(event)'); d.resolve(7); await pending;
  assert.equal(h.state.tabs[1].exited, true);
  assert.match(h.state.tabs[1].term.output, /procExited/);
});

test('input is ordered per terminal without blocking another terminal', async () => {
  const calls = [], firstWrite = deferred();
  const h = harness((cmd, args) => {
    if (cmd === 'term_start') return Promise.resolve(Number(args.key));
    if (cmd === 'term_write') {
      calls.push(args);
      if (calls.length === 1) return firstWrite.promise;
    }
    return Promise.resolve();
  });
  await h.run('newTermTab()'); await h.run('newTermTab()');
  const [a, b] = h.state.tabs.slice(1);
  a.term.input('a'); a.term.input('b'); b.term.input('z'); await tick();
  assert.deepEqual(calls.map((c) => c.data), ['a', 'z']);
  firstWrite.resolve(); await tick();
  assert.deepEqual(calls.map((c) => c.data), ['a', 'z', 'b']);
});

test('new terminal inherits terminal directory and ignores output from closed sessions', async () => {
  const h = harness((cmd, args) => Promise.resolve(cmd === 'term_start' ? Number(args.key) : undefined));
  await h.run("newTermTab('D:\\\\work')"); await h.run('newTermTab()');
  assert.equal(h.state.tabs[2].cwd, h.state.tabs[1].cwd);
  h.context.event = { payload: { id: 99, key: 'unknown', data: 'wrong' } };
  h.run('onTermOutput(event)'); assert.equal(h.state.tabs[2].term.output, '');
});

test('resize coalesces pending dimensions and skips unchanged sizes', async () => {
  const d = deferred(), calls = [];
  const h = harness((cmd, args) => {
    if (cmd === 'term_start') return Promise.resolve(1);
    if (cmd === 'term_resize') { calls.push(args); return calls.length === 1 ? d.promise : Promise.resolve(); }
    return Promise.resolve();
  });
  await h.run('newTermTab()'); h.context.tb = h.state.tabs[1];
  const first = h.run('tb.nextSize = {cols: 80, rows: 25}; flushTermResize(tb)');
  h.run('tb.nextSize = {cols: 90, rows: 30}; flushTermResize(tb)');
  h.run('tb.nextSize = {cols: 120, rows: 40}; flushTermResize(tb)');
  d.resolve(); await first;
  await h.run('tb.nextSize = {cols: 120, rows: 40}; flushTermResize(tb)');
  assert.deepEqual(calls.map((c) => c.cols), [80, 120]);
});

test('SSH uses the same isolated terminal pipeline without sending UI labels or local paths', async () => {
  const calls = [], h = harness((cmd, args) => { calls.push({ cmd, args }); return Promise.resolve(cmd === 'ssh_start' ? 71 : undefined); });
  let mounted = 0; h.context.mountSshInfo = () => mounted++;
  await h.run("newTermTab(null, { host: 'example.test', port: 2222, user: 'dev', label: 'Private connection', infoMode: 'posix' })");
  const request = calls.find((c) => c.cmd === 'ssh_start').args;
  assert.equal(request.config.host, 'example.test'); assert.equal(request.config.port, 2222);
  assert.equal(request.config.label, undefined); assert.equal(request.cwd, undefined);
  assert.equal(h.state.tabs[1].cwd, null); assert.equal(h.state.tabs[1].connection, 'ssh');
  assert.equal(mounted, 1); assert.equal(calls.some((c) => c.cmd === 'term_start'), false);
  h.state.tabs[1].term.input('ls\r'); await tick();
  assert.equal(calls.find((c) => c.cmd === 'term_write').args.id, 71);
});

test('SSH waits for metadata listeners and a disconnect during startup kills the late child', async () => {
  const events = deferred(), started = deferred(), killed = [], calls = [];
  const h = harness((cmd, args) => { calls.push(cmd); if (cmd === 'ssh_start') return started.promise; if (cmd === 'term_kill') killed.push(args.id); return Promise.resolve(); });
  h.context.ensureSshEvents = () => events.promise;
  const job = h.run("newTermTab(null, { host: 'example.test', port: 22, user: 'dev' })");
  await tick(); assert.equal(calls.includes('ssh_start'), false);
  events.resolve(); await tick();
  const tb = h.state.tabs[1]; tb.sshDisconnectRequested = true;
  started.resolve(88); await job;
  assert.deepEqual(killed, [88]); assert.equal(tb.exited, true); assert.equal(tb.termId, null);
  assert.ok(tb.term && tb.el, 'disconnect keeps the visible terminal and its output');
  tb.term.input('password'); await tick(); assert.equal(calls.includes('term_write'), false);
});

test('closing an SSH tab during startup does not leave a remote child behind', async () => {
  const started = deferred(), killed = [];
  const h = harness((cmd, args) => { if (cmd === 'ssh_start') return started.promise; if (cmd === 'term_kill') killed.push(args.id); return Promise.resolve(); });
  const job = h.run("newTermTab(null, { host: 'example.test', port: 22, user: 'dev' })");
  await tick(); h.context.tb = h.state.tabs[1]; h.run('killTerm(tb)');
  started.resolve(92); await job;
  assert.deepEqual(killed, [92]); assert.equal(h.state.tabs[1].term, null);
});

test('SSH Ctrl+C interrupts once despite selection and Ctrl+Shift+C copies without ETX input', async () => {
  const h = harness(async (command) => command === 'ssh_start' ? 10 : undefined); h.loadSsh();
  await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const target = h.state.tabs[1]; target.term.selection = 'selected terminal output';
  let prevented = 0, stopped = 0;
  const event = { type: 'keydown', key: 'c', ctrlKey: true, shiftKey: false, repeat: false, preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
  assert.equal(target.term.keyHandler(event), false);
  target.term.keyHandler({ ...event, type: 'keyup' }); target.term.keyHandler({ ...event, repeat: true });
  await tick();
  assert.equal(h.calls.filter((call) => call.command === 'term_interrupt').length, 1);
  assert.equal(h.calls.filter((call) => call.command === 'term_write').length, 0);
  target.term.keyHandler({ ...event, shiftKey: true }); await tick();
  assert.deepEqual(h.copied, ['selected terminal output']);
  assert.equal(h.calls.filter((call) => call.command === 'term_interrupt').length, 1);
  assert.equal(prevented, 4); assert.equal(stopped, 4);
});

test('same-tab SSH relogin keeps scrollback, changes identity, and rejects every stale event channel', async () => {
  let serial = 0;
  const h = harness(async (command) => command === 'ssh_start' ? ++serial : undefined); h.loadSsh();
  await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const target = h.state.tabs[1], terminal = target.term, host = target.el, key = target.key;
  terminal.write('old session output'); h.context.target = target;
  await h.run('reconnectSshTab(target)');
  assert.equal(h.state.tabs.length, 2); assert.equal(target.term, terminal); assert.equal(target.el, host);
  assert.notEqual(target.key, key); assert.equal(target.termId, 2);
  assert.match(terminal.output, /old session output.*New SSH login/s);
  const output = terminal.output;
  for (const stale of [{ key, id: 1 }, { key: target.key, id: 1 }]) {
    h.context.event = { payload: { ...stale, data: 'old output', exitCode: 1, info: { hostname: 'old-host' } } };
    h.run('onTermOutput(event); onTermClosed(event); onSshInfo(event)');
  }
  assert.equal(terminal.output, output); assert.equal(target.termId, 2); assert.equal(target.exited, false); assert.equal(target.sshInfo, null);
});

test('late failed writes cannot erase input or unlock the new SSH session writer after relogin', async () => {
  let serial = 0; const oldWrite = deferred(), newWrite = deferred();
  const h = harness(async (command, args) => {
    if (command === 'ssh_start') return ++serial;
    if (command === 'term_write') return args.id === 1 ? oldWrite.promise : newWrite.promise;
  }); h.loadSsh();
  await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const target = h.state.tabs[1]; h.context.target = target;
  target.term.input('old-password'); await tick();
  await h.run('reconnectSshTab(target)');
  target.term.input('new-one'); target.term.input('new-two'); await tick();
  oldWrite.reject(new Error('old pipe closed')); await tick();
  assert.equal(target.input, 'new-two'); assert.equal(target.writing, true); assert.equal(target.sshError, '');
  newWrite.resolve(); await tick();
  const writes = h.calls.filter((call) => call.command === 'term_write').map((call) => [call.args.id, call.args.data]);
  assert.deepEqual(writes, [[1, 'old-password'], [2, 'new-one'], [2, 'new-two']]);
});

test('kill failure keeps the live process recoverable and blocks a replacement SSH process', async () => {
  const h = harness(async (command) => {
    if (command === 'ssh_start') return 9;
    if (command === 'term_kill') throw new Error('could not terminate');
  }); h.loadSsh();
  await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const target = h.state.tabs[1]; h.context.target = target;
  assert.equal(await h.run('reconnectSshTab(target)'), false);
  assert.equal(target.termId, 9); assert.equal(target.exited, false); assert.equal(target.sshReconnecting, false);
  assert.equal(h.run('sshStatus(target)'), 'operationError');
  assert.equal(h.calls.filter((call) => call.command === 'ssh_start').length, 1);
  for (const action of ['interrupt', 'reconnect', 'edit', 'disconnect']) assert.match(target.sshBar.innerHTML, new RegExp(`data-ssh-action="${action}"[^>]*>`));
  await h.run('interruptSshTab(target)');
  assert.equal(h.calls.filter((call) => call.command === 'term_interrupt').length, 1);
});

test('startup cancellation shares cleanup of an early id and refuses duplicate relogin', async () => {
  const starting = deferred(), killing = deferred();
  const h = harness(async (command) => command === 'ssh_start' ? starting.promise : command === 'term_kill' ? killing.promise : undefined); h.loadSsh();
  const opening = h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })"); await tick();
  const target = h.state.tabs[1]; h.context.target = target;
  h.context.event = { payload: { id: 25, key: target.key, data: 'password prompt' } }; h.run('onTermOutput(event)');
  const closing = h.run('disconnectSshTab(target)'); await tick();
  assert.equal(await h.run('reconnectSshTab(target)'), false);
  target.term.input('must not carry over'); starting.resolve(25); await tick();
  assert.equal(h.calls.filter((call) => call.command === 'term_kill').length, 1);
  killing.resolve(); assert.equal(await closing, true); await opening;
  assert.equal(target.exited, true); assert.equal(target.termId, null); assert.equal(target.input, '');
  assert.equal(h.calls.filter((call) => call.command === 'term_write').length, 0);
});

test('interrupt queued during relogin drops old input while allowing terminal protocol replies', async () => {
  let serial = 0; const starting = deferred(), interrupting = deferred();
  const h = harness(async (command) => {
    if (command === 'ssh_start') return ++serial === 1 ? 1 : starting.promise;
    if (command === 'term_interrupt') return interrupting.promise;
  }); h.loadSsh();
  await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const target = h.state.tabs[1]; h.context.target = target;
  const relogin = h.run('reconnectSshTab(target)'); await tick();
  target.term.input('queued-password'); await h.run('interruptSshTab(target)'); await h.run('interruptSshTab(target)');
  assert.equal(target.input, ''); assert.equal(h.calls.filter((call) => call.command === 'term_interrupt').length, 0);
  starting.resolve(2); await tick();
  assert.equal(target.sshReconnecting, true); assert.equal(target.starting, false);
  target.term.input('\x1b[1;1R'); await tick();
  assert.deepEqual(h.calls.filter((call) => call.command === 'term_write').map((call) => [call.args.id, call.args.data]), [[2, '\x1b[1;1R']]);
  assert.equal(h.calls.filter((call) => call.command === 'term_interrupt').length, 1);
  interrupting.resolve(); await relogin;
});

test('Ctrl+C on an exited SSH session sends no IPC and focuses the relogin action', async () => {
  const h = harness(async (command) => command === 'ssh_start' ? 4 : undefined); h.loadSsh();
  await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const target = h.state.tabs[1]; h.context.target = target;
  let focused = false; target.sshBar.querySelector = () => ({ focus() { focused = true; } });
  h.context.event = { payload: { key: target.key, id: 4, exitCode: 1 } }; h.run('onTermClosed(event)');
  assert.equal(await h.run('interruptSshTab(target)'), false);
  assert.equal(h.calls.filter((call) => call.command === 'term_interrupt').length, 0);
  assert.match(target.sshActionMessage, /Session exited.*Log in again/); assert.equal(focused, true);
});

test('terminal initialization failures leave a recoverable SSH tab instead of an endless startup', async () => {
  const h = harness(async (command) => command === 'ssh_start' ? 11 : undefined); h.loadSsh();
  const Terminal = h.context.window.Terminal;
  h.context.window.Terminal = class { constructor() { throw new Error('terminal setup failed'); } };
  const target = await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })"); h.context.target = target;
  assert.equal(target.starting, false); assert.equal(target.exited, true); assert.match(target.sshBar.innerHTML, /terminal setup failed/);
  h.context.window.Terminal = Terminal;
  await h.run('reconnectSshTab(target)');
  assert.equal(h.state.tabs.length, 2); assert.equal(target.termId, 11); assert.equal(target.exited, false); assert.ok(target.term);
});

test('SSH relogin waits for a soft terminal reset and closing during that reset cannot start a process', async () => {
  let serial = 0;
  const h = harness(async (command) => command === 'ssh_start' ? ++serial : undefined); h.loadSsh();
  await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const target = h.state.tabs[1]; h.context.target = target;
  let parsed;
  target.term.write = (data, callback) => { target.term.output += data; if (callback) parsed = callback; };
  const relogin = h.run('reconnectSshTab(target)'); await tick();
  assert.match(target.term.output, /\x1b\[!p/); assert.match(target.term.output, /2004;1;66;9;1000;1002;1003;1004;1006;1015;1016l/);
  assert.equal(serial, 1, 'no process starts while the old terminal modes remain active');
  h.run('killTerm(target)'); await relogin;
  parsed(); await tick();
  assert.equal(serial, 1); assert.equal(target.disposed, true);
});

test('interrupt failure preserves a live SSH process and returns keyboard focus after updating its controls', async () => {
  const h = harness(async (command) => {
    if (command === 'ssh_start') return 18;
    if (command === 'term_write') throw new Error('write failed');
    if (command === 'term_interrupt') throw new Error('input writer is busy');
  }); h.loadSsh();
  await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const target = h.state.tabs[1]; h.context.target = target;
  target.term.input('typed input'); await tick();
  assert.equal(h.run('sshStatus(target)'), 'operationError');
  const focused = target.term.focusCount;
  assert.equal(await h.run('interruptSshTab(target)'), false);
  assert.equal(target.exited, false); assert.equal(target.termId, 18);
  assert.ok(target.term.focusCount > focused); assert.match(target.sshActionMessage, /writer is busy.*force disconnect/);
  for (const action of ['interrupt', 'reconnect', 'edit', 'disconnect']) {
    const markup = target.sshBar.innerHTML.match(new RegExp(`<button[^>]*data-ssh-action="${action}"[^>]*>`))[0];
    assert.doesNotMatch(markup, /disabled/);
  }
});

test('failed SSH tab closure retains its recovery controls until a successful retry', async () => {
  let failure = true;
  const h = harness(async (command) => {
    if (command === 'ssh_start') return 81;
    if (command === 'term_kill' && failure) throw new Error('kill denied; session retained');
  }); h.loadSsh();
  const target = await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })");
  const terminal = target.term;
  assert.equal(await h.run('closeTab(1)'), false);
  assert.equal(h.state.tabs[1], target); assert.equal(target.disposed, false); assert.equal(target.termId, 81); assert.equal(target.term, terminal);
  assert.match(target.sshBar.innerHTML, /kill denied/);
  failure = false;
  assert.equal(await h.run('closeTab(1)'), true);
  assert.equal(h.state.tabs.length, 1); assert.equal(target.disposed, true); assert.equal(target.term, null);
});

test('closing an SSH startup retains a late process if cleanup fails and removes it only after retry', async () => {
  const starting = deferred(); let failure = true;
  const h = harness(async (command) => {
    if (command === 'ssh_start') return starting.promise;
    if (command === 'term_kill' && failure) throw new Error('late cleanup denied');
  }); h.loadSsh();
  const opening = h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })"); await tick();
  const target = h.state.tabs[1], closing = h.run('closeTab(1)');
  assert.equal(h.state.tabs.length, 2); assert.equal(target.disposed, false);
  starting.resolve(82); await opening; assert.equal(await closing, false);
  assert.equal(h.state.tabs[1], target); assert.equal(target.termId, 82); assert.equal(target.exited, false); assert.equal(target.starting, false);
  failure = false; await h.run('closeTab(1)');
  assert.equal(h.state.tabs.length, 1); assert.equal(target.disposed, true);
});

test('close other tabs preserves failed SSH processes while removing successfully stopped sessions', async () => {
  let serial = 0;
  const h = harness(async (command, args) => {
    if (command === 'ssh_start') return ++serial;
    if (command === 'term_kill' && args.id === 1) throw new Error('first process could not stop');
  }); h.loadSsh();
  await h.run("newTermTab(null, { host: 'one.example', user: 'dev', port: 22 })");
  await h.run("newTermTab(null, { host: 'two.example', user: 'dev', port: 22 })");
  const first = h.state.tabs[1], second = h.state.tabs[2];
  await h.run('closeOtherTabs(0)');
  assert.equal(h.state.tabs.length, 2); assert.equal(h.state.tabs[1], first); assert.equal(first.termId, 1); assert.equal(first.disposed, false);
  assert.equal(second.disposed, true); assert.equal(h.state.tab, 0);
});

test('Ctrl+C preserves standard and DEC cursor replies already queued behind a busy write', async () => {
  const writing = deferred();
  const h = harness(async (command, args) => {
    if (command === 'ssh_start') return 83;
    if (command === 'term_write' && args.data === 'in-flight user input') return writing.promise;
    if (command === 'term_interrupt') throw new Error('writer busy');
  }); h.loadSsh();
  const target = await h.run("newTermTab(null, { host: 'server.example', user: 'dev', port: 22 })"); h.context.target = target;
  target.term.input('in-flight user input'); target.term.input('discarded password\x1b[1;1Rdiscarded command\x1b[?25;80R'); await tick();
  await h.run('interruptSshTab(target)');
  assert.equal(target.input, '\x1b[1;1R\x1b[?25;80R');
  writing.resolve(); await tick();
  assert.deepEqual(h.calls.filter((call) => call.command === 'term_write').map((call) => call.args.data), ['in-flight user input', '\x1b[1;1R\x1b[?25;80R']);
});

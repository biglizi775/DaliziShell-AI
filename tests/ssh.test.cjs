const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../ui/ssh.js'), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const tick = () => new Promise(setImmediate);
const config = (extra = {}) => ({ host: 'server.example', port: 22, user: 'ubuntu', identityFile: '', infoMode: 'posix', label: 'Development', ...extra });
const tab = (extra = {}) => ({ kind: 'term', connection: 'ssh', key: 'connection-one', termId: 7, sshConfig: config(), starting: false, exited: false, disposed: false, input: '', ...extra });
function harness(options = {}) {
  const fields = new Map(), calls = [], saved = [], opened = [], restarted = [], listeners = [], notices = [], copied = [], workspaceUpdates = [];
  let serial = 0;
  const element = () => ({ value: '', checked: false, disabled: false, hidden: false, open: false, innerHTML: '', textContent: '', attrs: {}, handlers: {}, firstChild: null, classList: { add() {}, toggle() {} }, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(type, fn) { this.handlers[type] = fn; }, querySelectorAll() { return []; }, insertBefore(child) { this.inserted = child; }, focus() { this.focused = true; }, showModal() { this.open = true; }, close() { this.open = false; } });
  const get = (id) => { if (!fields.has(id)) fields.set(id, element()); return fields.get(id); };
  const context = vm.createContext({
    locale: 'en', URL, console, $: get, crypto: { randomUUID: () => 'ssh-id-' + ++serial },
    esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    store: { get: (_key, fallback) => options.profiles || fallback, set: (key, value) => saved.push({ key, value }) },
    invoke: async (cmd, args) => { calls.push({ cmd, args }); return options.invoke ? options.invoke(cmd, args) : { available: true, path: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe', version: 'OpenSSH_for_Windows' }; },
    listen: (name, fn) => { listeners.push({ name, fn }); return options.listen ? options.listen(name, fn) : Promise.resolve(() => {}); },
    newTermTab: async (cwd, config) => { opened.push({ cwd, config }); return options.start ? options.start(cwd, config) : 'new-tab-result'; },
    restartSshTermSession: async (target) => { restarted.push({ target, config: { ...target.sshConfig } }); target.key = 'restarted-' + ++serial; target.exited = false; return target; },
    document: { body: { appendChild() {} }, createElement: element },
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    state: { tabs: [], tab: 0 }, curTab: () => context.state.tabs[context.state.tab], renderTabs() {}, fitTerm() {}, renderCrumbs: () => workspaceUpdates.push('crumbs'), renderStatus: () => workspaceUpdates.push('status'), toast: (...values) => notices.push(values),
  });
  vm.runInContext(source, context);
  const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('function stopTermProcess('), app.indexOf('function startTermSession(')), context);
  return { context, get, element, calls, saved, opened, restarted, listeners, notices, copied, workspaceUpdates, run: (code) => vm.runInContext(code, context) };
}

test('connection validation bounds addresses, users, ports and paths before creating a terminal', async () => {
  const h = harness(); h.context.value = config();
  assert.deepEqual(Object.keys(h.run('validateSshConfig(value).errors')), []);
  for (const [key, value] of [['host', '-oProxyCommand=bad'], ['host', 'ssh://server'], ['host', 'user@host'], ['host', 'server:22'], ['host', 'server;whoami'], ['host', 'server\nother'], ['user', '-oCommand'], ['user', 'name;bad'], ['user', '.hidden'], ['user', 'a'.repeat(65)], ['port', 0], ['port', 65536], ['port', 22.5], ['identityFile', 'C:\\key\nsecret'], ['identityFile', 'C:\\%h\\key'], ['identityFile', 'relative-key'], ['identityFile', 'C:\\key:stream'], ['infoMode', 'custom']]) {
    h.context.value = config({ [key]: value });
    assert.ok(Object.keys(h.run('validateSshConfig(value).errors')).length, key + '=' + value);
    await assert.rejects(h.run('newSshTab(value)'));
  }
  assert.equal(h.opened.length, 0); assert.equal(h.listeners.length, 0);
  h.context.value = config({ host: '[2001:db8::1]', port: '2222' });
  assert.equal(h.run('validateSshConfig(value).config.host'), '2001:db8::1');
  assert.equal(h.run('sshAddress(value)'), 'ubuntu@[2001:db8::1]:2222');
  h.context.value = config({ host: 'server.example.', user: '_service' });
  assert.deepEqual(Object.keys(h.run('validateSshConfig(value).errors')), []);
});

test('saved profiles whitelist connection metadata and never retain credentials, key contents or unknown fields', () => {
  const h = harness({ profiles: [{ id: 'saved-1', ...config(), password: 'old-password', apiKey: 'secret-api' }, { host: 'bad;command' }] });
  h.run('readSshProfiles()'); assert.equal(h.run('sshProfiles.length'), 1);
  h.context.value = config({ keyPath: 'C:\\keys\\id_ed25519', identityFile: undefined, password: 'password-secret', privateKey: 'BEGIN PRIVATE KEY', passphrase: 'passphrase-secret', command: 'run-me' });
  h.run('saveSshProfile(value, null)');
  const profile = h.saved.at(-1).value[0];
  assert.deepEqual(Object.keys(profile).sort(), ['host', 'id', 'infoMode', 'keyPath', 'label', 'port', 'user']);
  assert.equal(profile.keyPath, 'C:\\keys\\id_ed25519');
  assert.doesNotMatch(JSON.stringify(h.saved), /password|secret|PRIVATE KEY|passphrase|run-me|command/);
});

test('the SSH info listener is established before starting and newSshTab returns the terminal result', async () => {
  const ready = deferred(), h = harness({ listen: () => ready.promise });
  h.context.value = config();
  const job = h.run('newSshTab(value)');
  assert.equal(h.listeners.length, 1); assert.equal(h.listeners[0].name, 'ssh-info'); assert.equal(h.opened.length, 0);
  ready.resolve(() => {}); assert.equal(await job, 'new-tab-result');
  assert.equal(h.opened[0].cwd, null); assert.equal(h.opened[0].config.host, 'server.example');
  await h.run('newSshTab(value)'); assert.equal(h.listeners.length, 1);
});

test('failed event registration does not start a terminal and can be retried', async () => {
  let attempts = 0;
  const h = harness({ listen: () => ++attempts === 1 ? Promise.reject(new Error('ACL denied')) : Promise.resolve(() => {}) }); h.context.value = config();
  await assert.rejects(h.run('newSshTab(value)'), /ACL denied/); assert.equal(h.opened.length, 0);
  await h.run('newSshTab(value)'); assert.equal(h.opened.length, 1); assert.equal(attempts, 2);
});

test('info events belong to their connection key and id, including events preceding startup completion', () => {
  const h = harness(), first = tab({ termId: null, starting: true }), second = tab({ key: 'connection-two', termId: 8 });
  h.context.state.tabs = [first, second];
  h.context.event = { payload: { id: 7, key: 'connection-one', info: { hostname: 'first-server', os: 'Ubuntu', serverIp: '10.0.0.1' } } };
  h.run('onSshInfo(event)'); assert.equal(first.termId, 7); assert.equal(first.sshInfo.hostname, 'first-server'); assert.equal(second.sshInfo, undefined);
  h.context.event.payload.info.hostname = 'replacement'; h.run('onSshInfo(event)'); assert.equal(first.sshInfo.hostname, 'first-server', 'only the first bootstrap is accepted');
  h.context.event.payload.key = 'connection-two'; h.run('onSshInfo(event)'); assert.equal(second.sshInfo, undefined, 'wrong terminal id is rejected');
});

test('late info cannot mark a closed, disconnected or shell-mode tab as connected', () => {
  for (const state of [{ disposed: true }, { exited: true }, { sshDisconnectRequested: true }, { sshConfig: config({ infoMode: 'shell' }) }, { termId: null, starting: false }]) {
    const h = harness(), target = tab(state); h.context.state.tabs = [target];
    h.context.event = { payload: { id: 7, key: target.key, info: { hostname: 'late' } } }; h.run('onSshInfo(event)');
    assert.equal(target.sshInfo, undefined, JSON.stringify(state));
  }
});

test('status never treats spawn as authenticated and remote information is escaped as text', () => {
  const h = harness(); h.context.target = tab({ sshBar: h.element(), sshDetailsOpen: true });
  assert.equal(h.run('sshStatus(target)'), 'authenticating');
  assert.equal(h.run('sshServerIp(target)'), '—', 'a hostname is not presented as a known server IP');
  h.context.target.sshConfig.infoMode = 'shell'; assert.equal(h.run('sshStatus(target)'), 'sessionStarted');
  h.context.target.sshConfig.infoMode = 'posix'; h.context.target.starting = true; assert.equal(h.run('sshStatus(target)'), 'connecting');
  h.context.target.sshInfo = { hostname: '<img onerror="bad">', os: '<script>evil</script>', serverIp: '10.0.0.2', uptime: '3 days' };
  h.run('syncSshInfo(target)'); assert.equal(h.run('sshStatus(target)'), 'connected');
  assert.match(h.context.target.sshBar.innerHTML, /&lt;script>/); assert.match(h.context.target.sshBar.innerHTML, /&lt;img/);
  assert.doesNotMatch(h.context.target.sshBar.innerHTML, /<script>|<img/);
  h.context.target.exited = true; assert.equal(h.run('sshStatus(target)'), 'disconnected');
});

test('disconnect sends one kill and preserves the tab DOM and terminal output', async () => {
  const waiting = deferred(), h = harness({ invoke: () => waiting.promise });
  const target = tab({ term: { sentinel: true }, el: h.element(), input: 'queued text' }); h.context.target = target;
  const job = h.run('disconnectSshTab(target)'); const repeated = h.run('disconnectSshTab(target)'); await tick();
  assert.equal(repeated, job);
  assert.equal(target.sshDisconnectRequested, true); assert.equal(target.input, ''); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].args.id, 7);
  waiting.resolve(); await job;
  assert.equal(target.exited, true); assert.equal(target.termId, null); assert.equal(target.disposed, false); assert.equal(target.term.sentinel, true); assert.ok(target.el);
});

test('disconnect during startup marks the tab for killing a late-created process', async () => {
  const h = harness(); h.context.target = tab({ termId: null, starting: true });
  await h.run('disconnectSshTab(target)');
  assert.equal(h.context.target.sshDisconnectRequested, true); assert.equal(h.context.target.exited, true); assert.equal(h.calls.length, 0);
});

test('relogin waits for old disconnect and restarts the same tab without credentials', async () => {
  const waiting = deferred(), h = harness({ invoke: () => waiting.promise });
  h.context.target = tab({ sshConfig: config({ password: 'secret' }) });
  const job = h.run('reconnectSshTab(target)'); await h.run('reconnectSshTab(target)');
  assert.equal(h.opened.length, 0); waiting.resolve(); await job;
  assert.equal(h.opened.length, 0); assert.equal(h.restarted.length, 1); assert.equal(h.context.target.exited, false); assert.equal(h.context.target.disposed, false);
  assert.equal(h.restarted[0].target, h.context.target);
  assert.doesNotMatch(JSON.stringify(h.restarted[0].config), /secret|password/);
});

test('copy address only writes a plain connection address to the clipboard', async () => {
  const h = harness(); h.context.target = tab({ sshConfig: config({ host: '2001:db8::1', port: 2222 }) });
  await h.run('copySshAddress(target)');
  assert.deepEqual(h.copied, ['ubuntu@[2001:db8::1]:2222']); assert.equal(h.calls.length, 0); assert.equal(h.opened.length, 0);
});

test('missing OpenSSH shows manual installation guidance and blocks connect without running installation commands', async () => {
  const h = harness({ invoke: async () => ({ available: false, path: null, version: null }) });
  h.run('openSshConnect()'); await tick();
  assert.equal(h.get('sshConnect').disabled, true); assert.match(h.get('sshClientStatus').innerHTML, /Optional features/);
  assert.match(h.get('sshClientStatus').innerHTML, /data-ssh-dialog="check"/);
  assert.deepEqual(h.calls.map((call) => call.cmd), ['ssh_check_client']); assert.equal(h.saved.length, 0); assert.equal(h.opened.length, 0);
});

test('opening and saving a connection cannot start SSH, and form errors prevent saving', async () => {
  const h = harness(); h.run('openSshConnect()'); await tick();
  assert.equal(await h.run('submitSshForm(false)'), false); assert.equal(h.get('sshHost').attrs['aria-invalid'], 'true'); assert.equal(h.saved.length, 0);
  h.get('sshHost').value = 'server.example'; h.get('sshUser').value = 'ubuntu'; h.get('sshPort').value = '2222'; h.get('sshMode').value = 'shell';
  assert.equal(await h.run('submitSshForm(false)'), true);
  assert.equal(h.saved.length, 1); assert.equal(h.opened.length, 0); assert.equal(h.calls.some((call) => call.cmd === 'ssh_start'), false);
  assert.equal(h.saved[0].value[0].infoMode, 'shell');
});

test('editing a field clears its shown error without exposing untouched required fields', async () => {
  const h = harness(); h.run('openSshConnect()'); await tick();
  h.get('sshHost').value = 'bad;host';
  h.run("refreshSshFieldValidation({target:{id:'sshHost'}})");
  assert.equal(h.get('sshHostError').hidden, true); assert.equal(h.get('sshUserError').hidden, true);
  h.get('sshUser').value = 'ubuntu';
  assert.equal(await h.run('submitSshForm(false)'), false); assert.equal(h.get('sshHost').attrs['aria-invalid'], 'true');
  h.get('sshUser').value = '';
  h.get('sshHost').value = '192.0.2.10';
  h.run("refreshSshFieldValidation({target:{id:'sshHost'}})");
  assert.equal(h.get('sshHost').attrs['aria-invalid'], 'false'); assert.equal(h.get('sshHostError').hidden, true);
  assert.equal(h.get('sshUserError').hidden, true, 'other fields are not newly marked invalid while correcting the host');
  h.get('sshHost').value = 'bad;again'; h.run("refreshSshFieldValidation({target:{id:'sshHost'}})");
  assert.equal(h.get('sshHostError').hidden, false, 'previously validated fields keep live feedback');
});

test('SSH state changes refresh only the active tab breadcrumb and status', () => {
  const h = harness(), first = tab({ sshBar: h.element() }), second = tab({ key: 'second', sshBar: h.element() });
  h.context.state.tabs = [first, second]; h.context.target = second;
  h.run('syncSshInfo(target)'); assert.deepEqual(h.workspaceUpdates, []);
  h.context.target = first; h.run('syncSshInfo(target)'); assert.deepEqual(h.workspaceUpdates, ['crumbs', 'status']);
  assert.equal(h.get('pageTitle').textContent, h.run('sshTabTitle(target)'));
  first.exited = true; h.run('syncSshInfo(target)'); assert.deepEqual(h.workspaceUpdates, ['crumbs', 'status', 'crumbs', 'status']);
  assert.equal(h.get('pageTitle').textContent, h.run('sshTabTitle(target)'));
});

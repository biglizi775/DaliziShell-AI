// Real built app + generated loopback SSH/SFTP server; never a real remote host.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const readline = require('node:readline');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'src-tauri/target');
const output = fs.mkdtempSync(path.join(target, 'ssh-managed-smoke-'));
const exe = path.join(output, 'DaliziFiles.exe');
fs.copyFileSync(process.env.DALIZI_EXE || path.join(target, 'debug/dalizi-files.exe'), exe);
const fixture = spawn(process.env.DALIZI_PYTHON || 'python', ['-u', path.join(__dirname, 'ssh_managed_fixture.py'), output], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let fixtureError = ''; fixture.stderr.on('data', data => { fixtureError += data.toString(); });
const messages = [], waiting = [];
readline.createInterface({ input: fixture.stdout }).on('line', line => { const value = JSON.parse(line); const waiter = waiting.shift(); if (waiter) waiter(value); else messages.push(value); });
const nextMessage = () => messages.length ? Promise.resolve(messages.shift()) : Promise.race([new Promise(resolve => waiting.push(resolve)), new Promise((_, reject) => setTimeout(() => reject(new Error('SSH fixture timeout: ' + fixtureError)), 30000).unref())]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
(async () => {
  let app, browser, page;
  try {
    const data = await nextMessage(), port = await freePort();
    app = spawn(exe, [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } });
    let endpoint;
    for (let i = 0; i < 100; i++) { try { endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()); break; } catch { await delay(200); } }
    assert.ok(endpoint, 'Built app exposes its isolated test WebView');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
    assert.ok(page, 'Main app page exists');
    await page.waitForFunction(() => typeof ensureManagedSshEvents === 'function' && window.__TAURI__?.core);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
    await page.evaluate(async () => {
      window.fixtureEvents = [];
      for (const name of ['term-out', 'term-closed', 'ssh-managed-state', 'ssh-transfer']) await window.__TAURI__.event.listen(name, event => window.fixtureEvents.push({ ...event.payload, name }));
    });
    const config = { host: '127.0.0.1', port: data.port, user: 'fixture', identityFile: null, infoMode: 'posix' };
    const probe = await invoke('ssh_probe_host', { config });
    assert.equal(probe.previous, null, 'The generated endpoint must have no existing trust entry');
    fixture.stdin.write('allow-cleanup\n');
    assert.equal(probe.fingerprint, data.fingerprint); assert.equal(probe.trusted, false);
    await assert.rejects(invoke('ssh_managed_start', { key: 'untrusted', config, auth: { secret: data.password, remember: true }, cols: 80, rows: 24 }), /指纹|fingerprint/);
    await page.evaluate(({ config, probe }) => { window.hostAnswer = null; void confirmManagedHost(config, probe).then(answer => { window.hostAnswer = answer; }); }, { config, probe });
    assert.equal(await page.locator('.ssh-host-confirm [data-trust]').isDisabled(), true);
    await page.locator('.ssh-host-confirm [data-cancel]').click();
    assert.equal(await page.evaluate(() => window.hostAnswer), false);
    await page.evaluate(({ config, probe }) => { window.hostAnswer = null; void confirmManagedHost(config, probe).then(answer => { window.hostAnswer = answer; }); }, { config, probe });
    await page.locator('.ssh-host-confirm input').check();
    await page.locator('.ssh-host-confirm [data-trust]').click();
    assert.equal(await page.evaluate(() => window.hostAnswer), true);
    await invoke('ssh_trust_host', { token: probe.token });
    await assert.rejects(invoke('ssh_managed_start', { key: 'wrong', config, auth: { secret: 'wrong-fixture-password', remember: true }, cols: 80, rows: 24 }), /认证失败|Authentication failed/);
    assert.equal((await invoke('ssh_probe_host', { config })).hasCredential, false);
    console.log('Host trust and rejected-password persistence: passed');
    // Exercise the real form, including password clearing and metadata-only profiles.
    await page.evaluate(config => openSshConnect({ ...config, identityFile: '', managed: true, label: 'Loopback fixture' }), config);
    await page.locator('#sshPassword').fill(data.password);
    await page.locator('#sshConnect').click();
    await page.waitForFunction(() => state.tabs.some(tb => tb.sshConfig?.managed && tb.sshAuthenticated && !tb.exited), { timeout: 20000 });
    const id = await page.evaluate(() => curTab().termId);
    assert.ok(id >= 0x80000000);
    assert.equal((await invoke('ssh_probe_host', { config })).hasCredential, true);
    assert.equal(await page.evaluate(secret => JSON.stringify(localStorage).includes(secret), data.password), false);
    assert.equal(await page.locator('#sshPassword').inputValue(), '');
    assert.equal(await page.evaluate(() => store.get('sshConnections', []).some(p => p.managed)), true);
    const info = await invoke('ssh_managed_stats', { id });
    assert.equal(info.memoryTotalKiB, '8388608'); assert.equal(info.diskTotalKiB, '104857600');
    console.log('Native login, protected password and resource stats: passed');
    await page.waitForFunction(() => curTab().sshTerminalState === 'ready');
    await invoke('term_write', { id, data: 'hello\r' });
    await page.waitForFunction(id => fixtureEvents.some(e => e.name === 'term-out' && e.id === id && e.data.includes('fixture input: hello')), id);
    await invoke('term_interrupt', { id });
    await page.waitForFunction(id => fixtureEvents.some(e => e.name === 'term-out' && e.id === id && e.data.includes('fixture interrupted')), id);
    await invoke('term_resize', { id, cols: 100, rows: 32 });
    await page.waitForFunction(() => curTab().sshFiles?.entries.some(e => e.name === '中文.txt'));
    const filesPanel = page.locator('.term.ssh-terminal-host:visible .ssh-files');
    assert.equal(await filesPanel.isVisible(), true, 'login automatically exposes the real SFTP directory');
    assert.equal(await filesPanel.locator('[data-upload]').isEnabled(), true);
    await filesPanel.locator('.ssh-file-row').filter({ hasText: '中文.txt' }).click();
    assert.equal(await filesPanel.locator('[data-download]').isEnabled(), true);
    await filesPanel.locator('[data-close]').click();
    await page.locator('.term.ssh-terminal-host:visible [data-ssh-files]').click();
    assert.equal(await filesPanel.isVisible(), true);
    await filesPanel.locator('[data-path]').click(); await page.keyboard.press('Control+A'); await page.keyboard.type('/'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => curTab().sshFiles?.path === '/' && curTab().sshFiles?.ready);
    const listing = await invoke('ssh_files_list', { id, path: '/large' });
    assert.equal(listing.entries.length, 5000); assert.equal(listing.truncated, true);
    console.log('PTY input/interrupt and bounded SFTP browsing: passed');
    const upload = path.join(output, "literal & quote'.txt"), download = path.join(output, 'download.txt');
    const contents = Buffer.from('SFTP 内容\nliteral $() ; & are data\n'.repeat(4000)); fs.writeFileSync(upload, contents);
    const waitTransfer = async token => {
      await page.waitForFunction(token => fixtureEvents.some(e => e.name === 'ssh-transfer' && e.transferId === token && ['complete', 'failed', 'cancelled'].includes(e.status)), token, { timeout: 30000 });
      return page.evaluate(token => fixtureEvents.findLast(e => e.name === 'ssh-transfer' && e.transferId === token), token);
    };
    const uploadToken = await invoke('ssh_file_transfer', { id, direction: 'upload', localPath: upload, remote: '/' });
    assert.equal((await waitTransfer(uploadToken)).status, 'complete');
    assert.deepEqual(fs.readFileSync(path.join(data.root, path.basename(upload))), contents);
    const downloadToken = await invoke('ssh_file_transfer', { id, direction: 'download', localPath: download, remote: '/' + path.basename(upload) });
    assert.equal((await waitTransfer(downloadToken)).status, 'complete'); assert.deepEqual(fs.readFileSync(download), contents);
    const conflict = await invoke('ssh_file_transfer', { id, direction: 'download', localPath: download, remote: '/中文.txt' });
    assert.equal((await waitTransfer(conflict)).status, 'failed'); assert.deepEqual(fs.readFileSync(download), contents);
    const uploadConflict = await invoke('ssh_file_transfer', { id, direction: 'upload', localPath: upload, remote: '/' });
    assert.equal((await waitTransfer(uploadConflict)).status, 'failed');
    const cancelled = await invoke('ssh_file_transfer', { id, direction: 'download', localPath: path.join(output, 'cancelled.bin'), remote: '/slow.bin' });
    await page.waitForFunction(token => fixtureEvents.some(e => e.name === 'ssh-transfer' && e.transferId === token && e.bytes > 0), cancelled);
    await invoke('ssh_transfer_cancel', { id, transferId: cancelled });
    assert.equal((await waitTransfer(cancelled)).status, 'cancelled'); assert.equal(fs.existsSync(path.join(output, 'cancelled.bin')), false);
    assert.equal(fs.readdirSync(output).some(name => name.endsWith('.part')), false);
    await require('./ssh_transfer_queue_native.cjs')({ page, invoke, id, output, remoteRoot: data.root });
    await require('./ssh_tree_resume_native.cjs')({ page, invoke, output, remoteRoot: data.root });
    // A fresh native login retrieves the protected credential without a password field.
    await page.evaluate(() => reconnectSshTab(curTab()));
    const newId = await page.evaluate(() => curTab().termId); assert.notEqual(newId, id);
    await assert.rejects(invoke('ssh_files_list', { id, path: '/' }), /session|会话/);
    assert.equal((await invoke('ssh_files_list', { id: newId, path: '/' })).entries.some(e => e.name === '中文.txt'), true);
    const windowsId = await invoke('ssh_managed_start', { key: 'windows-fixture', config: { ...config, infoMode: 'windows' }, auth: { useSaved: true }, cols: 80, rows: 24 });
    assert.equal((await invoke('ssh_managed_stats', { id: windowsId })).os, 'Windows fixture'); await invoke('term_kill', { id: windowsId });
    const keyConfig = { ...config, identityFile: data.identity };
    const keyId = await invoke('ssh_managed_start', { key: 'key-fixture', config: keyConfig, auth: { secret: data.passphrase, remember: true }, cols: 80, rows: 24 });
    assert.equal((await invoke('ssh_probe_host', { config: keyConfig })).hasCredential, true); await invoke('term_kill', { id: keyId });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => { if (!curTab().sshFilesPanel) toggleSshFiles(curTab()); });
    await page.waitForFunction(() => curTab().sshFiles?.entries.length > 0);
    await page.screenshot({ path: path.join(output, 'ssh-workspace.png') });
    await page.setViewportSize({ width: 960, height: 560 });
    await page.screenshot({ path: path.join(output, 'ssh-workspace-small.png') });
    assert.equal(await page.locator('.term.ssh-terminal-host:visible .term-terminal-viewport').isVisible(), true, 'terminal and remote files are both visible after login');
    assert.ok(await page.evaluate(() => curTab().termViewport.getBoundingClientRect().height >= 80), 'Small window keeps the terminal usable');
    await page.evaluate(() => disconnectSshTab(curTab()));
    await require('./ssh_sftp_only_native.cjs')({ page, invoke, config, fixture, nextMessage, waitTransfer, output, remoteRoot: data.root });
    fixture.stdin.write('rotate\n'); const rotated = await nextMessage();
    const changed = await invoke('ssh_probe_host', { config }); assert.equal(changed.trusted, false); assert.equal(changed.hasCredential, false); assert.equal(changed.previous, data.fingerprint);
    await assert.rejects(invoke('ssh_managed_start', { key: 'changed-host', config, auth: { useSaved: true }, cols: 80, rows: 24 }), /握手失败|handshake failed/);
    fixture.stdin.write('auth-count\n'); assert.equal((await nextMessage()).authAttempts, rotated.authAttempts, 'Changed host receives no saved credentials');
    await invoke('ssh_forget_credential', { config }); assert.equal((await invoke('ssh_probe_host', { config })).hasCredential, false);
    assert.deepEqual(errors, []);
    console.log('Native SSH: trust, failed-auth storage, protected credentials, reconnect, PTY interrupt/resize, Linux/Windows stats, private keys, bounded SFTP, transfers/conflicts/cancel and host-key rotation passed.');
    console.log('Test artifacts: ' + path.basename(output));
  } catch (error) {
    if (page) {
      try {
        const diagnostic = await page.evaluate(() => ({ events: window.fixtureEvents, error: curTab()?.sshError, status: curTab()?.sshTransfer }));
        fs.writeFileSync(path.join(output, 'diagnostic.json'), JSON.stringify(diagnostic, null, 2));
        console.error('Last transfer events:', JSON.stringify(diagnostic.events?.filter(e => e.name === 'ssh-transfer').slice(-3)));
      } catch {}
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (app && app.exitCode == null) {
      try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch {}
      for (let i = 0; i < 50 && app.exitCode == null; i++) await delay(100);
      if (app.exitCode == null) app.kill();
    }
    fixture.stdin.end('stop\n');
    for (let i = 0; i < 50 && fixture.exitCode == null; i++) await delay(100);
    if (fixture.exitCode == null) fixture.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

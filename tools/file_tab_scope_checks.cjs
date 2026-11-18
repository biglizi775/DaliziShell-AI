'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);

module.exports = async function checkFileTabScope({getPage, dir, a, b, until, app, close, launch}) {
  let page = getPage();
  const hasCreateCommand = () => page.evaluate(() => {
    openCommands();
    const hasCommand = commandItems.some(item => item.title === t('newFolderHere'));
    $('commandDialog').close();
    return hasCommand;
  });
  const currentPath = () => page.evaluate(() => curTab().path);
  const openFileTab = () => page.locator('#tabNew').click();
  await page.evaluate(async dir => { setLocale('en'); await navigate(dir); }, a);
  assert.equal(await hasCreateCommand(), true);
  await page.evaluate(() => newBrowserTab('about:blank').then(() => null));
  assert.equal(await hasCreateCommand(), false, 'browser commands must not create folders in the last file tab');
  assert.equal(await page.evaluate(() => state.path), null);
  await openFileTab();
  await page.waitForFunction(() => !state.loading);
  assert.equal(await currentPath(), null, 'new local tab from a website opens This PC');
  await page.evaluate(async dir => { await navigate(dir); await newTermTab(dir); }, b);
  await page.evaluate(() => switchTab(0));
  await page.waitForFunction(() => !state.loading);
  await page.evaluate(() => switchTab(3));
  await openFileTab();
  await page.waitForFunction(() => !state.loading);
  assert.equal(await currentPath(), b, 'PowerShell owns its starting folder');
  const missing = path.join(a, 'temporarily-absent');
  await page.evaluate(dir => navigate(dir), missing);
  assert.equal(await currentPath(), missing, 'failed folder keeps its address for retry');
  assert.equal(await hasCreateCommand(), false);
  assert.equal(await page.locator('#btnNew').isDisabled(), true);
  const saved = await page.evaluate(() => store.get('workspaceSession', null));
  assert.deepEqual(saved.tabs[saved.active], { kind: 'files', path: missing });
  await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'if (!(Get-Process -Id ' + app.pid + ').CloseMainWindow()) { exit 1 }'], { windowsHide: true, timeout: 10000 });
  await until(() => app.exitCode !== null);
  assert.equal(app.exitCode, 0);
  await close(); await launch(); page = getPage();
  assert.equal(await currentPath(), missing);
  await page.locator('#btnRetry').waitFor();
  await fs.mkdir(missing);
  await page.locator('#btnRetry').click();
  await until(() => page.evaluate(() => !state.loading && !state.error));
  assert.equal(await currentPath(), missing);
  assert.equal(await page.evaluate(() => curTab().history.length), 1);
  await page.locator('#btnNew').click();
  await page.waitForFunction(() => !!state.renaming);
  assert.ok((await fs.stat(path.join(missing, 'New folder'))).isDirectory());
  assert.deepEqual(await fs.readdir(b), []);
  await page.locator('input.rn').press('Escape');
  await page.locator('#btnDualPane').click();
  await page.waitForFunction(() => !!companionFor()?.entries.length && !companionFor().loading);
  const right = page.locator('#companionPane'), absentRight = path.join(b, 'companion');
  await right.locator('[data-path]').fill(absentRight);
  await right.locator('[data-path]').press('Enter');
  await page.waitForFunction(() => !!companionFor()?.error);
  assert.equal(await right.locator('.pane-file').count(), 0);
  assert.equal(await right.locator('[data-to-right]').isDisabled(), true);
  await fs.mkdir(absentRight);
  await fs.writeFile(path.join(absentRight, 'right-only.txt'), 'fixture');
  await right.locator('[data-refresh]').click();
  await right.locator('.pane-file').filter({hasText: 'right-only.txt'}).waitFor();
  assert.equal(await currentPath(), missing, 'the companion pane does not move the main folder');
  await page.evaluate(() => openPendingTerminalTab({kind:'ssh', profileId:null}));
  assert.match(await page.title(), /^SSH/);
  await openFileTab();
  await page.waitForFunction(() => !state.loading);
  assert.equal(await currentPath(), null);
  await page.locator('#tabViewport [data-t="3"].tab').click({button:'right'});
  await page.locator('[data-mid=newb]').click();
  await page.waitForFunction(() => !state.loading);
  assert.equal(await currentPath(), b, 'background tab context menu uses the clicked local terminal');
  await page.locator('#tabViewport [data-t="1"].tab').click({button:'right'});
  await page.locator('[data-mid=term]').click();
  await page.waitForFunction(() => curTab().termId != null && !curTab().starting);
  assert.equal(await page.evaluate(() => curTab().cwd), null, 'background web tab has no local shell directory');
  // Exercise host death with one real shell and one independently launched
  // child program. All marker files belong to this disposable fixture.
  const marker = name => path.join(dir, name);
  const started = marker('child-ready'), release = marker('host-gone'), finished = marker('child-finished');
  const childScript = marker('independent.cjs'), shellPidFile = marker('shell.pid');
  await fs.writeFile(childScript, [
    "const fs = require('node:fs');",
    'fs.writeFileSync(' + JSON.stringify(started) + ', "ready");',
    'const poll = setInterval(() => { if (fs.existsSync(' + JSON.stringify(release) + ')) {',
    'fs.writeFileSync(' + JSON.stringify(finished) + ', "ok"); clearInterval(poll); } }, 50);',
    'setTimeout(() => clearInterval(poll), 20000).unref();',
  ].join('\n'));
  const psString = value => "'" + value.replaceAll("'", "''") + "'";
  const command = 'Set-Content -LiteralPath ' + psString(shellPidFile) + ' -Encoding ascii -Value $PID; ' +
    'Start-Process -WindowStyle Hidden -WorkingDirectory ' + psString(os.tmpdir()) +
    ' -FilePath ' + psString(process.execPath) + ' -ArgumentList ' + psString('"' + childScript + '"') + '\r';
  await page.evaluate(data => invoke('term_write', {id: curTab().termId, data}), command);
  await until(() => fs.access(started).then(() => true, () => false));
  const shellPid = Number((await fs.readFile(shellPidFile, 'ascii')).trim());
  assert.ok(Number.isSafeInteger(shellPid) && shellPid > 0);
  process.kill(shellPid, 0);
  const client = await page.evaluate(() => invoke('ssh_check_client'));
  const listener = net.createServer();
  let socket, banner = '';
  listener.on('connection', connection => {
    socket = connection;
    connection.setEncoding('utf8');
    connection.on('data', data => { banner += data; });
    connection.on('error', () => {});
  });
  try {
    if (client.available) {
      await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
      await page.evaluate(port => newSshTab({host:'127.0.0.1', user:'fixture', port, infoMode:'shell', managed:false}).then(() => null), listener.address().port);
      await until(() => banner.startsWith('SSH-'));
    }
    await close();
    if (client.available) await until(() => socket.destroyed);
  } finally {
    socket?.destroy();
    if (listener.listening) await new Promise(resolve => listener.close(resolve));
  }
  await fs.writeFile(release, 'closed');
  await until(() => fs.access(finished).then(() => true, () => false));
  await until(() => {
    try { process.kill(shellPid, 0); return false; }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  });
  console.log('File tab scope OK: browser/SSH commands, PowerShell roots, context menus, normal restart and retry, companion isolation, forced host exit ended the shell while its independent child finished.');
};

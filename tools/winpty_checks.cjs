const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {promisify} = require('node:util');
const exec = promisify(require('node:child_process').execFile);

async function until(label, condition) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(label);
}

module.exports = async function checkWinpty({page, output, stopApp}) {
  const ipc = (name, args) => page.evaluate(([name, args]) => invoke(name, args), [name, args]);
  const write = (id, command) => ipc('term_write', {id, data:command + '\r'});
  const read = file => fs.readFile(file, 'utf8').then(s => s.trim(), () => '');
  const first = path.join(output, '一号 工作目录'), second = path.join(output, '二号 工作目录');
  await fs.mkdir(first); await fs.mkdir(second);
  const agents = async () => {
    const result = await exec('powershell.exe', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'winpty-agent.exe\'" | Where-Object { $_.ExecutablePath -eq $env:DALIZI_TEST_AGENT } | ForEach-Object { $_.ProcessId }'],
      {windowsHide:true, env:{...process.env, DALIZI_TEST_AGENT:path.join(output,'terminal/winpty-agent.exe')}});
    return result.stdout.trim().split(/\s+/).filter(Boolean);
  };
  await page.evaluate(async () => {
    window.winptyExits = [];
    await window.__TAURI__.event.listen('term-closed', e => window.winptyExits.push(e.payload));
  });
  const helper = path.join(output, 'terminal', 'winpty-agent.exe');
  await fs.rename(helper, helper + '.fixture');
  try {
    await assert.rejects(ipc('term_start', {key:'missing-helper', cwd:first, cols:80, rows:24}), /缺少 WinPTY/);
    assert.equal((await agents()).length, 0);
  } finally {
    await fs.rename(helper + '.fixture', helper);
  }
  async function open(directory) {
    const result = await page.evaluate(async folder => {
      const tab = await newTermTab(folder);
      return {id:tab.termId, error:tab.sshError};
    }, directory);
    assert.ok(Number.isInteger(result.id), result.error);
    await write(result.id, "$PID | Set-Content -Encoding ascii -LiteralPath 'shell.pid'");
    const pid = path.join(directory, 'shell.pid');
    await until('PowerShell starts in its requested directory', async () => /^\d+$/.test(await read(pid)));
    return result.id;
  }
  const one = await open(first), two = await open(second);
  assert.notEqual(one, two);
  assert.equal((await agents()).length, 2);
  await ipc('term_resize', {id:one, cols:91, rows:27});
  await write(one, "'{0}x{1}' -f [Console]::WindowWidth,[Console]::WindowHeight | Set-Content -Encoding ascii 'size.txt'");
  await until('PowerShell sees 91 columns and 27 rows', async () => await read(path.join(first,'size.txt')) === '91x27');
  await write(two, "$done = Join-Path $PWD 'interrupt.txt'; try { 'ready' | Set-Content -Encoding ascii 'sleep.txt'; Start-Sleep -Seconds 60; 'finished' | Set-Content 'unexpected.txt' } finally { [IO.File]::WriteAllText($done,'stopped') }");
  await until('long-running command started', async () => await read(path.join(second,'sleep.txt')) === 'ready');
  await ipc('term_interrupt', {id:two});
  // Ctrl+C delivery is asynchronous; wait for PowerShell to leave its running
  // pipeline before typing at the next prompt.
  await until('Ctrl+C interrupts the active command', async () => await read(path.join(second,'interrupt.txt')) === 'stopped');
  await write(two, "'continued' | Set-Content -Encoding ascii 'next.txt'");
  await until('Ctrl+C returns to the interactive prompt', async () => await read(path.join(second,'next.txt')) === 'continued');
  assert.equal(await read(path.join(second,'unexpected.txt')), '');
  await write(one, 'exit 23');
  await page.waitForFunction(id => window.winptyExits.some(e => e.id === id && e.exitCode === 23), one);
  await until('first helper exited', async () => (await agents()).length === 1);
  const pid = Number(await read(path.join(second,'shell.pid')));
  await stopApp();
  await until('crash cleanup releases remaining helper and shell', async () => {
    if ((await agents()).length) return false;
    try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
  });
  console.log('WinPTY: two isolated native shells, Unicode working directories, resize, Ctrl+C, resumed input, exit code 23 and process-death cleanup passed.');
  console.log('Artifacts: ' + output);
};

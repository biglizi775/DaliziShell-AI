// Loopback SFTP fixture driven over stdin/stdout. It never connects to another host.
const fs = require('node:fs/promises'), path = require('node:path');
const { spawn } = require('node:child_process'), { once } = require('node:events'), { createInterface } = require('node:readline');

async function startSshFixture(dir) {
  const venv = path.resolve(__dirname, '../src-tauri/target/m4-venv/Scripts/python.exe');
  const python = process.env.DALIZI_PYTHON || (await fs.stat(venv).catch(() => null) ? venv : 'python');
  const child = spawn(python, ['-u', path.join(__dirname, 'ssh_managed_fixture.py'), dir, '--task-files'], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator](); const done = once(child, 'exit');
  async function next() {
    let timer;
    try {
      const row = await Promise.race([lines.next(), new Promise((_, reject) => timer = setTimeout(() => reject(Error('SFTP fixture reply timed out')), 15000))]);
      if (row.done) throw Error('SFTP fixture exited');
      return JSON.parse(row.value);
    } finally { clearTimeout(timer); }
  }
  const tell = (v) => child.stdin.write(v + '\n');
  async function stop() {
    if (child.exitCode === null && !child.signalCode) child.stdin.end('stop\n');
    let timer;
    try { await Promise.race([done, new Promise((ok) => timer = setTimeout(ok, 5500))]); } finally { clearTimeout(timer); }
    if (child.exitCode === null && !child.signalCode) { child.kill(); await done; }
  }
  try { return { data: await next(), next, tell, stop }; } catch (e) { await stop(); throw e; }
}

module.exports = { startSshFixture };

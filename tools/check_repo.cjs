// Read-only checks for the files that would enter a source checkout/package.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const errors = [];
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });

try {
  if (path.resolve(git('rev-parse', '--show-toplevel').trim()) !== root) {
    throw new Error('Initialize Git in the project root before running repository checks.');
  }
  const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))]
    .filter(file => fs.existsSync(path.join(root, file)));
  const included = new Set(files);
  const forbidden = /(^|\/)(?:target|node_modules|__pycache__|\.venv|\.dalizi|\.codex|browser-profiles)(\/|$)|^(?:dist|tools\/vendor-cache|src-tauri\/gen)\/|(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.cargo\/config\.toml$/;
  for (const file of files) {
    if (forbidden.test(file) && !file.endsWith('/.env.example') && file !== '.env.example') errors.push(`Local/generated file is included: ${file}`);
    if (fs.statSync(path.join(root, file)).size > 50 * 1024 * 1024) errors.push(`Source file exceeds 50 MiB: ${file}`);
  }
  for (const file of ['src-tauri/Cargo.lock', 'package-lock.json', 'LICENSE', 'ui/vendor/LICENSE.xterm', 'ui/vendor/LICENSE.xterm-addon-fit', 'ui/vendor/pdfjs/LICENSE']) {
    if (!included.has(file)) errors.push(`Required source file is missing or ignored: ${file}`);
  }
  for (const file of ['src-tauri/target/release/app.exe', 'src-tauri/gen/schemas/windows-schema.json', 'tools/vendor-cache/download.tgz', 'tools/__pycache__/fixture.pyc', '.dalizi/agent-memory.json', 'dist/source.zip', 'src-tauri/.cargo/config.toml', '.env']) {
    const check = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', '--', file], { windowsHide: true });
    if (check.status !== 0) errors.push(`Ignore rule does not cover: ${file}`);
  }
  for (const file of files.filter(file => /^(?:ui|tests|tools)\/.*\.(?:js|cjs)$/.test(file) && !file.startsWith('ui/vendor/'))) {
    const check = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) errors.push(`${file}: ${check.stderr.trim()}`);
  }
  const checkLink = (from, target) => {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) return;
    const relative = decodeURIComponent(target.split('#')[0]);
    if (!relative) return;
    const resolved = path.resolve(root, path.dirname(from), relative);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
      errors.push(`Broken local link in ${from}: ${target}`); return;
    }
    if (fs.statSync(resolved).isFile() && !included.has(path.relative(root, resolved).split(path.sep).join('/'))) {
      errors.push(`Link depends on an ignored file in ${from}: ${target}`);
    }
  };
  for (const file of files.filter(file => file.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const match of text.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) checkLink(file, match[1].replace(/^<|>$/g, ''));
  }
  const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) checkLink('ui/index.html', match[1]);
  if (errors.length) throw new Error(errors.join('\n'));
  const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(root, file)).size, 0);
  console.log(`Repository checks passed: ${files.length} source files, ${(bytes / 1024 / 1024).toFixed(2)} MiB; syntax, local links, assets and exclusions verified.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

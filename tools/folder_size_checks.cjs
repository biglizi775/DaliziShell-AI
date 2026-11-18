const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function makeSizeFixture(output) {
  const directory = path.join(output, '大小核验');
  const folder = path.join(directory, '项目');
  const child = path.join(folder, '受限样本');
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(path.join(directory, '空目录'));
  fs.writeFileSync(path.join(child, 'nested.txt'), '12345678');
  fs.writeFileSync(path.join(folder, 'top.txt'), '12345');
  return { directory, folder, child };
}

async function checkFolderSizes({ page, fixture, output, launch, stopApp, closeWindow }) {
  const { directory, folder, child } = fixture;
  const show = () => page.evaluate(() => showEntryProperties(state.entries.find(e => e.name === '项目')));
  const dismiss = () => page.locator('#entryProperties [data-close-dialog]').last().click();
  const message = () => page.locator('#entryProperties [data-property-verification]').innerText();
  const reading = () => page.evaluate(async p => (await invoke('folder_size_details', { paths: [p] }))[0], folder);
  async function waitForReading(basis, after, size, restored = false) {
    await page.waitForFunction(({ basis, after, size, restored }) => {
      const r = state.entries?.find(e => e.name === '项目')?.dirSizeInfo;
      return r?.basis === basis && r.verifiedAt > after && r.size === size && r.restored === restored;
    }, { basis, after, size, restored });
  }
  const go = () => page.evaluate(async directory => {
    setLocale('zh'); setWorkspaceSearchMode('local'); await navigate(directory);
  }, directory);
  await go();
  await page.keyboard.press('F5');
  await waitForReading('measured', 0, 13);
  await page.waitForFunction(() => state.entries.find(e => e.name === '空目录')?.dirSizeInfo?.size === 0);
  const first = await reading();
  await page.keyboard.press('F5');
  await show();
  await waitForReading('measured', first.verifiedAt, 13);
  assert.match(await message(), /本次运行已完整核验/);
  assert.match(await page.locator('#entryProperties [data-property-size]').innerText(), /13 字节/);
  const full = await reading();
  // Change only list permission on this freshly created fixture directory.
  const sid = execFileSync('whoami.exe', ['/user','/fo','csv','/nh'], { encoding:'utf8', windowsHide:true }).match(/S-1-[\d-]+/)[0];
  const acl = args => execFileSync('icacls.exe', [child, ...args], { windowsHide:true, stdio:'pipe' });
  acl(['/deny', '*' + sid + ':(RD)']);
  try {
    assert.throws(() => fs.readdirSync(child), e => ['EPERM','EACCES'].includes(e.code));
    await page.evaluate(p => invoke('dir_sizes', { gen:state.gen, paths:[p], force:true }), folder);
    await waitForReading('incomplete', 0, 13);
    assert.match(await message(), /未能完整读取，保留上次数值/);
    assert.equal((await reading()).verifiedAt, full.verifiedAt);
  } finally { acl(['/remove:d', '*' + sid]); }
  fs.writeFileSync(path.join(child, 'nested.txt'), '1234567890');
  await dismiss();
  await page.keyboard.press('F5');
  await waitForReading('measured', full.verifiedAt, 15);
  await show();
  assert.match(await message(), /本次运行已完整核验/);
  await page.locator('[data-property-verification]').scrollIntoViewIfNeeded();
  await page.screenshot({ path:path.join(output, 'native-folder-size.png') });
  const beforeExit = await reading();
  await dismiss();
  await page.evaluate(() => navigate(null));
  let timer;
  try {
    const code = await Promise.race([closeWindow(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Normal close timed out')), 20000); })]);
    assert.equal(code, 0);
  } finally { clearTimeout(timer); }
  await stopApp();
  page = await launch();
  let recovered;
  const deadline = Date.now() + 30000;
  do {
    recovered = await reading();
    if (recovered) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(recovered?.restored, true, 'restored folder is available before requesting another scan');
  assert.equal(recovered.size, 15);
  assert.equal(recovered.verifiedAt, beforeExit.verifiedAt);
  await go(); await show();
  assert.match(await message(), /上次运行的缓存/);
  await dismiss(); await page.keyboard.press('F5');
  await waitForReading('measured', recovered.verifiedAt, 15);
  console.log('Folder size verification passed: empty and nested totals, F5 with unchanged bytes, unreadable descendant retained exact bytes/time, recovery after granting access, ordinary restart restored the per-folder timestamp.');
  return page;
}

module.exports = { makeSizeFixture, checkFolderSizes };

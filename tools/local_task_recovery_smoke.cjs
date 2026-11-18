// Windows desktop fixture. Pause only at journal boundaries; every copy uses
// the real Shell implementation. All launches share this fixture's WebView2 profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function localTaskRecovery({ page, output, launch, stopApp, closeWindow }) {
  const source = path.join(output, 'recovery-source'), dest = path.join(output, 'recovery-target');
  fs.mkdirSync(source); fs.mkdirSync(dest);
  const names = ['done.txt', 'lost-receipt.txt', 'pending.txt', 'replaced.txt'];
  const paths = names.map(n => path.join(source, n));
  for (const name of names) fs.writeFileSync(path.join(source, name), name);
  const first = await page.evaluate(async ({ paths, dest }) => {
    const write = writeLocalItem;
    writeLocalItem = async (item, before, after, receipt) => {
      if (item.index === 1 && before === 'running') {
        window.receiptPaused = true;
        await new Promise(() => {});
      }
      return write(item, before, after, receipt);
    };
    return (await queueLocalTransfer('copy', paths, { path: dest, owner: curTab() })).id;
  }, { paths, dest });
  await page.waitForFunction(() => window.receiptPaused);
  assert.deepEqual(fs.readdirSync(dest).sort(), names.slice(0, 2).sort());
  await stopApp();
  fs.renameSync(paths[3], paths[3] + '.original');
  fs.writeFileSync(paths[3], 'replacement');
  page = await launch();
  await page.evaluate(() => ensureLocalHistory());
  let center = page.locator('#localTaskCenter');
  await page.locator('#btnTransfers').click();
  await center.locator('[data-id="' + first + '"]').click();
  assert.deepEqual(await center.locator('[data-items] [data-status]').evaluateAll(rows => rows.map(r => r.dataset.status)), ['complete','verify','stopped','stopped']);
  await center.locator('[data-retry]').click();
  const review = page.locator('#externalDropDialog');
  assert.deepEqual(await review.locator('li').allTextContents(), paths.slice(2).map(p => ' ' + p));
  await review.locator('[data-drop-kind=copy]').click();
  await page.waitForFunction(() => /原记录不一致|no longer matches/.test(document.querySelector('#externalDropStatus')?.textContent));
  assert.equal(fs.existsSync(path.join(dest, names[3])), false);
  await review.locator('[data-retry-index]').last().uncheck();
  // Terminate after atomic retry hand-off but before its first dispatch claim.
  await page.evaluate(() => {
    const write = writeLocalItem;
    writeLocalItem = async (...args) => {
      if (args[1] === 'queued') { window.claimPaused = true; await new Promise(() => {}); }
      return write(...args);
    };
  });
  await review.locator('[data-drop-kind=copy]').click();
  await page.waitForFunction(() => window.claimPaused);
  const second = await page.evaluate(() => localFileBatches.at(-1).id);
  await stopApp();
  page = await launch(); await page.evaluate(() => ensureLocalHistory());
  assert.equal(fs.existsSync(path.join(dest, names[2])), false);
  const restored = await page.evaluate(({ first, second }) => {
    const old = localFileBatches.find(b => b.id === first), next = localFileBatches.find(b => b.id === second);
    return [old.items.filter(localRetryable).map(i => i.source), next.items.filter(localRetryable).map(i => i.source), old.items[2].retried];
  }, { first, second });
  assert.deepEqual(restored, [[paths[3]], [paths[2]], second]);
  await page.locator('#btnTransfers').click(); center = page.locator('#localTaskCenter');
  await center.locator('[data-id="' + second + '"]').click();
  await center.locator('[data-retry]').click();
  // Substituting a different destination at the same path must also fail.
  fs.renameSync(dest, dest + '.original'); fs.mkdirSync(dest);
  await page.locator('[data-drop-kind=copy]').click();
  await page.waitForFunction(() => /原记录不一致|no longer matches/.test(document.querySelector('#externalDropStatus')?.textContent));
  assert.deepEqual(fs.readdirSync(dest), []);
  fs.rmdirSync(dest); fs.renameSync(dest + '.original', dest);
  await page.locator('[data-drop-kind=copy]').click();
  await page.locator('#externalDropDialog').waitFor({ state:'detached' });
  await page.waitForFunction(() => !localQueueRunning && localFileBatches.at(-1).items[0].status === 'complete');
  assert.deepEqual(fs.readdirSync(dest).sort(), names.slice(0, 3).sort());
  for (const name of names.slice(0, 3)) assert.equal(fs.readFileSync(path.join(dest, name), 'utf8'), name);
  await center.locator('[data-id="' + first + '"]').click();
  await page.screenshot({ path: path.join(output, 'native-local-recovery.png') });
  await center.locator('[data-clear]').click();
  await page.waitForFunction(() => !localFileBatches.some(localSettled));
  assert.equal(await center.locator('[data-id="' + first + '"]').count(), 1);
  await center.locator('[data-forget]').click(); await center.locator('[data-forget]').click();
  await page.waitForFunction(id => !localFileBatches.some(b => b.id === id), first);
  await center.locator('[data-close]').last().click();
  const normalDest = path.join(output, 'normal-close-target'); fs.mkdirSync(normalDest);
  const normal = await page.evaluate(async ({ paths, dest }) => {
    const b = await queueLocalTransfer('copy', paths, { path: dest, owner: curTab() });
    stopLocalBatch(b); await b.done; return b.id;
  }, { paths: paths.slice(0, 2), dest: normalDest });
  assert.deepEqual(fs.readdirSync(normalDest), [names[0]]);
  let timeout;
  try {
    const code = await Promise.race([closeWindow(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Native close timed out')), 15000); })]);
    assert.equal(code, 0, 'normal desktop close');
  }
  finally { clearTimeout(timeout); }
  await stopApp(); page = await launch();
  await page.evaluate(() => ensureLocalHistory());
  assert.equal(await page.evaluate(id => localFileBatches.some(b => b.id === id), first), false);
  assert.deepEqual(await page.evaluate(id => localFileBatches.find(b => b.id === id).items.map(i => i.status), normal), ['complete','stopped']);
  assert.deepEqual(fs.readdirSync(normalDest), [names[0]]);
  await page.locator('#btnTransfers').click(); center = page.locator('#localTaskCenter');
  await center.locator('[data-id="' + normal + '"]').click();
  await center.locator('[data-retry]').click();
  await page.locator('[data-drop-kind=copy]').click();
  await page.locator('#externalDropDialog').waitFor({ state:'detached' });
  await page.waitForFunction(() => !localQueueRunning && localFileBatches.at(-1).items.every(i => i.status === 'complete'));
  assert.deepEqual(fs.readdirSync(normalDest).sort(), names.slice(0, 2).sort());
  assert.deepEqual(fs.readdirSync(dest).sort(), names.slice(0, 3).sort());
  console.log('Local recovery OK: two process kills, receipt/claim boundaries, exact retry ownership, changed source/destination rejection, selective retry, ordinary close and durable removal.');
};

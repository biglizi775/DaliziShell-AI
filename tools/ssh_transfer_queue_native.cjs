// Invoked by ssh_managed_smoke inside its generated loopback fixture.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
module.exports = async ({ page, invoke, id, output, remoteRoot }) => {
  const inputs = ['queue-one.txt', 'queue-existing.txt', 'queue-中文.txt'].map((name) => path.join(output, name));
  inputs.forEach((file, i) => fs.writeFileSync(file, `queue content ${i} 🌟\n`.repeat(200)));
  const existing = path.join(remoteRoot, 'queue-existing.txt'); fs.writeFileSync(existing, 'do not overwrite');
  const prepared = await invoke('ssh_transfer_prepare', { id, direction: 'upload', paths: inputs, directory: null, remote: '/' });
  assert.equal(prepared.length, 3);
  await page.evaluate((files) => {
    window.queueOriginalReceive = receiveSshQueuedTransfer; window.queueDroppedEvent = false;
    // Lose one completion event deliberately. The native status query must recover it.
    receiveSshQueuedTransfer = (payload) => {
      if (!window.queueDroppedEvent && payload.status === 'complete' && sshTaskBatches[0]?.items[0].transferId === payload.transferId) { window.queueDroppedEvent = true; return true; }
      return queueOriginalReceive(payload);
    };
    showSshBatchReview(curTab(), files, 'upload', '/');
  }, prepared);
  await page.locator('#sshBatchStart').click();
  await page.waitForFunction(() => sshBatchDone(sshTaskBatches[0]), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => queueDroppedEvent), true);
  assert.deepEqual(await page.evaluate(() => sshTaskBatches[0].items.map((item) => item.status)), ['complete', 'failed', 'complete']);
  assert.deepEqual(fs.readFileSync(path.join(remoteRoot, 'queue-one.txt')), fs.readFileSync(inputs[0]));
  assert.equal(fs.readFileSync(existing, 'utf8'), 'do not overwrite');
  assert.deepEqual(fs.readFileSync(path.join(remoteRoot, 'queue-中文.txt')), fs.readFileSync(inputs[2]));
  const token = await page.evaluate(() => sshTaskBatches[0].items[0].transferId);
  assert.equal((await invoke('ssh_transfer_status', { id, transferId: token })).status, 'complete');
  assert.equal(await invoke('ssh_transfer_status', { id: 0, transferId: token }), null);
  await assert.rejects(invoke('ssh_file_transfer', { id, direction: 'upload', localPath: inputs[0], remote: '/', requestId: token }), /already used|已使用/);
  // Remove only the exact generated fixture conflict, then retry the unsuccessful item.
  assert.equal(path.dirname(existing), path.resolve(remoteRoot)); fs.unlinkSync(existing);
  await page.locator('[data-task-retry]').click(); assert.equal(await page.locator('.ssh-batch-files li').count(), 1);
  await page.locator('#sshBatchStart').click(); await page.waitForFunction(() => sshBatchDone(sshTaskBatches[1]), null, { timeout: 30000 });
  assert.deepEqual(fs.readFileSync(existing), fs.readFileSync(inputs[1]));
  assert.equal(await page.evaluate(() => sshTaskBatches[1].items[0].status), 'complete');
  await page.locator('[data-tasks-close]').last().click();
  const directory = path.join(output, 'batch-downloads'); fs.mkdirSync(directory);
  await page.evaluate(() => loadSshFiles(curTab(), '/'));
  for (const [i, name] of ['queue-one.txt', 'queue-中文.txt'].entries()) await page.locator('.ssh-file-row').filter({ hasText: name }).click({ modifiers: i ? ['Control'] : [] });
  const names = await page.evaluate(() => selectedSshFiles(curTab().sshFiles).map((entry) => entry.name)); assert.equal(names.length, 2);
  const downloads = await invoke('ssh_transfer_prepare', { id, direction: 'download', paths: names, directory, remote: '/' });
  await page.evaluate(({ files, destination }) => showSshBatchReview(curTab(), files, 'download', destination), { files: downloads, destination: directory });
  await page.locator('#sshBatchStart').click(); await page.waitForFunction(() => sshBatchDone(sshTaskBatches[2]), null, { timeout: 30000 });
  for (const name of names) assert.deepEqual(fs.readFileSync(path.join(directory, name)), fs.readFileSync(path.join(remoteRoot, name)));
  await page.screenshot({ path: path.join(output, 'native-batch-transfers.png') });
  await page.locator('[data-tasks-close]').last().click();
  const cancelDir = path.join(output, 'batch-cancel'); fs.mkdirSync(cancelDir);
  const cancelFiles = await invoke('ssh_transfer_prepare', { id, direction: 'download', paths: ['slow.bin', '中文.txt'], directory: cancelDir, remote: '/' });
  await page.evaluate(({ files, destination }) => showSshBatchReview(curTab(), files, 'download', destination), { files: cancelFiles, destination: cancelDir });
  await page.locator('#sshBatchStart').click(); await page.waitForFunction(() => sshTaskBatches[3].items[0].bytes > 0, null, { timeout: 30000 });
  await page.locator('[data-task-cancel]').click(); await page.waitForFunction(() => sshBatchDone(sshTaskBatches[3]), null, { timeout: 30000 });
  assert.deepEqual(fs.readdirSync(cancelDir), []);
  assert.deepEqual(await page.evaluate(() => sshTaskBatches[3].items.map((item) => item.status)), ['cancelled', 'cancelled']);
  await page.locator('[data-tasks-close]').last().click();
  await page.evaluate(() => { receiveSshQueuedTransfer = queueOriginalReceive; });
  const reconnectDir = path.join(output, 'batch-reconnect'); fs.mkdirSync(reconnectDir);
  const interrupted = await invoke('ssh_transfer_prepare', { id, direction: 'download', paths: ['slow.bin', '中文.txt'], directory: reconnectDir, remote: '/' });
  await page.evaluate(({ files, destination }) => showSshBatchReview(curTab(), files, 'download', destination), { files: interrupted, destination: reconnectDir });
  await page.locator('#sshBatchStart').click(); await page.waitForFunction(() => sshTaskBatches[4].items[0].bytes > 0, null, { timeout: 30000 });
  await page.evaluate(() => disconnectSshTab(curTab())); await page.waitForFunction(() => sshBatchDone(sshTaskBatches[4]));
  assert.equal(await page.evaluate(() => sshTaskBatches[4].items[1].status), 'cancelled');
  assert.equal(fs.existsSync(path.join(reconnectDir, '中文.txt')), false);
  await page.evaluate(() => reconnectSshTab(curTab())); await page.waitForFunction(() => curTab().sshAuthenticated && !curTab().exited);
  const queuedBeforeRetry = await page.evaluate(() => sshTaskBatches.length); assert.equal(queuedBeforeRetry, 5, 'relogin does not replay old transfers');
  await page.locator('[data-task-retry]').click(); await page.waitForSelector('#sshBatchReview[open]');
  if (await page.locator('#sshBatchVerified').count()) await page.locator('#sshBatchVerified').check();
  await page.locator('#sshBatchStart').click(); await page.waitForFunction(() => sshBatchDone(sshTaskBatches[5]), null, { timeout: 60000 });
  assert.deepEqual(await page.evaluate(() => sshTaskBatches[5].items.map((i) => i.status)), ['complete', 'complete']);
  assert.ok(await page.evaluate(() => sshTaskBatches[5].items[0].resumedBytes > 0), 'download resumes from verified partial bytes');
  for (const name of ['slow.bin', '中文.txt']) assert.deepEqual(fs.readFileSync(path.join(reconnectDir, name)), fs.readFileSync(path.join(remoteRoot, name)));
  assert.equal(fs.readdirSync(reconnectDir).some((name) => name.endsWith('.part')), false);
  await page.screenshot({ path: path.join(output, 'native-reconnected-batch.png') }); await page.locator('[data-tasks-close]').last().click();
  console.log('Native SFTP batch queue: actual uploads/downloads, no-overwrite, failed-item retry, missed-event recovery, duplicate-token rejection, cancellation cleanup and explicit retry after mid-transfer disconnect passed.');
};

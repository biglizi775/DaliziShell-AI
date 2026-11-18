// Real local files, generated SFTP server and the normal WebView transfer controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({page,output,remoteRoot}) => {
  const source=path.join(output,'paired-source'), target=path.join(output,'paired-target');
  const remote=path.join(remoteRoot,'paired-transfer');
  fs.mkdirSync(source); fs.mkdirSync(target); fs.mkdirSync(remote);
  fs.mkdirSync(path.join(source,'子目录')); fs.mkdirSync(path.join(source,'子目录','empty'));
  fs.writeFileSync(path.join(source,'子目录','report.txt'),'来自本地目录\n');
  fs.writeFileSync(path.join(source,'plain.txt'),'plain upload\n');
  fs.writeFileSync(path.join(remote,'receive.txt'),'paired download\n');
  fs.writeFileSync(path.join(source,'same.txt'),'本地 <b>原文</b>');
  fs.writeFileSync(path.join(remote,'same.txt'),'远程文件内容');
  fs.writeFileSync(path.join(remote,'large.txt'),'a'.repeat(65535)+'🌐末尾');
  const host=page.locator('.term.ssh-terminal-host:visible');
  const local=host.locator('.ssh-local-pane');
  const batchCount=()=>page.evaluate(()=>sshTaskBatches.length);
  async function visit(folder) {
    await local.locator('[data-local-path]').fill(folder);
    await local.locator('[data-local-path]').press('Enter');
    await page.waitForFunction(p=>curTab().sshFiles.localPane.ready && curTab().sshFiles.localPane.path===p,folder);
  }
  async function submit(n) {
    await page.locator('#sshBatchStart').click();
    await page.waitForFunction(count=>sshTaskBatches.length>count && sshBatchDone(sshTaskBatches[count]),n,{timeout:30000});
    assert.ok(await page.evaluate(count=>sshTaskBatches[count].items.every(i=>i.status==='complete'),n));
    await page.locator('[data-tasks-close]').last().click();
  }
  await host.locator('[data-ssh-layout=paired]').click();
  assert.equal(await host.locator('.term-terminal-viewport').isVisible(),false);
  const remotePath=host.locator('[data-path]');
  await remotePath.fill('/paired-transfer'); await remotePath.press('Enter');
  await page.waitForFunction(()=>curTab().sshFiles.ready && curTab().sshFiles.path==='/paired-transfer');
  await visit(source);
  const remotePane=host.locator('.ssh-remote-pane');
  await local.locator('[data-local-name="same.txt"]').click();
  await local.locator('[data-pane-preview=local]').click();
  await remotePane.locator('.ssh-file-row').filter({hasText:'same.txt'}).click();
  await remotePane.locator('[data-pane-preview=remote]').click();
  await local.getByText('本地 <b>原文</b>',{exact:true}).waitFor();
  await remotePane.getByText('远程文件内容',{exact:true}).waitFor();
  assert.equal(await local.locator('[data-preview-side=local] pre b').count(),0);
  await remotePane.locator('.ssh-file-row').filter({hasText:'large.txt'}).click();
  await remotePane.locator('[data-pane-preview=remote]').click();
  await page.waitForFunction(()=>document.querySelector('[data-preview-side=remote] pre')?.textContent.length===65535);
  assert.match(await remotePane.locator('[data-preview-side=remote] strong').innerText(),/64 KiB/);
  assert.equal(await local.locator('[data-preview-side=local]').isVisible(),true);
  await local.locator('[data-local-name="子目录"]').dblclick();
  await page.waitForFunction(()=>curTab().sshFiles.localPane.ready && curTab().sshFiles.localPane.path.endsWith('子目录'));
  assert.equal(await local.locator('[data-preview-side=local]').isVisible(),false);
  assert.equal(await remotePane.locator('[data-preview-side=remote]').isVisible(),true);
  await remotePane.locator('[data-preview-side=remote] button').click();
  await local.locator('[data-local-up]').click();
  await page.waitForFunction(p=>curTab().sshFiles.localPane.ready && curTab().sshFiles.localPane.path===p,source);
  await local.locator('[data-local-name="plain.txt"]').click();
  await local.locator('[data-local-name="子目录"]').click({modifiers:['Control']});
  const first=await batchCount();
  await local.locator('[data-local-upload]').click();
  await page.locator('#sshBatchReview[open]').waitFor();
  assert.equal(await page.locator('#sshBatchReview li').count(),4);
  assert.equal(fs.existsSync(path.join(remote,'plain.txt')),false);
  await submit(first);
  assert.deepEqual(fs.readFileSync(path.join(remote,'plain.txt')),fs.readFileSync(path.join(source,'plain.txt')));
  assert.deepEqual(fs.readFileSync(path.join(remote,'子目录','report.txt')),fs.readFileSync(path.join(source,'子目录','report.txt')));
  assert.equal(fs.statSync(path.join(remote,'子目录','empty')).isDirectory(),true);
  await visit(target);
  const receive=host.locator('.ssh-file-row').filter({hasText:'receive.txt'});
  await receive.click();
  await local.locator('[data-local-path]').fill(source);
  assert.equal(await host.locator('[data-download]').isDisabled(),true,'an unsubmitted address cannot redirect a download');
  await local.locator('[data-local-path]').fill(target);
  await host.locator('[data-download]').click(); await page.locator('#sshBatchReview[open]').waitFor();
  assert.equal(await page.locator('#sshBatchReview .ssh-task-path').textContent(),target);
  await page.locator('[data-batch-close]').last().click();
  assert.equal(await batchCount(),first+1); assert.equal(fs.existsSync(path.join(target,'receive.txt')),false);
  await host.locator('[data-download]').click(); await submit(first+1);
  await local.locator('[data-local-name="receive.txt"]').waitFor();
  assert.deepEqual(fs.readFileSync(path.join(target,'receive.txt')),fs.readFileSync(path.join(remote,'receive.txt')));
  assert.equal(fs.existsSync(path.join(source,'receive.txt')),false);
  assert.equal(await host.locator('.ssh-remote-pane .ssh-files-status').innerText(),await page.evaluate(()=>curTab().sshFiles.lastStatus));
  for(const [width,height] of [[1280,800],[960,560]]) {
    await page.setViewportSize({width,height});
    const a=await local.boundingBox(),b=await host.locator('.ssh-remote-pane').boundingBox();
    assert.ok(a.width>160 && b.width>160 && a.x+a.width<=b.x+1,'two separate columns');
    assert.ok(await local.locator('[data-local-list]').evaluate(el=>el.clientHeight)>=40);
    assert.ok(await host.locator('.ssh-files-list').evaluate(el=>el.clientHeight)>=40);
    await page.screenshot({path:path.join(output,`paired-files-${width}.png`),animations:'disabled'});
  }
  await host.locator('[data-ssh-layout=split]').click();
  assert.equal(await local.isVisible(),false); assert.equal(await host.locator('.term-terminal-viewport').isVisible(),true);
  await page.evaluate(()=>loadSshFiles(curTab(),'/'));
  console.log('Paired files OK: tree and file uploaded through reviewed selection, empty folder preserved, cancelled download made no file, confirmed download reached only its displayed local folder, both columns visible at two window sizes.');
};

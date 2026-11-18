const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkSearchPages(page, output) {
  const root = path.join(output, 'page-scope'), other = root + '-other';
  const tag = 'pages-' + path.basename(output).slice(-6).toLowerCase(), nested = path.join(root, tag + '-folder');
  fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(other);
  const paths = Array.from({length:421}, (_, i) => path.join(i < 205 ? root : nested, tag + '-' + String(i).padStart(3, '0') + '.txt'));
  for (const file of paths) fs.writeFileSync(file, path.basename(file));
  fs.writeFileSync(path.join(other, tag + '-outside.txt'), 'outside');
  async function indexFiles(count) {
    await page.evaluate(async ({ root, other }) => { await invoke('dir_sizes', { gen: state.gen, paths: [root, other], force: true }); }, { root, other });
    let actual;
    for (let i = 0; i < 150; i++) {
      actual = await page.evaluate(async ({ tag, root }) => (await invoke('search_files', { query: tag, limit: 1, scope: root, kind:'file' })).total, {tag,root});
      if (actual === count) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(actual, count, 'live index reached the fixture count');
  }
  await page.evaluate(async folder => { setWorkspaceSearchMode('local'); await navigate(folder); }, root);
  await indexFiles(421);
  await page.locator('#searchMode').selectOption('tree');
  await page.locator('#search').fill(tag + '-0|' + tag);
  await page.locator('[data-quick-kind=file]').click();
  const nav = page.locator('#quickSearchPager'), input = nav.locator('[data-quick-page-input]');
  async function waitPage(number, total) {
    try {
      await page.waitForFunction(({number,total}) => !quickState.pending && quickState.result?.page === number && quickState.result.total === total, {number,total});
    } catch (cause) {
      const state = await page.evaluate(async () => ({
        open:quickState.open, mode:quickMode(), kind:quickState.kind, query:$('search').value, pending:quickState.pending,
        page:quickState.result?.page, total:quickState.result?.total, count:$('quickSearchCount')?.textContent,
        snapshot:quickState.result?.snapshotId,
        live:(await invoke('search_files',{query:$('search').value,scope:quickFolder(),kind:'file',limit:1})).total,
        message:$('quickSearchResults')?.querySelector('.quick-empty')?.textContent,
      }));
      throw new Error('Expected page ' + number + '/' + total + '; ' + JSON.stringify(state), {cause});
    }
  }
  const rows = () => page.locator('[data-quick-result]').evaluateAll(items => items.map(row => row.dataset.path));
  await waitPage(1,421);
  const id = await page.evaluate(() => quickState.result.snapshotId);
  assert.deepEqual(await rows(), paths.slice(0,200));
  assert.equal(await nav.locator('[data-quick-step="-1"]').isDisabled(), true);
  await nav.locator('[data-quick-step="1"]').click(); await waitPage(2,421);
  assert.deepEqual(await rows(), paths.slice(200,400));
  // Change the live index ahead of the current page. The frozen result set
  // must still contain the old first entry and every original boundary.
  fs.unlinkSync(paths[0]);
  for (const s of ['extra-a','extra-b']) fs.writeFileSync(path.join(root,tag+'-'+s+'.txt'), s);
  await page.waitForFunction(tag => state.entries?.some(e => e.name === tag + '-extra-b.txt') && !state.entries.some(e => e.name === tag + '-000.txt'), tag);
  await indexFiles(422);
  await page.locator('#search').press('PageDown'); await waitPage(3,421);
  assert.deepEqual(await rows(), paths.slice(400));
  assert.equal(await nav.locator('[data-quick-step="1"]').isDisabled(), true);
  assert.equal(await page.evaluate(() => quickState.result.snapshotId), id);
  await page.waitForFunction(() => !document.querySelector('#toasts .toast'));
  await page.screenshot({ path:path.join(output,'native-search-pages.png') });
  await input.fill('1'); await input.press('Enter'); await waitPage(1,421);
  assert.deepEqual(await rows(), paths.slice(0,200));
  await nav.locator('[data-quick-new-results]').click(); await waitPage(1,422);
  assert.notEqual(await page.evaluate(() => quickState.result.snapshotId), id);
  assert.equal((await rows()).includes(paths[0]), false);
  await page.locator('#searchMode').selectOption('global'); await waitPage(1,423);
  await page.locator('#searchMode').selectOption('tree'); await waitPage(1,422);
  await input.fill('3'); await input.press('Enter'); await waitPage(3,422);
  const target = (await rows()).at(-1);
  await page.locator('[data-quick-action=reveal]').last().click();
  await page.waitForFunction(({dir,name}) => !state.loading && state.path === dir && state.selection.has(name) && !quickState.open,
    { dir:path.dirname(target), name:path.basename(target) });
  console.log('Native indexed pagination passed: 421 original files on three pages, boundary-stable after removal/insertion, explicit refresh to 422, global vs tree scope, kind across OR, page jump and reveal from the last page.');
};

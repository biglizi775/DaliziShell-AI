const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkIndexLocations({ page, output, launch, stopApp, closeWindow }) {
  // This test changes persisted machine-local preferences across restarts.
  assert.ok(fs.readFileSync(path.join(output, 'DaliziFiles.exe')).includes(Buffer.from('com.dalizi.files.index-scope-test-')), 'use the dedicated test application identifier');
  const area = path.join(output, '索引选择'), chosen = path.join(area, '项目'), outside = chosen + '-旧';
  const nested = path.join(chosen, '内层'), tag = 'scope-' + path.basename(output).slice(-6).toLowerCase();
  fs.mkdirSync(nested, { recursive:true }); fs.mkdirSync(outside);
  fs.mkdirSync(path.join(outside,'子目录'));
  const junction = path.join(chosen,'目录链接');
  fs.symlinkSync(outside, junction, 'junction');
  const sample = (dir, n) => path.join(dir, tag + '-' + n + '.txt');
  fs.writeFileSync(sample(chosen, 'one'), '1');
  fs.writeFileSync(sample(nested, 'two'), '22');
  fs.writeFileSync(sample(outside, 'outside'), '333');
  const get = () => page.evaluate(() => invoke('index_locations_get'));
  const search = () => page.evaluate(query => invoke('search_files', {query,limit:100}), tag);
  async function until(check, name) {
    const end = Date.now() + 45000;
    let last;
    do {
      last = await check();
      if (last === true) return;
      await new Promise(resolve => setTimeout(resolve, 150));
    } while (Date.now() < end);
    throw Error(name + ': ' + JSON.stringify(last));
  }
  async function openSettings() {
    await page.evaluate(() => { setLocale('zh'); setWorkspaceSearchMode('global'); showQuickSearch(); });
    await page.locator('[data-quick-locations]').click();
    const dialog = page.locator('#indexLocations');
    await dialog.locator('[data-index-save]:enabled').waitFor();
    return dialog;
  }
  async function selectFolders(paths) {
    const dialog = await openSettings();
    await dialog.locator('[value=selected]').check();
    await dialog.locator('#indexFolderList').fill(paths.join('\n'));
    await dialog.locator('[data-index-save]').click();
    await dialog.waitFor({state:'detached'});
  }
  const settings = await get();
  assert.equal(settings.settings.mode, 'fixed');
  // Create a historical result set containing both locations before narrowing.
  await page.evaluate(async roots => {
    await invoke('dir_sizes', {gen:state.gen, paths:roots, force:true});
  }, [chosen, outside]);
  await until(async () => (await search()).total === 3, 'initial searchable files');
  const old = await page.evaluate(query => invoke('search_files', {query,limit:1,paginate:true}), tag);
  assert.ok(old.snapshotId);
  await selectFolders([nested, chosen, chosen + '\\']);
  assert.deepEqual((await get()).settings.folders, [chosen]);
  await assert.rejects(page.evaluate(folder => invoke('index_locations_save',{settings:{mode:'selected',folders:[folder]}}),path.join(junction,'子目录')));
  for (const alias of [path.join(junction,'子目录'), chosen + '\\..\\' + path.basename(outside)]) {
    const result = await page.evaluate(async alias => {
      let done, timer;
      const result = new Promise((resolve,reject) => { done = resolve; timer = setTimeout(() => reject(Error('Missing size event for alias')),10000); });
      const unlisten = await listen('dir-size', e => { if (e.payload.path === alias) done(e.payload); });
      try {
        await invoke('dir_sizes',{gen:state.gen,paths:[alias],force:true});
        return await result;
      } finally { clearTimeout(timer); unlisten(); }
    }, alias);
    assert.equal(result.size, null);
  }
  await assert.rejects(page.evaluate(id => invoke('search_page',{snapshotId:id,page:2}),old.snapshotId));
  assert.deepEqual((await search()).items.map(i => i.path).sort(), [sample(chosen,'one'), sample(nested,'two')].sort());
  const bad = await openSettings();
  await bad.locator('#indexFolderList').fill(path.join(area,'不存在'));
  await bad.locator('[data-index-save]').click();
  await page.waitForFunction(() => document.querySelector('[data-index-status]')?.textContent.includes('固定磁盘'));
  assert.deepEqual((await get()).settings.folders, [chosen]);
  await bad.locator('[data-close-dialog]').last().click();
  await until(async () => {
    const s = await page.evaluate(() => invoke('search_status'));
    return s.selectedLocations === 1 && s.lastValidatedMs > 0 && !s.indexing && s.unwatchedLocations === 0;
  }, 'watch installed and initial scan finished');
  fs.writeFileSync(sample(nested, 'added'), '4444');
  fs.writeFileSync(sample(outside, 'ignored'), '55');
  await until(async () => (await search()).total === 3, 'watcher indexes newly created in-scope file');
  await page.evaluate(async p => { await navigate(p); await refresh(true,true); }, area);
  await until(async () => (await page.evaluate(async p => (await invoke('folder_size_details',{paths:[p]}))[0],outside))?.size === 5, 'out-of-scope size still updates');
  assert.ok((await search()).items.every(i => i.path.startsWith(chosen + '\\')));
  const moved = chosen + '-moved';
  fs.renameSync(chosen, moved);
  await until(async () => {
    const s = await page.evaluate(() => invoke('search_status'));
    return s.unwatchedLocations === 1 && (await search()).total === 0;
  }, 'missing selected root removed from search');
  fs.renameSync(moved, chosen);
  await until(async () => {
    const s = await page.evaluate(() => invoke('search_status'));
    return s.unwatchedLocations === 0 && (await search()).total === 3;
  }, 'returned root automatically watched and reindexed');
  await page.evaluate(() => navigate(null));
  let timer;
  try {
    assert.equal(await Promise.race([closeWindow(), new Promise((_, reject) => {timer=setTimeout(()=>reject(Error('Normal close timed out')),20000);})]),0);
  } finally { clearTimeout(timer); }
  await stopApp(); page = await launch();
  assert.deepEqual((await get()).settings.folders, [chosen]);
  await until(async () => (await search()).total === 3,'selected roots after restart');
  assert.ok((await search()).items.every(i => i.path.startsWith(chosen + '\\')));
  const hidden = path.join(chosen, tag + '-build'), sibling = hidden + '-old';
  fs.mkdirSync(hidden); fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(hidden,'private-marker.txt'),'12345');
  fs.writeFileSync(path.join(sibling,'public-marker.txt'),'12');
  const hits = () => page.evaluate(scope => invoke('search_files',{scope,query:'marker.txt',limit:20}),chosen);
  const size = p => page.evaluate(async p => (await invoke('folder_size_details',{paths:[p]}))[0],p);
  const full = () => page.evaluate(p => invoke('dir_sizes',{gen:state.gen,paths:[p],force:true}),chosen);
  await full(); await until(async () => (await hits()).total === 2 && (await size(chosen))?.size === 14,'baseline full size before exclusion');
  const before = await size(chosen);
  const previous = await page.evaluate(scope => invoke('search_files',{scope,query:'marker.txt',limit:1,paginate:true}),chosen);
  let edit = await openSettings();
  await edit.locator('[data-index-section=excluded]').click();
  await edit.locator('#indexExcludeList').fill([hidden,path.join(hidden,'future')].join('\n'));
  await edit.locator('[data-index-save]').click(); await edit.waitFor({state:'detached'});
  assert.deepEqual((await get()).settings.excluded,[hidden]);
  assert.deepEqual((await hits()).items.map(i=>i.path),[path.join(sibling,'public-marker.txt')]);
  await assert.rejects(page.evaluate(id => invoke('search_page',{snapshotId:id,page:1}),previous.snapshotId));
  assert.ok(!(await search()).items.some(i=>i.path===hidden));
  const fresh = path.join(hidden,'fresh');
  fs.mkdirSync(fresh); fs.writeFileSync(path.join(fresh,'extra-marker.txt'),'6789');
  fs.writeFileSync(path.join(sibling,'second-marker.txt'),'abc');
  await until(async () => (await hits()).total===2 && (await size(sibling))?.size===5,'eligible sibling watcher');
  assert.equal(await size(fresh),null,'background traversal skipped excluded directory');
  assert.equal((await size(chosen)).size,before.size,'partial sum cannot replace the folder size');
  assert.equal((await size(chosen)).verifiedAt,before.verifiedAt);
  assert.equal(await page.evaluate(async ({area,name}) => (await invoke('list_dir',{path:area})).find(e=>e.name===name).dirSizeManual,{area,name:path.basename(chosen)}),true);
  await page.evaluate(async directory => {setWorkspaceSearchMode('local');await navigate(directory);},area);
  await page.keyboard.press('F5');
  await until(async () => (await size(chosen))?.size===21 && (await size(fresh))?.size===4,'F5 includes excluded bytes');
  assert.ok((await hits()).items.every(i=>i.path.startsWith(sibling+'\\')));
  await page.evaluate(() => navigate(null));
  let closeTimer;
  try {
    assert.equal(await Promise.race([closeWindow(),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('Normal exclusion close timed out')),20000);})]),0);
  } finally {clearTimeout(closeTimer);}
  await stopApp(); page = await launch();
  assert.deepEqual((await get()).settings.excluded,[hidden]);
  await until(async ()=>(await hits()).total===2,'scope exclusions restored');
  assert.ok((await hits()).items.every(i=>i.path.startsWith(sibling+'\\')));
  const dialog = await openSettings();
  assert.equal(await dialog.locator('#indexFolderList').inputValue(), chosen);
  await dialog.locator('[data-index-section=excluded]').click();
  assert.equal(await dialog.locator('#indexExcludeList').inputValue(),hidden);
  await page.screenshot({path:path.join(output,'native-index-exclusions.png')});
  await dialog.locator('#indexExcludeList').fill('');
  await dialog.locator('[data-index-section=roots]').click();
  await page.screenshot({path:path.join(output,'native-index-locations.png')});
  await dialog.locator('#indexFolderList').fill('');
  await dialog.locator('[data-index-save]').click(); await dialog.waitFor({state:'detached'});
  assert.equal((await get()).settings.mode,'selected');
  assert.equal((await search()).total,0);
  await page.evaluate(async paths => invoke('dir_sizes',{gen:state.gen, paths, force:true}),[chosen,outside]);
  await until(async () => (await page.evaluate(() => invoke('search_status'))).selectedLocations === 0,'paused scope');
  await selectFolders([outside]);
  await until(async () => (await search()).total === 2,'switch to former sibling');
  assert.ok((await search()).items.every(i => i.path.startsWith(outside + '\\')));
  const fixed = await openSettings();
  await fixed.locator('[value=fixed]').check();
  await fixed.locator('[data-index-save]').click(); await fixed.waitFor({state:'detached'});
  assert.equal((await get()).settings.mode,'fixed');
  console.log('Index locations passed: live narrowing, duplicate/nested paths, expired pages, watcher updates, out-of-scope size, invalid-save rollback, normal restart, pause, sibling switch and all-drive reset.');
  return page;
};

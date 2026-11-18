const assert = require('node:assert/strict');
module.exports = async function checkProductivity(page, { folder, native = false }) {
  await page.waitForFunction(() => typeof workspaceSessionReady !== 'undefined' && workspaceSessionReady && !state.loading);
  await page.evaluate(async (root) => { await navigate(root); }, folder);
  await page.waitForFunction(() => !state.loading);
  await page.evaluate(async (root) => { await newTab(root); window.tabToMove = curTab(); await switchTab(0); window.activeBeforeMove = curTab(); }, folder);
  await page.waitForFunction(() => !state.loading && !document.querySelector('dialog[open]'));
  const tabCount = await page.locator('#tabbar .tab').count();
  await page.locator('#tabbar .tab').nth(tabCount - 1).waitFor({ state: 'visible' });
  const source = await page.locator('#tabbar .tab').nth(tabCount - 1).boundingBox(), target = await page.locator('#tabbar .tab').first().boundingBox();
  await page.mouse.move(source.x + 35, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 12 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => state.tabs[0] === tabToMove && curTab() === activeBeforeMove), true, 'dragging preserves active identity');
  const closeIndex = await page.evaluate(() => state.tabs.indexOf(tabToMove));
  await page.locator(`[data-tc="${closeIndex}"]`).click(); await page.locator('#tabReopen').click();
  await page.waitForFunction(() => !state.loading);
  assert.equal(await page.evaluate(() => curTab().path), folder);
  assert.equal(await page.evaluate(() => curTab() === tabToMove), false, 'reopen creates a fresh tab');
  await page.locator('#tabbar .tab.on').focus(); await page.keyboard.press('Alt+Shift+ArrowLeft');
  assert.equal(await page.evaluate(() => state.tab), tabCount - 2);
  if (!native) {
    await page.evaluate(async () => { await newBrowserTab('https://restore.example.test/'); closeTab(state.tab); });
    await page.locator('#tabReopen').click(); await page.waitForFunction(() => curTab()?.url === 'https://restore.example.test/');
    await page.evaluate(() => { closeTab(state.tab); store.set('browserSettings', { ...browserSettings(), recordHistory: false }); syncWorkspaceSessionPrivacy(); });
    assert.equal(await page.evaluate(() => recentlyClosedTabs.some((t) => t.kind === 'browser')), false);
  }
  return { preservesActiveTab: true, checks: 'drag/reopen/keyboard ordering and browser reopen privacy' };
};

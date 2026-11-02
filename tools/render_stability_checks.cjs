// Shared checks against the real DOM, in Chromium mocks and the native EXE.
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function checkRenderStability(page, { folder, output, resize }) {
  await page.waitForFunction(() => typeof workspaceSessionReady !== 'undefined' && workspaceSessionReady && !state.loading);
  await page.evaluate(async (folder) => {
    setLocale('zh'); closeAiAssistant(); previewOpen = false;
    await navigate(folder); setWorkspaceSearchMode('local');
    state.sortKey = 'name'; state.sortDir = 1; state.viewMode = 'details';
    renderAll(); await applyWorkspaceTheme('dark');
  }, folder);
  await page.locator('.row').first().waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const unchanged = await page.evaluate(async () => {
    const rows = [...els.rows.children], labels = rows.map((row) => row.querySelector('.nm'));
    const header = els.dhead.firstElementChild, tabs = els.tabbar.firstElementChild, side = els.side.firstElementChild;
    let removals = 0;
    const observer = new MutationObserver((events) => { removals += events.reduce((n, event) => n + event.removedNodes.length, 0); });
    observer.observe(els.rows, { subtree: true, childList: true });
    for (let i = 0; i < 30; i++) { renderList(); renderRows(); }
    for (let i = 0; i < 4; i++) await refresh(true);
    await Promise.resolve(); observer.disconnect();
    return { removals, rows: rows.every((row, i) => row.isConnected && row.querySelector('.nm') === labels[i]), header: header === els.dhead.firstElementChild, tabs: tabs === els.tabbar.firstElementChild, side: side === els.side.firstElementChild };
  });
  assert.deepEqual(unchanged, { removals: 0, rows: true, header: true, tabs: true, side: true }, 'no-change refresh and resize rendering preserve the existing surfaces');
  await page.evaluate(() => {
    window.retainedRows = [...els.rows.children];
    els.scroller.scrollTop = 44 * 5; renderRows();
  });
  assert.ok(await page.evaluate(() => window.retainedRows.some((row) => row.isConnected)), 'scroll virtualization reuses overlapping rows');
  await page.evaluate(() => { state.selection = new Set(['Project-notes-1.md']); startRename('Project-notes-1.md'); });
  await page.locator('input.rn').fill('draft-preserved.md');
  await page.evaluate(() => { const input = document.querySelector('input.rn'); input.setSelectionRange(2, 7); window.renameInput = input; for (let i = 0; i < 20; i++) renderList(); });
  await resize(1060, 680);
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => ({ same: window.renameInput === document.querySelector('input.rn'), value: window.renameInput.value, focused: document.activeElement === window.renameInput, start: window.renameInput.selectionStart, end: window.renameInput.selectionEnd })), { same: true, value: 'draft-preserved.md', focused: true, start: 2, end: 7 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('input.rn').count(), 0);
  assert.equal(await page.evaluate(() => state.entries.some((entry) => entry.name === 'Project-notes-1.md')), true);
  await page.locator('#search').fill('预览示例.pdf');
  await page.evaluate(() => { previewOpen = true; renderWorkspace(); });
  await page.locator('.row').filter({ hasText: '预览示例.pdf' }).click();
  await page.locator('canvas[data-page="1"]').waitFor({ timeout: 20000 });
  await page.evaluate(async () => {
    const pdf = await documentPreviewSession.loadingTask.promise;
    const getPage = pdf.getPage.bind(pdf); window.restorePdfGetPage = () => { pdf.getPage = getPage; };
    pdf.getPage = async (...args) => { await new Promise((resolve) => setTimeout(resolve, 350)); return getPage(...args); };
    window.oldCanvas = document.querySelector('.pdf-page'); window.oldPixels = window.oldCanvas.toDataURL();
  });
  await page.locator('[data-pdf-next]').click();
  assert.equal(await page.evaluate(() => window.oldCanvas.isConnected && window.oldCanvas.toDataURL() === window.oldPixels), true, 'previous PDF remains painted while its replacement renders');
  await page.locator('canvas[data-page="2"]').waitFor();
  assert.equal(await page.evaluate(() => window.oldCanvas.isConnected), false);
  await page.evaluate(() => window.restorePdfGetPage());
  await page.locator('[data-pdf-zoom]').selectOption('1.5');
  await page.locator('[data-pdf-zoom]').selectOption('2');
  await page.locator('[data-pdf-zoom]').selectOption('fit');
  await page.waitForFunction(() => document.querySelector('.pdf-status')?.textContent === '2 / 2');
  assert.equal(await page.locator('.pdf-page').count(), 1);
  assert.ok(await page.locator('.pdf-page').evaluate((canvas) => canvas.width > 0 && canvas.height > 0 && canvas.width * canvas.height <= 4_000_000));
  await page.screenshot({ path: path.join(output, 'stable-preview-dark.png') });
  await resize(960, 560);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, 'stable-preview-small.png') });
  return unchanged;
};

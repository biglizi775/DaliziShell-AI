// Test-only observation of an isolated fixture. No application instrumentation
// is shipped, no user file contents are collected, and no graphics flags change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = async function soak(page, folder, durationSeconds = 60) {
  await page.locator('#search').fill('预览示例.pdf');
  await page.evaluate(() => { previewOpen = true; renderWorkspace(); });
  await page.locator('.row').filter({ hasText: '预览示例.pdf' }).click();
  await page.locator('canvas[data-page="1"]').waitFor({ timeout: 20000 });
  await delay(300);
  await page.evaluate(() => {
    const row = document.querySelector('#rows .row'), canvas = document.querySelector('.pdf-page');
    const header = els.dhead.firstElementChild, app = document.getElementById('app');
    const background = getComputedStyle(document.documentElement).backgroundColor;
    const original = new Map();
    const counters = { renderAll: 0, renderRows: 0, renderContent: 0, renderPreview: 0 };
    for (const name of Object.keys(counters)) {
      const fn = window[name]; original.set(name, fn);
      window[name] = function (...args) { counters[name]++; return fn.apply(this, args); };
    }
    const report = { samples: 0, hiddenWorkspace: 0, hiddenFileList: 0, missingPdf: 0, rowReplacements: 0, headerReplacements: 0, canvasReplacements: 0, backgroundChanges: 0, longFrameGaps: 0, maxFrameGapMs: 0, counters };
    let running = true, previous = performance.now();
    const sample = (now) => {
      if (!running) return;
      const gap = now - previous; previous = now;
      report.samples++; report.maxFrameGapMs = Math.max(report.maxFrameGapMs, gap);
      if (gap > 250) report.longFrameGaps++;
      if (!app.isConnected || getComputedStyle(app).display === 'none') report.hiddenWorkspace++;
      if (els.scroller.classList.contains('hidden') || state.loading) report.hiddenFileList++;
      const visibleCanvas = document.querySelector('.pdf-page');
      if (!visibleCanvas || !visibleCanvas.width || !visibleCanvas.height || document.querySelector('#previewPanel').classList.contains('hidden')) report.missingPdf++;
      if (document.querySelector('#rows .row') !== row) report.rowReplacements++;
      if (els.dhead.firstElementChild !== header) report.headerReplacements++;
      if (visibleCanvas !== canvas) report.canvasReplacements++;
      if (getComputedStyle(document.documentElement).backgroundColor !== background) report.backgroundChanges++;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.finishStabilitySoak = () => {
      running = false;
      for (const [name, fn] of original) window[name] = fn;
      return report;
    };
    window.readStabilitySoak = () => structuredClone(report);
  });
  const noise = path.join(folder, 'soak-background.txt');
  assert.equal(fs.existsSync(noise), false, 'only a fresh fixture may be mutated');
  const start = Date.now(), idleSeconds = Math.min(20, durationSeconds / 3);
  let writes = 0, checkpoint = 0, idle;
  while (Date.now() - start < durationSeconds * 1000) {
    const seconds = (Date.now() - start) / 1000;
    if (seconds >= idleSeconds) {
      if (!idle) idle = await page.evaluate(() => window.readStabilitySoak());
      fs.writeFileSync(noise, `Fixture update ${++writes}\n` + '.'.repeat(writes % 100));
    }
    if (seconds >= checkpoint + 10) {
      checkpoint += 10;
      console.log(`Stability observation: ${checkpoint}s, phase=${idle ? 'background file changes' : 'idle'}, fixture writes=${writes}`);
    }
    await delay(200);
  }
  if (writes) fs.unlinkSync(noise);
  await delay(900);
  const total = await page.evaluate(() => window.finishStabilitySoak());
  for (const report of [idle, total]) {
    assert.ok(report?.samples > 0, 'animation-frame observer ran');
    for (const key of ['hiddenWorkspace', 'hiddenFileList', 'missingPdf', 'rowReplacements', 'headerReplacements', 'canvasReplacements', 'backgroundChanges']) assert.equal(report[key], 0, key);
    assert.equal(report.counters.renderAll, 0, 'no full workspace redraw while idle or processing unrelated changes');
  }
  return { durationSeconds: (Date.now() - start) / 1000, writes, idle, total,
    limitation: 'DOM/layout observation only; cannot detect a compositor-only or graphics-driver flash outside the WebView surface.' };
};

const assert = require('node:assert/strict');
const http = require('node:http');

module.exports = async function checkRuntime(page) {
  const expectedVersion = process.env.DALIZI_EXPECT_WEBVIEW2;
  assert.ok(expectedVersion, 'Specify the expected WebView2 version');
  const supportsExtensions = !process.argv.includes('--without-extensions');
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end('<!doctype html><title>' + (req.url === '/two' ? 'Second tab page' : 'First tab page') + '</title>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + fixture.address().port;
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  try {
    await page.evaluate(async url => { setLocale('zh'); await newBrowserTab(url + '/one'); }, url);
    const waitTitle = title => page.waitForFunction(title => curTab()?.title === title, title);
    await waitTitle('First tab page');
    const runtime = await page.evaluate(() => invoke('browser_runtime_info', {key:curTab().key}));
    assert.deepEqual(runtime, {version:expectedVersion, extensionsSupported:supportsExtensions});
    await page.evaluate(() => openBrowserExtensions());
    const list = page.locator('dialog[open] [data-extension-list]');
    await page.waitForFunction(() => document.querySelector('dialog[open] [data-extension-list]')?.getAttribute('aria-busy') === 'false');
    const loader = page.locator('dialog[open] .extension-loader');
    assert.equal(await loader.isVisible(), supportsExtensions);
    if (supportsExtensions) {
      assert.ok(await list.innerText());
      assert.ok(await loader.locator('[data-extension-install]').isEnabled());
    } else {
      assert.ok((await page.locator('dialog[open] [data-extension-status]').innerText()).includes(expectedVersion));
    }
    await page.locator('dialog[open] footer [data-extension-close]').click();
    await page.evaluate(url => browserNavigate(url + '/two'), url);
    await waitTitle('Second tab page');
    await page.evaluate(() => goBack());
    await waitTitle('First tab page');
    const removed = await page.evaluate(() => {
      const key = curTab().key;
      closeTab(state.tab);
      return !state.tabs.some(tab => tab.key === key);
    });
    assert.ok(removed, 'The fixture tab closes');
    assert.deepEqual(errors, []);
    console.log('Desktop WebView2 ' + runtime.version + ' passed navigation, back, extension dialog and tab close.');
  } finally {
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
  }
};

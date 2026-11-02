'use strict';
/* Browser tabs backed by native WebView2 child views. */

let browserEventsReady;
let browserBoundsGeneration = 0;

function browserBounds() {
  const rect = els.browserHost?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function browserTabFor(key) {
  return state.tabs.find((tb) => isBrowserTab(tb) && tb.key === key && !tb.disposed);
}

function cleanBrowserUrl(value) {
  return resolveBrowserAddress(value);
}

function browserTitle(tb) {
  if (!tb) return 'Browser';
  try { return tb.title || new URL(tb.url).hostname || 'Browser'; } catch { return tb.title || tb.url || 'Browser'; }
}

function createBrowserTabState(url, title = '') {
  return {
    kind: 'browser', key: crypto.randomUUID().replace(/-/g, ''), url, title,
    history: [], hIdx: -1, browserReady: false, browserPending: true,
    browserStarting: false, disposed: false,
  };
}

function renderBrowserSessionState(tb) {
  if (!tb || curTab() !== tb) return;
  els.browserHost.innerHTML = tb.browserReady ? '' : `<div class="browser-session-state preview-empty" role="status"><strong>${browserText(tb.error ? '网页未能打开' : '正在打开网页…', tb.error ? 'Could not open this page' : 'Opening page…')}</strong><small>${esc(tb.error || tb.url || '')}</small>${tb.error ? `<button type="button" data-browser-retry>${browserText('重试', 'Retry')}</button>` : ''}</div>`;
}

function rememberUrl(url, title = '') {
  if (!browserSettings().recordHistory) return;
  if (!url || !/^https?:\/\//i.test(url)) return;
  const history = store.get('urlHistory', []);
  const next = history.filter((item) => item.url !== url);
  next.unshift({ url, title, visitedAt: Date.now() });
  if (next.length > 200) next.length = 200;
  store.set('urlHistory', next);
}

function updateBrowserUi(tb) {
  if (!tb || curTab() !== tb) return;
  renderBrowserSessionState(tb);
  els.browserAddress.value = tb.url || '';
  els.browserBack.disabled = !(tb.hIdx > 0);
  els.browserForward.disabled = !(tb.hIdx >= 0 && tb.hIdx < tb.history.length - 1);
  renderTabs(); renderCrumbs(); renderStatus(); updateTitle();
  if (typeof renderWorkspace === 'function') renderWorkspace();
}

function onBrowserPage(ev) {
  const payload = ev.payload || {};
  const tb = browserTabFor(payload.key);
  if (!tb) return;
  if (payload.phase === 'new-window') {
    if (browserSettings().allowNewWindows) newBrowserTab(payload.url);
    else toast(browserText('已阻止网页打开新标签，可在浏览器设置中允许。', 'New tab blocked. Allow it in Browser settings.'));
    return;
  }
  if (tb.pendingNavigation) {
    if (payload.url !== tb.pendingNavigation) {
      // After the requested navigation starts, another navigating event may
      // represent its redirect. A late completion/title from the old page may
      // never replace a newer address the user has entered.
      if (!tb.pendingNavigationStarted || payload.phase !== 'navigating') return;
      tb.pendingNavigation = payload.url;
    }
    if (payload.phase === 'navigating' || payload.phase === 'started') tb.pendingNavigationStarted = true;
    if (payload.phase === 'finished') { tb.pendingNavigation = null; tb.pendingNavigationStarted = false; }
  }
  if (tb.browserStarting && payload.url === 'about:blank' && tb.url !== 'about:blank') return;
  if (payload.url) tb.url = payload.url;
  if (payload.title && payload.phase === 'title') tb.title = payload.title;
  if (payload.phase === 'finished' && payload.url && !/^about:blank$/i.test(payload.url)) {
    const existing = tb.history.indexOf(payload.url);
    if (existing >= 0) tb.hIdx = existing;
    else {
      tb.history = tb.history.slice(0, tb.hIdx + 1);
      tb.history.push(payload.url);
      tb.hIdx = tb.history.length - 1;
    }
    rememberUrl(payload.url, tb.title);
  }
  if (payload.phase === 'title' && browserSettings().recordHistory) {
    const history = store.get('urlHistory', []);
    const item = history.find((item) => item.url === tb.url);
    if (item) { item.title = tb.title; store.set('urlHistory', history); }
  }
  if (typeof persistBrowserSession === 'function') persistBrowserSession();
  updateBrowserUi(tb);
}

browserEventsReady = Promise.all([
  listen('browser-page', onBrowserPage),
  listen('browser-settings-error', (event) => toast(String(event.payload), true)),
]).catch(() => null);

async function syncBrowserBounds() {
  const generation = ++browserBoundsGeneration;
  const active = curTab();
  const covered = !!document.querySelector('dialog[open]') || !els.menuLayer.classList.contains('hidden');
  for (const tb of state.tabs.filter((item) => isBrowserTab(item) && item.browserReady)) {
    if (generation !== browserBoundsGeneration) return;
    await invoke('browser_set_active', { key: tb.key, active: tb === active && !covered, bounds: browserBounds() }).catch(() => {});
  }
}

function ensureBrowserTab(tb, retry = false) {
  if (!isBrowserTab(tb) || tb.disposed || tb.browserReady) return Promise.resolve(tb);
  if (tb.browserPromise) return tb.browserPromise;
  if (tb.error && !retry) return Promise.resolve(tb);
  tb.browserStarting = true; tb.error = null;
  tb.browserPromise = (async () => {
    try {
      await browserEventsReady;
      if (tb.disposed) return tb;
      const openingUrl = tb.url;
      await invoke('browser_create', {
        key: tb.key, url: openingUrl, bounds: browserBounds(),
        extensionPath: null, settings: nativeBrowserSettings(),
      });
      if (tb.disposed) { await invoke('browser_close', { key: tb.key }); return tb; }
      tb.browserReady = true; tb.browserPending = false;
      if (tb.pendingNavigation) {
        const next = tb.pendingNavigation, revision = tb.navigationRevision;
        if (next !== openingUrl) await navigateBrowserTab(tb, next, revision);
      }
      await syncBrowserBounds();
    } catch (error) {
      if (!tb.disposed) { tb.error = String(error); toast(tb.error, true); }
    } finally {
      tb.browserStarting = false; tb.browserPromise = null;
      if (!tb.disposed) updateBrowserUi(tb);
    }
    return tb;
  })();
  renderBrowserSessionState(tb);
  return tb.browserPromise;
}

async function newBrowserTab(url = browserNewTabUrl()) {
  let resolved;
  try { resolved = cleanBrowserUrl(url); } catch (error) { toast(String(error), true); return null; }
  const tb = createBrowserTabState(resolved);
  state.navToken++;
  state.tabs.push(tb); state.tab = state.tabs.length - 1;
  if (typeof persistBrowserSession === 'function') persistBrowserSession();
  renderAll();
  return ensureBrowserTab(tb);
}

function closeBrowserTab(tb) {
  if (!tb || !isBrowserTab(tb)) return;
  tb.disposed = true;
  if (tb.browserReady) invoke('browser_close', { key: tb.key }).catch(() => {});
  tb.browserReady = false;
  if (typeof persistBrowserSession === 'function') persistBrowserSession();
}

function browserAction(action) {
  const tb = curTab();
  if (!isBrowserTab(tb)) return;
  if (!tb.browserReady) { if (action === 'reload') return ensureBrowserTab(tb, true); return; }
  if (action === 'reload' && tb.pendingNavigation) return navigateBrowserTab(tb, tb.pendingNavigation, tb.navigationRevision);
  if (action === 'back' || action === 'forward') {
    tb.navigationRevision = (tb.navigationRevision || 0) + 1;
    tb.pendingNavigation = null; tb.pendingNavigationStarted = false;
  }
  invoke('browser_action', { key: tb.key, action }).catch((error) => toast(String(error), true));
}

async function navigateBrowserTab(tb, url, revision) {
  try { await invoke('browser_navigate', { key: tb.key, url }); }
  catch (error) {
    if (!tb.disposed && tb.navigationRevision === revision) {
      tb.navigationError = String(error); toast(tb.navigationError, true);
    }
  }
  // IPC acceptance is not page completion. Only matching page events may
  // clear the pending address; an older request cannot overwrite a newer one.
}

function browserNavigate(value) {
  const tb = curTab();
  if (!isBrowserTab(tb)) return;
  let url;
  try { url = cleanBrowserUrl(value); } catch (error) { toast(String(error), true); return; }
  tb.navigationRevision = (tb.navigationRevision || 0) + 1;
  tb.pendingNavigation = url; tb.pendingNavigationStarted = false; tb.navigationError = null;
  tb.url = url; tb.title = '';
  if (typeof persistBrowserSession === 'function') persistBrowserSession();
  if (!tb.browserReady) {
    return ensureBrowserTab(tb, true);
  }
  updateBrowserUi(tb);
  return navigateBrowserTab(tb, url, tb.navigationRevision);
}

function showBrowserHistory() {
  let dialog = $('browserHistoryDialog');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'browserHistoryDialog';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (ev) => {
      const folder = ev.target.closest('[data-history-folder]');
      if (folder) { dialog.close(); newTab(folder.dataset.historyFolder); }
      const url = ev.target.closest('[data-history-url]');
      if (url) { dialog.close(); if (isBrowserTab(curTab())) browserNavigate(url.dataset.historyUrl); else newBrowserTab(url.dataset.historyUrl); }
      if (ev.target.closest('[data-history-close]')) dialog.close();
    });
  }
  const folders = (state.folderHistory || []).slice(0, 50);
  const urls = store.get('urlHistory', []).slice(0, 50);
  dialog.innerHTML = `<header><div><span class="browser-history-eyebrow">DALIZI / HISTORY</span><h2>访问历史</h2></div><button type="button" data-history-close>×</button></header><div class="browser-history-body"><section><h3>文件夹路径</h3>${folders.length ? folders.map((item) => `<button class="browser-history-item" data-history-folder="${esc(item.path)}"><strong>${esc(basename(item.path))}</strong><small>${esc(item.path)}</small></button>`).join('') : '<p class="empty-note">暂无文件夹访问记录</p>'}</section><section><h3>网页地址</h3>${urls.length ? urls.map((item) => `<button class="browser-history-item" data-history-url="${esc(item.url)}"><strong>${esc(item.title || item.url)}</strong><small>${esc(item.url)}</small></button>`).join('') : '<p class="empty-note">暂无网页访问记录</p>'}</section></div>`;
  dialog.showModal();
}

function configureBrowserExtension() { openBrowserExtensions(); }

function syncBrowserWorkspace() {
  const tb = curTab();
  syncBrowserBounds();
  if (!isBrowserTab(tb)) return;
  if (tb.browserPending && !tb.browserStarting && !tb.error) ensureBrowserTab(tb);
  renderBrowserSessionState(tb);
  els.browserAddress.value = tb.url || '';
  els.browserBack.disabled = !(tb.hIdx > 0);
  els.browserForward.disabled = !(tb.hIdx >= 0 && tb.hIdx < tb.history.length - 1);
}

els.browserBack.addEventListener('click', () => browserAction('back'));
els.browserForward.addEventListener('click', () => browserAction('forward'));
els.browserReload.addEventListener('click', () => browserAction('reload'));
els.browserHome.addEventListener('click', () => browserNavigate(browserSettings().homeUrl));
els.browserHistory.addEventListener('click', showBrowserHistory);
els.browserExtensions.addEventListener('click', configureBrowserExtension);
els.browserAddressForm.addEventListener('submit', (ev) => { ev.preventDefault(); browserNavigate(els.browserAddress.value); });
els.browserHost.addEventListener('click', (event) => { if (event.target.closest('[data-browser-retry]')) browserAction('reload'); });
els.browserBack.innerHTML = IC.back;
els.browserForward.innerHTML = IC.fwd;
els.browserReload.innerHTML = IC.refresh;
els.browserHome.innerHTML = IC.home;
// Native child views sit above the HTML surface; hide them for app dialogs/menus.
new MutationObserver((changes) => {
  if (changes.some((change) => change.target.tagName === 'DIALOG' || change.target === els.menuLayer)) syncBrowserBounds();
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'class'] });
window.addEventListener('resize', syncBrowserBounds);



'use strict';
/* Optional URL-only session snapshots. Restored tabs load only when selected. */
const BROWSER_SESSION_LIMIT = 30;
const BROWSER_SESSION_BYTES = 256 * 1024;
let browserSessionInitialized = false;
let browserSessionRestoring = false;
let browserSessionClosing = false;

function browserSessionAllowed() {
  const settings = browserSettings();
  return settings.restoreSession && settings.recordHistory;
}

function browserSessionUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = browserHomeUrl(value);
    return url.length <= 4096 ? url : null;
  } catch { return null; }
}

function browserSessionTitle(value) {
  return [...String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ')].slice(0, 512).join('');
}

function normalizeBrowserSession(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(raw)).length > BROWSER_SESSION_BYTES) return null;
  } catch { return null; }
  if (Object.keys(raw).some((key) => !['version', 'tabs', 'active'].includes(key)) || raw.version !== 1 ||
      !Array.isArray(raw.tabs) || raw.tabs.length > BROWSER_SESSION_LIMIT ||
      !Number.isInteger(raw.active) || raw.active < -1 || raw.active >= raw.tabs.length) return null;
  const tabs = [];
  let active = -1;
  for (const [index, item] of raw.tabs.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some((key) => !['url', 'title'].includes(key)) ||
        typeof item.title !== 'string' || [...item.title].length > 512) return null;
    const url = browserSessionUrl(item.url);
    if (!url) continue;
    if (index === raw.active) active = tabs.length;
    tabs.push({ url, title: browserSessionTitle(item.title) });
  }
  return tabs.length ? { version: 1, tabs, active } : null;
}

function clearBrowserSession() {
  if (typeof clearWorkspaceBrowserSessions === 'function' && !clearWorkspaceBrowserSessions()) return false;
  if (store.get('browserSession', null) !== null) store.set('browserSession', null);
  return store.get('browserSession', null) === null;
}

function persistBrowserSession() {
  if (typeof persistWorkspaceSession === 'function') return persistWorkspaceSession();
  if (browserSessionClosing) return false;
  if (!browserSessionAllowed()) return clearBrowserSession();
  // Initial file rendering and asynchronous startup must not overwrite the
  // previous session before every placeholder tab has been reconstructed.
  if (!browserSessionInitialized || browserSessionRestoring) return false;
  const available = state.tabs.filter((tab) => isBrowserTab(tab) && !tab.disposed)
    .map((tab) => ({ tab, url: browserSessionUrl(tab.pendingNavigation || tab.url) })).filter((item) => item.url);
  const selected = available.slice(0, BROWSER_SESSION_LIMIT);
  const current = available.find((item) => item.tab === curTab());
  // Keep the active tab even when the session exceeds the storage limit,
  // preserving the relative order of every retained tab.
  if (current && !selected.includes(current)) selected[BROWSER_SESSION_LIMIT - 1] = current;
  const snapshot = selected.length ? {
    version: 1, tabs: selected.map(({ tab, url }) => ({ url, title: browserSessionTitle(tab.title) })),
    active: selected.findIndex((item) => item.tab === curTab()),
  } : null;
  if (JSON.stringify(store.get('browserSession', null)) !== JSON.stringify(snapshot)) store.set('browserSession', snapshot);
  return JSON.stringify(store.get('browserSession', null)) === JSON.stringify(snapshot);
}

function syncBrowserSessionPreference() {
  if (typeof syncWorkspaceSessionPrivacy === 'function') return syncWorkspaceSessionPrivacy();
  const saved = browserSessionAllowed() ? persistBrowserSession() : clearBrowserSession();
  if (!saved && (!browserSessionAllowed() || browserSessionInitialized)) {
    throw new Error(browserText('无法保存或清除本机网页会话，请检查本地存储。', 'Could not save or clear the local browser session. Check local storage.'));
  }
}

async function restoreBrowserSession({ preserveActive = false } = {}) {
  if (browserSessionInitialized || browserSessionRestoring || browserSessionClosing) return [];
  browserSessionRestoring = true;
  const snapshot = browserSessionAllowed() ? normalizeBrowserSession(store.get('browserSession', null)) : null;
  const restored = snapshot ? snapshot.tabs.map((item) => createBrowserTabState(item.url, item.title)) : [];
  const start = state.tabs.length;
  state.tabs.push(...restored);
  if (!preserveActive && snapshot && snapshot.active >= 0) { state.tab = start + snapshot.active; state.navToken++; }
  browserSessionInitialized = true;
  browserSessionRestoring = false;
  persistBrowserSession();
  if (restored.length) renderAll();
  const active = curTab();
  if (restored.includes(active)) await ensureBrowserTab(active);
  return restored;
}

function finishBrowserSession() {
  if (browserSessionClosing) return;
  persistBrowserSession();
  // Native teardown and late page events must not erase the just-saved tabs.
  browserSessionClosing = true;
}
window.addEventListener('beforeunload', finishBrowserSession);
window.addEventListener('pagehide', finishBrowserSession);

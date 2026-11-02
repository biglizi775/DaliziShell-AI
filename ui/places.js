'use strict';
/* Local favorites and URL/path-only workspace snapshots. Never restore terminals. */
const placeText = (zh, en) => locale === 'zh' ? zh : en;
const PLACE_LIMIT = 100, WORKSPACE_TAB_LIMIT = 50;
let workspaceSessionReady = false, workspaceSessionClosing = false, workspaceSessionRestoring = false;
let previousWorkspaceSession = null, workspaceSessionRestored = false;
let workspaceSessionSaveFailed = false;

function placeFolder(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) return null;
  const path = value.replace(/\//g, '\\');
  if (!/^[a-z]:\\/i.test(path) && !/^\\\\(?![?.]\\)[^\\]+\\[^\\]+/.test(path)) return null;
  if (/[<>"|?*]/.test(path) || path.slice(2).includes(':')) return null;
  return normalizeNavigationPath(path);
}
function placeTarget(value) {
  const path = placeFolder(value);
  if (path) return { kind: 'files', path };
  try { const url = browserHomeUrl(value); return url.length <= 4096 ? { kind: 'browser', url } : null; } catch { return null; }
}
function placeKey(item) {
  return item.kind === 'files' ? 'files:' + String(item.path || '').replace(/[\\/]+$/, '').toLowerCase() : 'browser:' + item.url;
}
function placeLabel(item) { return item.name || item.title || (item.kind === 'files' ? basename(item.path) || item.path : item.url) || t('thisPC'); }
function placeAddress(item) { return item.kind === 'files' ? item.path : item.url; }
function boundedPlaceTitle(value) { return [...String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ')].slice(0, 160).join(''); }
function readFavorites() {
  const raw = store.get('favorites', null);
  if (!raw || raw.version !== 1 || !Array.isArray(raw.items) || raw.items.length > PLACE_LIMIT) return [];
  const ids = new Set(), targets = new Set();
  return raw.items.flatMap((item) => {
    if (!item || typeof item.id !== 'string' || item.id.length > 100 || !item.id || ids.has(item.id)) return [];
    const target = placeTarget(placeAddress(item));
    if (!target || target.kind !== item.kind || targets.has(placeKey(target))) return [];
    ids.add(item.id); targets.add(placeKey(target));
    return [{ ...target, id: item.id, name: boundedPlaceTitle(item.name) || placeLabel(target) }];
  });
}
function saveFavorites(items) {
  if (items.length > PLACE_LIMIT) throw new Error(placeText('最多收藏 100 个位置', 'Up to 100 favorites'));
  const next = { version: 1, items };
  store.set('favorites', next);
  if (JSON.stringify(store.get('favorites', null)) !== JSON.stringify(next)) throw new Error(placeText('收藏保存失败，请检查本地存储', 'Could not save favorites; check local storage'));
  renderFavoritesBar();
}
function currentPlace() {
  const tab = curTab();
  if (isBrowserTab(tab)) {
    const target = placeTarget(tab.pendingNavigation || tab.url);
    return target?.kind === 'browser' ? { ...target, name: boundedPlaceTitle(tab.title) || tab.url } : null;
  }
  if (isTermTab(tab)) return null;
  const path = placeFolder(state.path);
  return path ? { kind: 'files', path, name: basename(path) || path } : null;
}
function addFavorite(value = currentPlace(), name, id) {
  const target = value && placeTarget(placeAddress(value));
  if (!target) throw new Error(placeText('请输入完整文件夹路径或 HTTP/HTTPS 网址', 'Enter an absolute folder path or HTTP/HTTPS URL'));
  const items = readFavorites();
  const existing = items.find((item) => item.id !== id && placeKey(item) === placeKey(target));
  if (existing) throw new Error(placeText('这个位置已经在收藏夹中', 'This location is already bookmarked'));
  const item = { ...target, id: id || crypto.randomUUID(), name: boundedPlaceTitle(name || value.name) || placeLabel(target) };
  const index = items.findIndex((entry) => entry.id === id);
  if (id && index < 0) throw new Error(placeText('此收藏已被移除', 'This favorite was removed'));
  if (index < 0) items.push(item); else items[index] = item;
  saveFavorites(items); return item;
}
function openFavorite(item, forceNew = false) {
  const target = placeTarget(placeAddress(item));
  if (!target) return;
  const existing = forceNew ? -1 : state.tabs.findIndex((tab) => !tab.disposed && !isTermTab(tab) && placeKey(isBrowserTab(tab) ? { kind: 'browser', url: tab.pendingNavigation || tab.url } : { kind: 'files', path: tab.path }) === placeKey(target));
  if (existing >= 0) switchTab(existing);
  else if (target.kind === 'browser') void newBrowserTab(target.url);
  else newTab(target.path);
}
function favoriteMenu(event, item) {
  event.preventDefault();
  const change = (action) => { try { const items = readFavorites(), index = items.findIndex((x) => x.id === item.id); if (index < 0) return; action(items, index); saveFavorites(items); } catch (error) { toast(String(error), true); } };
  showMenu(event.clientX, event.clientY, [
    { id: 'open', label: placeText('在新标签页打开', 'Open in new tab'), fn: () => openFavorite(item, true) },
    { id: 'edit', label: placeText('编辑收藏', 'Edit favorite'), fn: () => openPlacesSettings(item.id) },
    { id: 'left', label: placeText('向左移动', 'Move left'), fn: () => change((items, i) => { if (i) [items[i - 1], items[i]] = [items[i], items[i - 1]]; }) },
    { id: 'right', label: placeText('向右移动', 'Move right'), fn: () => change((items, i) => { if (i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]]; }) },
    { id: 'remove', label: placeText('移除收藏', 'Remove favorite'), fn: () => change((items, i) => items.splice(i, 1)) },
  ]);
}
function workspacePreferences() {
  const raw = store.get('workspacePreferences', {});
  const legacy = store.get('browserSettings', {});
  return { favoritesBar: raw?.favoritesBar !== false, rememberSession: raw?.rememberSession !== false,
    restoreOnStartup: typeof raw?.restoreOnStartup === 'boolean' ? raw.restoreOnStartup : typeof legacy?.restoreSession === 'boolean' ? legacy.restoreSession : true };
}
function saveWorkspacePreferences(update) {
  const next = { ...workspacePreferences(), ...update };
  store.set('workspacePreferences', next);
  if (JSON.stringify(store.get('workspacePreferences', null)) !== JSON.stringify(next)) throw new Error(placeText('偏好保存失败', 'Could not save preferences'));
  if (!next.rememberSession) clearWorkspaceSessions();
  else persistWorkspaceSession();
  renderFavoritesBar();
}
function renderFavoritesBar() {
  const bar = $('favoritesBar'); if (!bar) return;
  const hidden = !workspacePreferences().favoritesBar;
  document.body.classList.toggle('favorites-hidden', hidden);
  bar.classList.toggle('hidden', hidden);
  const place = currentPlace(), items = readFavorites();
  const selected = place && items.some((item) => placeKey(item) === placeKey(place));
  const html = `<button class="place-add${selected ? ' is-saved' : ''}" data-place-add ${!place || selected ? 'disabled' : ''} title="${placeText('收藏当前位置', 'Bookmark current location')}" aria-label="${placeText('收藏当前位置', 'Bookmark current location')}">${selected ? '★' : '☆'}</button><div class="favorite-items">${items.length ? items.map((item) => `<button data-favorite="${esc(item.id)}" title="${esc(placeAddress(item))}"><span aria-hidden="true">${item.kind === 'browser' ? IC.globe : IC.folderS}</span><span>${esc(item.name)}</span></button>`).join('') : `<span class="favorites-empty">${placeText('收藏文件夹与网页，一键直达', 'Keep folders and websites close at hand')}</span>`}</div><button data-place-restore ${!previousWorkspaceSession?.tabs.length || workspaceSessionRestored ? 'disabled' : ''} title="${placeText('恢复上次打开的标签', 'Restore previous tabs')}" aria-label="${placeText('恢复上次打开的标签', 'Restore previous tabs')}">↶</button><button data-place-manage title="${placeText('收藏与启动', 'Favorites & startup')}" aria-label="${placeText('收藏与启动', 'Favorites & startup')}">•••</button>`;
  if (bar.innerHTML !== html) bar.innerHTML = html;
}
function initPlaces() {
  // Import existing folder pins once; the sidebar's quick access stays intact.
  if (store.get('favorites', null) === null && Array.isArray(state.pinned) && state.pinned.length) {
    const items = [], keys = new Set();
    for (const value of state.pinned.slice(0, PLACE_LIMIT)) { const path = placeFolder(value); if (!path) continue; const item = { kind: 'files', path, id: crypto.randomUUID(), name: basename(path) || path }; if (!keys.has(placeKey(item))) { keys.add(placeKey(item)); items.push(item); } }
    if (items.length) try { saveFavorites(items); } catch (error) { toast(String(error), true); }
  }
  const bar = $('favoritesBar');
  bar.addEventListener('click', (event) => {
    if (event.target.closest('[data-place-add]')) { try { addFavorite(); toast(placeText('已添加收藏', 'Favorite added')); } catch (error) { toast(String(error), true); } }
    else if (event.target.closest('[data-place-manage]')) openPlacesSettings();
    else if (event.target.closest('[data-place-restore]')) void restorePreviousWorkspace();
    else { const item = readFavorites().find((x) => x.id === event.target.closest('[data-favorite]')?.dataset.favorite); if (item) openFavorite(item, event.ctrlKey || event.metaKey); }
  });
  bar.addEventListener('auxclick', (event) => { if (event.button !== 1) return; const item = readFavorites().find((x) => x.id === event.target.closest('[data-favorite]')?.dataset.favorite); if (item) { event.preventDefault(); openFavorite(item, true); } });
  bar.addEventListener('contextmenu', (event) => { const item = readFavorites().find((x) => x.id === event.target.closest('[data-favorite]')?.dataset.favorite); if (item) favoriteMenu(event, item); });
  renderFavoritesBar();
}

function normalizeWorkspaceSession(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.tabs) || raw.tabs.length > WORKSPACE_TAB_LIMIT || !Number.isInteger(raw.active) || raw.active < -1 || raw.active >= raw.tabs.length) return null;
  try { if (new TextEncoder().encode(JSON.stringify(raw)).length > 1024 * 1024) return null; } catch { return null; }
  const tabs = []; let active = -1;
  for (const [index, item] of raw.tabs.entries()) {
    if (!item || !['files', 'browser'].includes(item.kind)) continue;
    let target = item.kind === 'files' && item.path === null ? { kind: 'files', path: null } : placeTarget(placeAddress(item));
    if (!target || target.kind !== item.kind) continue;
    if (target.kind === 'browser' && !browserSettings().recordHistory) continue;
    if (index === raw.active) active = tabs.length;
    tabs.push(target.kind === 'browser' ? { ...target, title: boundedPlaceTitle(item.title) } : target);
  }
  return tabs.length ? { version: 1, tabs, active, updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0 } : null;
}
function persistWorkspaceSession() {
  if (!workspaceSessionReady || workspaceSessionClosing || workspaceSessionRestoring || !workspacePreferences().rememberSession) return false;
  const available = state.tabs.filter((tab) => !tab.disposed && !isTermTab(tab) && (!isBrowserTab(tab) || browserSettings().recordHistory));
  const tabs = available.slice(0, WORKSPACE_TAB_LIMIT);
  if (available.includes(curTab()) && !tabs.includes(curTab())) tabs[WORKSPACE_TAB_LIMIT - 1] = curTab();
  const snapshot = normalizeWorkspaceSession({ version: 1, tabs: tabs.map((tab) => isBrowserTab(tab) ? { kind: 'browser', url: tab.pendingNavigation || tab.url, title: tab.title || '' } : { kind: 'files', path: tab.path }), active: tabs.indexOf(curTab()), updatedAt: Date.now() });
  const old = store.get('workspaceSession', null);
  if (JSON.stringify(old && { ...old, updatedAt: 0 }) !== JSON.stringify(snapshot && { ...snapshot, updatedAt: 0 })) store.set('workspaceSession', snapshot);
  const actual = store.get('workspaceSession', null);
  const saved = JSON.stringify(actual && { ...actual, updatedAt: 0 }) === JSON.stringify(snapshot && { ...snapshot, updatedAt: 0 });
  if (!saved && !workspaceSessionSaveFailed) toast(placeText('无法保存标签会话，请检查本地存储；下次启动可能无法恢复。', 'Could not save tabs; check local storage. Next startup may not restore this session.'), true);
  workspaceSessionSaveFailed = !saved;
  return saved;
}
function clearWorkspaceSessions() {
  for (const key of ['workspaceSession', 'workspacePreviousSession', 'browserSession']) {
    store.set(key, null);
    if (store.get(key, null) !== null) throw new Error(placeText('无法清除会话记录', 'Could not clear session snapshots'));
  }
  previousWorkspaceSession = null; renderFavoritesBar();
}
function syncWorkspaceSessionPrivacy() {
  // Applying URL-history privacy must also remove URLs from the previous run.
  for (const key of ['workspaceSession', 'workspacePreviousSession']) {
    const normalized = normalizeWorkspaceSession(store.get(key, null));
    store.set(key, normalized);
    if (JSON.stringify(store.get(key, null)) !== JSON.stringify(normalized)) throw new Error(placeText('无法更新会话记录', 'Could not update session snapshots'));
  }
  previousWorkspaceSession = normalizeWorkspaceSession(previousWorkspaceSession);
  if (!browserSettings().recordHistory) store.set('browserSession', null);
  persistWorkspaceSession(); renderFavoritesBar();
}
function clearWorkspaceBrowserSessions() {
  const withoutPages = (raw) => {
    const value = normalizeWorkspaceSession(raw); if (!value) return null;
    const active = value.tabs[value.active];
    value.tabs = value.tabs.filter((tab) => tab.kind !== 'browser');
    value.active = value.tabs.indexOf(active);
    return value.tabs.length ? value : null;
  };
  for (const key of ['workspaceSession', 'workspacePreviousSession']) {
    const value = withoutPages(store.get(key, null)); store.set(key, value);
    if (JSON.stringify(store.get(key, null)) !== JSON.stringify(value)) return false;
  }
  previousWorkspaceSession = withoutPages(previousWorkspaceSession); renderFavoritesBar(); return true;
}
async function loadWorkspaceTabs(snapshot, append = false, preserveActive = false) {
  if (!snapshot || workspaceSessionRestoring) return [];
  workspaceSessionRestoring = true;
  const original = append ? [...state.tabs] : [], used = new Set(), restored = [], positions = [];
  if (!append) state.tabs = [];
  for (const item of snapshot.tabs) {
    const existing = original.findIndex((tab, i) => !used.has(i) && !tab.disposed && !isTermTab(tab) && placeKey(isBrowserTab(tab) ? { kind: 'browser', url: tab.pendingNavigation || tab.url } : { kind: 'files', path: tab.path }) === placeKey(item));
    if (existing >= 0) { used.add(existing); positions.push(existing); continue; }
    const tab = item.kind === 'browser' ? createBrowserTabState(item.url, item.title) : { kind: 'files', path: item.path, history: [item.path], hIdx: 0 };
    positions.push(state.tabs.length); state.tabs.push(tab); restored.push(tab);
  }
  if (!preserveActive) { state.tab = positions[Math.max(0, snapshot.active)]; state.navToken++; }
  workspaceSessionRestored = true;
  workspaceSessionRestoring = false;
  persistWorkspaceSession(); renderAll();
  const active = curTab();
  if (preserveActive) return restored;
  if (isBrowserTab(active)) await ensureBrowserTab(active);
  else await navigate(active.path, { push: false });
  return restored;
}
async function restoreWorkspaceOnStartup({ initialTab, initialToken }) {
  const preferences = workspacePreferences();
  let snapshot = normalizeWorkspaceSession(store.get('workspaceSession', null));
  if (!snapshot && preferences.rememberSession) {
    const legacy = normalizeBrowserSession(store.get('browserSession', null));
    if (legacy) snapshot = normalizeWorkspaceSession({ version: 1, tabs: [{ kind: 'files', path: placeFolder(store.get('lastPath', null)) }, ...legacy.tabs.map((item) => ({ ...item, kind: 'browser' }))], active: legacy.active < 0 ? 0 : legacy.active + 1, updatedAt: 0 });
  }
  previousWorkspaceSession = preferences.rememberSession ? snapshot || normalizeWorkspaceSession(store.get('workspacePreviousSession', null)) : null;
  store.set('workspacePreviousSession', previousWorkspaceSession);
  workspaceSessionReady = true;
  if (!preferences.rememberSession) clearWorkspaceSessions();
  const untouched = curTab() === initialTab && state.navToken === initialToken;
  if (preferences.restoreOnStartup && previousWorkspaceSession) await loadWorkspaceTabs(previousWorkspaceSession, !untouched, !untouched);
  else if (untouched) await navigate(store.get('lastPath', null), { push: true });
  persistWorkspaceSession(); renderFavoritesBar();
}
async function restorePreviousWorkspace() {
  if (!previousWorkspaceSession || workspaceSessionRestored || workspaceSessionRestoring) return;
  const onlyHome = state.tabs.length === 1 && !isTermTab(curTab()) && !isBrowserTab(curTab()) && curTab().path === null && state.path === null;
  await loadWorkspaceTabs(previousWorkspaceSession, !onlyHome);
  toast(placeText('已恢复上次的文件夹和网页标签', 'Previous folders and web tabs restored'));
}
function finishWorkspaceSession() { if (!workspaceSessionClosing) persistWorkspaceSession(); workspaceSessionClosing = true; }
window.addEventListener('beforeunload', finishWorkspaceSession);
window.addEventListener('pagehide', finishWorkspaceSession);

function openPlacesSettings(editId = '') {
  closeMenu();
  if ($('placesDialog')?.open) { $('placesDialog').focus(); return; }
  const dialog = document.createElement('dialog'); dialog.id = 'placesDialog'; dialog.className = 'file-settings-dialog places-dialog';
  dialog.setAttribute('aria-labelledby', 'placesTitle');
  const T = placeText, prefs = workspacePreferences();
  dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">DALIZI / PLACES</span><h2 id="placesTitle">${T('收藏与启动', 'Favorites & startup')}</h2></div><button type="button" data-places-close aria-label="${T('关闭', 'Close')}">×</button></header><div class="file-settings-body"><section class="workspace-settings-section"><h3>${T('继续上次的工作', 'Continue where you left off')}</h3><p>${T('保存最多 50 个文件夹和网页标签的路径、地址、顺序与选中位置；后台网页选中时才加载。不会恢复终端、SSH、网页表单或 AI 对话。', 'Save paths, URLs, order and selection for up to 50 folder and web tabs. Background pages load when selected. Terminals, SSH, forms and AI chats are not restored.')}</p>${[['favoritesBar', T('显示收藏夹栏', 'Show favorites bar')], ['rememberSession', T('记住打开的标签', 'Remember open tabs')], ['restoreOnStartup', T('启动时自动恢复', 'Restore on startup')]].map(([key, title]) => `<label class="settings-preference"><strong>${title}</strong><input type="checkbox" data-place-pref="${key}" ${prefs[key] ? 'checked' : ''}></label>`).join('')}<div class="places-actions"><button type="button" data-places-restore ${!previousWorkspaceSession || workspaceSessionRestored ? 'disabled' : ''}>${workspaceSessionRestored ? T('本次已恢复', 'Already restored') : T('立即恢复上次标签', 'Restore previous tabs')}</button><button type="button" data-places-clear>${T('清除会话记录', 'Clear session snapshots')}</button></div></section><section class="workspace-settings-section"><h3>${T('收藏夹', 'Favorites')}</h3><p>${T('支持完整文件夹路径和 http/https 网址；单击跳转，右键调整顺序或编辑。', 'Add absolute folder paths and HTTP/HTTPS URLs. Click to open; right-click to reorder or edit.')}</p><form id="favoriteForm" class="favorite-form"><label>${T('名称', 'Name')}<input name="name" maxlength="160" required></label><label>${T('文件夹路径或网址', 'Folder path or URL')}<input name="address" maxlength="4096" required spellcheck="false" placeholder="D:\\Projects / https://example.com"></label><div class="places-actions"><button type="submit" class="file-settings-primary">${T('保存收藏', 'Save favorite')}</button><button type="button" data-places-new>${T('新增', 'New')}</button><button type="button" data-places-current>${T('填入当前位置', 'Use current location')}</button></div></form><input id="favoriteFilter" aria-label="${T('筛选收藏', 'Filter favorites')}" placeholder="${T('搜索收藏名称或地址', 'Filter by name or address')}"><div id="favoriteList"></div></section></div><footer class="file-settings-footer"><span id="placesStatus" role="status">${T('偏好即时保存到本机', 'Preferences save locally as you change them')}</span><button type="button" data-places-close>${T('完成', 'Done')}</button></footer>`;
  document.body.appendChild(dialog);
  const form = dialog.querySelector('form'), status = dialog.querySelector('#placesStatus'); let editing = editId;
  const fill = (item) => { form.elements.namedItem('name').value = item?.name || ''; form.elements.namedItem('address').value = item ? placeAddress(item) || '' : ''; };
  const paint = () => { const query = dialog.querySelector('#favoriteFilter').value.toLowerCase(); dialog.querySelector('#favoriteList').innerHTML = readFavorites().filter((item) => (item.name + ' ' + placeAddress(item)).toLowerCase().includes(query)).map((item) => `<article class="favorite-row"><button type="button" data-place-open="${esc(item.id)}"><strong>${esc(item.name)}</strong><small>${esc(placeAddress(item))}</small></button><button type="button" data-place-edit="${esc(item.id)}">${T('编辑', 'Edit')}</button><button type="button" data-place-remove="${esc(item.id)}">${T('移除', 'Remove')}</button></article>`).join('') || `<p>${T('暂无收藏', 'No favorites')}</p>`; };
  fill(readFavorites().find((x) => x.id === editId)); paint();
  form.addEventListener('submit', (event) => { event.preventDefault(); try { const target = placeTarget(form.elements.namedItem('address').value.trim()); addFavorite(target, form.elements.namedItem('name').value.trim(), editing || undefined); editing = ''; fill(null); paint(); status.textContent = T('收藏已保存', 'Favorite saved'); } catch (error) { status.textContent = String(error); } });
  dialog.querySelector('#favoriteFilter').addEventListener('input', paint);
  dialog.addEventListener('change', (event) => { const key = event.target.dataset.placePref; if (!key) return; try { saveWorkspacePreferences({ [key]: event.target.checked }); status.textContent = T('设置已保存', 'Settings saved'); } catch (error) { event.target.checked = workspacePreferences()[key]; status.textContent = String(error); } });
  dialog.addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button) return;
    try {
      if (button.hasAttribute('data-places-close')) dialog.close();
      else if (button.hasAttribute('data-places-new')) { editing = ''; fill(null); }
      else if (button.hasAttribute('data-places-current')) { editing = ''; fill(currentPlace()); }
      else if (button.hasAttribute('data-places-restore')) { dialog.close(); void restorePreviousWorkspace(); }
      else if (button.hasAttribute('data-places-clear')) { clearWorkspaceSessions(); dialog.querySelector('[data-places-restore]').disabled = true; status.textContent = T('记录已清除；启用记住标签时，后续导航会重新保存。', 'Snapshots cleared. Future navigation saves again if Remember tabs is enabled.'); }
      else if (button.dataset.placeEdit) { editing = button.dataset.placeEdit; fill(readFavorites().find((x) => x.id === editing)); form.elements.namedItem('name').focus(); }
      else if (button.dataset.placeRemove) { saveFavorites(readFavorites().filter((x) => x.id !== button.dataset.placeRemove)); if (editing === button.dataset.placeRemove) { editing = ''; fill(null); } paint(); }
      else if (button.dataset.placeOpen) { const item = readFavorites().find((x) => x.id === button.dataset.placeOpen); if (item) { dialog.close(); openFavorite(item); } }
    } catch (error) { status.textContent = String(error); }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}

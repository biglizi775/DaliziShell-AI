'use strict';
/* Browser preferences are separate from the workspace WebView and its storage. */
const browserText = (zh, en) => locale === 'zh' ? zh : en;
const BROWSER_DEFAULTS = Object.freeze({
  homeUrl: 'https://www.google.com/', newTabPage: 'home', searchEngine: 'google',
  recordHistory: true, restoreSession: false, allowNewWindows: true, zoom: 1, colorScheme: 'system',
  javascriptEnabled: true, contextMenusEnabled: true, devToolsEnabled: true,
  autofillEnabled: true, passwordAutosaveEnabled: false, downloadDirectory: '',
});
const BROWSER_SEARCH = Object.freeze({ google: 'https://www.google.com/search?q=', bing: 'https://www.bing.com/search?q=', baidu: 'https://www.baidu.com/s?wd=', duckduckgo: 'https://duckduckgo.com/?q=' });

function browserHomeUrl(value) {
  const raw = String(value || '').trim();
  if (raw === 'about:blank') return raw;
  if (!raw || raw.length > 4096 || /[\x00-\x1f\x7f]/.test(raw)) throw new Error(browserText('请输入有效的主页网址', 'Enter a valid home URL'));
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error(browserText('主页只支持 HTTP、HTTPS 或 about:blank', 'Home supports HTTP, HTTPS or about:blank'));
  return url.href;
}

function normalizeBrowserSettings(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...BROWSER_DEFAULTS };
  try { if (typeof input.homeUrl === 'string') out.homeUrl = browserHomeUrl(input.homeUrl); } catch {}
  for (const key of ['recordHistory', 'restoreSession', 'allowNewWindows', 'javascriptEnabled', 'contextMenusEnabled', 'devToolsEnabled', 'autofillEnabled', 'passwordAutosaveEnabled']) if (typeof input[key] === 'boolean') out[key] = input[key];
  if (['home', 'blank'].includes(input.newTabPage)) out.newTabPage = input.newTabPage;
  if (Object.hasOwn(BROWSER_SEARCH, input.searchEngine)) out.searchEngine = input.searchEngine;
  if (['system', 'light', 'dark'].includes(input.colorScheme)) out.colorScheme = input.colorScheme;
  if (typeof input.zoom === 'number' && Number.isFinite(input.zoom) && input.zoom >= .5 && input.zoom <= 2) out.zoom = input.zoom;
  if (typeof input.downloadDirectory === 'string' && input.downloadDirectory.length <= 1024 && !/[\x00-\x1f\x7f]/.test(input.downloadDirectory)) out.downloadDirectory = input.downloadDirectory.trim();
  return out;
}
function browserSettings() { const settings = normalizeBrowserSettings(store.get('browserSettings', {})); if (typeof workspacePreferences === 'function') settings.restoreSession = workspacePreferences().restoreOnStartup; return settings; }
function nativeBrowserSettings(settings = browserSettings()) {
  return Object.fromEntries(['zoom', 'javascriptEnabled', 'contextMenusEnabled', 'devToolsEnabled', 'autofillEnabled', 'passwordAutosaveEnabled', 'colorScheme', 'downloadDirectory'].map((key) => [key, settings[key]]));
}
function browserNewTabUrl() { const settings = browserSettings(); return settings.newTabPage === 'blank' ? 'about:blank' : settings.homeUrl; }

function resolveBrowserAddress(value, settings = browserSettings()) {
  const raw = String(value || '').trim();
  if (!raw) return settings.homeUrl;
  if (raw.length > 4096 || /[\x00-\x1f\x7f]/.test(raw)) throw new Error(browserText('地址或搜索词过长或包含控制字符', 'Address or search contains invalid characters or is too long'));
  // Check host:port before URI schemes so localhost:3000 remains an address.
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(raw)) return browserHomeUrl(`http://${raw}`);
  if (/^(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+:\d+(?:[/?#]|$)/u.test(raw)) return browserHomeUrl(`https://${raw}`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return browserHomeUrl(raw);
  if (!/\s/.test(raw) && /^(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+(?::\d+)?(?:[/?#]|$)/u.test(raw)) return browserHomeUrl(`https://${raw}`);
  return (BROWSER_SEARCH[settings.searchEngine] || BROWSER_SEARCH.google) + encodeURIComponent(raw);
}

async function saveBrowserSettings(settings) {
  const next = normalizeBrowserSettings(settings);
  next.homeUrl = browserHomeUrl(settings.homeUrl);
  const previous = browserSettings();
  await invoke('browser_settings_apply', { settings: nativeBrowserSettings(next) });
  store.set('browserSettings', next);
  if (JSON.stringify(normalizeBrowserSettings(store.get('browserSettings', {}))) !== JSON.stringify(next)) {
    await invoke('browser_settings_apply', { settings: nativeBrowserSettings(previous) });
    throw new Error(browserText('本地偏好保存失败，已恢复原设置', 'Could not save preferences; previous settings restored'));
  }
  if (typeof saveWorkspacePreferences === 'function') saveWorkspacePreferences({ restoreOnStartup: next.restoreSession });
  if (typeof syncBrowserSessionPreference === 'function') {
    try { syncBrowserSessionPreference(); }
    catch (error) { throw new Error(browserText('浏览器设置已保存，但会话快照保存或清理失败：', 'Browser settings saved, but saving or clearing the session snapshot failed: ') + String(error)); }
  }
  return next;
}

function browserSettingsTarget() {
  const current = curTab();
  return (isBrowserTab(current) && current.browserReady && !current.disposed ? current : state.tabs.find((tb) => isBrowserTab(tb) && tb.browserReady && !tb.disposed));
}

function openBrowserSettings() {
  if ($('browserSettingsDialog')?.open) { $('browserSettingsDialog').focus(); return; }
  closeMenu();
  const dialog = document.createElement('dialog'); dialog.id = 'browserSettingsDialog'; dialog.className = 'file-settings-dialog browser-settings-dialog';
  dialog.setAttribute('aria-labelledby', 'browserSettingsTitle');
  const T = browserText;
  const select = (name, title, detail, options) => `<label class="settings-preference"><span><strong>${title}</strong><small>${detail}</small></span><select name="${name}">${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>`;
  const toggle = (name, title, detail) => `<label class="settings-preference"><span><strong>${title}</strong><small>${detail}</small></span><input name="${name}" type="checkbox" role="switch"></label>`;
  const text = (name, title, detail, placeholder) => `<label class="browser-settings-input"><strong>${title}</strong><input name="${name}" type="text" spellcheck="false" maxlength="${name === 'homeUrl' ? 4096 : 1024}" placeholder="${esc(placeholder)}"><small>${detail}</small></label>`;
  const groups = [['general', T('常规与搜索', 'General & search')], ['appearance', T('网页外观', 'Page appearance')], ['privacy', T('隐私与数据', 'Privacy & data')], ['content', T('网页行为', 'Page behavior')], ['downloads', T('下载', 'Downloads')], ['extensions', T('扩展', 'Extensions')]];
  const section = (id, content) => `<section class="workspace-settings-section" id="browser-section-${id}" tabindex="-1"><h3>${groups.find((group) => group[0] === id)[1]}</h3>${content}</section>`;
  dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">DALIZI / BROWSER</span><h2 id="browserSettingsTitle">${T('浏览器设置', 'Browser settings')}</h2></div><button type="button" data-browser-settings-action="close" aria-label="${T('关闭', 'Close')}">×</button></header><form id="browserSettingsForm"><div class="browser-settings-layout"><nav aria-label="${T('设置分类', 'Settings categories')}">${groups.map(([id, title]) => `<button type="button" data-browser-section="${id}">${title}</button>`).join('')}</nav><div class="file-settings-body">
  ${section('general', text('homeUrl', T('主页地址', 'Home page'), T('点击工具栏主页按钮时打开；支持 http、https 和 about:blank。', 'Used by the Home button. Supports HTTP, HTTPS and about:blank.'), 'https://www.google.com/') + select('newTabPage', T('新建网页标签时', 'New browser tabs'), T('不影响文件夹和终端标签。', 'Does not affect folder or terminal tabs.'), [['home', T('打开主页', 'Open home page')], ['blank', T('打开空白页', 'Open blank page')]]) + toggle('restoreSession', T('启动时恢复文件夹和网页标签', 'Restore folders and web tabs on startup'), T('与“收藏与启动”共用设置。关闭自动恢复后仍可手动恢复；关闭记录网页历史会从会话中移除网址，不影响文件夹。', 'Shared with Favorites & startup. When automatic restoration is off, manual restoration remains available. Disabling URL history removes web tabs from snapshots, preserving folders.')) + select('searchEngine', T('地址栏搜索引擎', 'Address bar search'), T('输入关键词即可搜索；完整网址直接打开。', 'Search keywords or navigate directly to an address.'), [['google', 'Google'], ['bing', 'Bing'], ['baidu', T('百度', 'Baidu')], ['duckduckgo', 'DuckDuckGo']]))}
  ${section('appearance', select('zoom', T('默认网页缩放', 'Default page zoom'), T('保存时应用到所有网页标签，新标签沿用。', 'Applies to all current tabs when saved and to new tabs.'), [.5,.67,.75,.8,.9,1,1.1,1.25,1.5,1.75,2].map((value) => [value, `${Math.round(value * 100)}%`])) + select('colorScheme', T('网页配色偏好', 'Page color preference'), T('支持配色的网站会响应；不强制修改网页颜色。', 'Used by sites that support color schemes; does not recolor every site.'), [['system', T('跟随系统', 'System')], ['light', T('浅色', 'Light')], ['dark', T('深色', 'Dark')]]))}
  ${section('privacy', toggle('recordHistory', T('记录网页访问历史', 'Record URL history'), T('关闭后停止新增应用内网页历史，已有记录需手动清理；这不是无痕模式。', 'Stops new app URL history. Existing history remains until cleared; this is not private browsing.')) + toggle('autofillEnabled', T('自动填充表单', 'Form autofill'), T('保存并填充姓名、地址等一般表单信息，不包含密码。', 'Save and fill general form data such as names and addresses, excluding passwords.')) + toggle('passwordAutosaveEnabled', T('提示保存密码', 'Offer to save passwords'), T('关闭后不再提示保存新密码；已保存密码仍可能自动填充。', 'Disabling stops new save prompts; previously saved passwords may still autofill.')) + `<div class="browser-settings-actions"><button type="button" data-browser-settings-action="history">${T('查看访问历史', 'View history')}</button><button type="button" data-browser-settings-action="clear-data">${T('清除浏览数据…', 'Clear browsing data…')}</button></div>`)}
  ${section('content', toggle('allowNewWindows', T('允许网页打开新标签', 'Allow pages to open new tabs'), T('关闭会阻止弹窗，以及要求新标签打开的网页链接。', 'Disabling blocks popups and page links that request a new tab.')) + toggle('javascriptEnabled', T('允许 JavaScript', 'Allow JavaScript'), T('关闭可能影响登录与交互；保存后在刷新或下次导航时生效。', 'Disabling may break login and interaction. Applies on reload or next navigation.')) + toggle('contextMenusEnabled', T('网页右键菜单', 'Page context menus'), T('显示 WebView2 的复制、链接等菜单。', 'Show WebView2 context menus for links, copying and other actions.')) + toggle('devToolsEnabled', T('允许开发者工具', 'Allow developer tools'), T('允许通过网页右键菜单或快捷键调试网页。', 'Allow page debugging through context menus or keyboard shortcuts.')))}
  ${section('downloads', text('downloadDirectory', T('默认下载目录', 'Default download folder'), T('填写已存在的绝对目录；留空使用系统下载目录。目录不会被自动创建。', 'Enter an existing absolute directory; leave empty for the system Downloads folder. No directory is created.'), 'D:\\Downloads') + `<div class="browser-settings-actions"><button type="button" data-browser-settings-action="downloads">${T('打开下载管理', 'Open downloads')}</button><button type="button" data-browser-settings-action="download-folder">${T('在文件标签中打开下载目录', 'Open download folder in a file tab')}</button></div><small>${T('请先保存修改再打开；下载面板或文件标签会关闭设置窗口。', 'Save changes first. Opening the download panel or folder closes this settings window.')}</small>`)}
  ${section('extensions', `<p>${T('管理共享浏览器配置中的扩展；需要至少一个已打开的网页标签。', 'Manage extensions in the shared browser profile. Requires an open browser tab.')}</p><div class="browser-settings-actions"><button type="button" data-browser-settings-action="extensions">${T('打开扩展管理', 'Manage extensions')}</button></div>`)}
  </div></div><footer class="file-settings-footer"><div class="browser-settings-status"><span id="browserSettingsStatus" role="status">${T('设置保存在本机，保存后应用到所有网页标签。', 'Preferences are local and apply to all browser tabs when saved.')}</span><small>${T('关闭不保存；恢复默认不会清除浏览数据。', 'Closing discards edits; restoring defaults does not clear browsing data.')}</small></div><button type="button" data-browser-settings-action="reset">${T('恢复默认', 'Defaults')}</button><button type="button" data-browser-settings-action="back">${T('返回设置', 'Back')}</button><button type="submit" class="file-settings-primary">${T('保存并应用', 'Save & apply')}</button></footer></form>`;
  document.body.appendChild(dialog);
  const form = dialog.querySelector('form'), status = dialog.querySelector('#browserSettingsStatus');
  let busy = false;
  const fill = (settings) => { for (const [key, value] of Object.entries(settings)) { const field = form.elements.namedItem(key); if (!field) continue; if (field.type === 'checkbox') field.checked = value; else field.value = String(value); } };
  const draftSettings = () => Object.fromEntries(Object.keys(BROWSER_DEFAULTS).map((key) => { const field = form.elements.namedItem(key); return [key, field.type === 'checkbox' ? field.checked : key === 'zoom' ? Number(field.value) : field.value.trim()]; }));
  fill(browserSettings());
  form.addEventListener('input', () => { status.textContent = T('有未保存的更改', 'Unsaved changes'); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy) return;
    const draft = draftSettings();
    busy = true; form.querySelectorAll('input,select,button').forEach((node) => { node.disabled = true; });
    status.textContent = T('正在应用…', 'Applying…');
    try { fill(await saveBrowserSettings(draft)); status.textContent = T('已保存。网页内容设置在刷新或下次导航时生效。', 'Saved. Content settings apply on reload or next navigation.'); }
    catch (error) { status.textContent = String(error); }
    finally { busy = false; form.querySelectorAll('input,select,button').forEach((node) => { node.disabled = false; }); }
  });
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (event) => {
    if (busy) return;
    const sectionButton = event.target.closest('[data-browser-section]');
    if (sectionButton) { const target = dialog.querySelector(`#browser-section-${sectionButton.dataset.browserSection}`); target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); }
    const action = event.target.closest('[data-browser-settings-action]')?.dataset.browserSettingsAction;
    if (action === 'close') dialog.close();
    if (action === 'back') { dialog.close(); openWorkspaceSettings(); }
    if (action === 'reset') { fill(BROWSER_DEFAULTS); status.textContent = T('已填入默认值，点击“保存并应用”后生效。', 'Defaults filled. Save & apply to use them.'); }
    if (action === 'history') showBrowserHistory();
    if (action === 'clear-data') openBrowserClearData();
    if (action === 'downloads' || action === 'download-folder') {
      const draft = draftSettings(), saved = browserSettings();
      if (Object.keys(BROWSER_DEFAULTS).some((key) => draft[key] !== saved[key])) {
        status.textContent = T('请先保存修改，再打开下载管理或下载目录。', 'Save your changes before opening downloads or the download folder.');
        return;
      }
      if (action === 'downloads') openBrowserDownloads(dialog);
      else openBrowserDownloadFolder(dialog);
    }
    if (action === 'extensions') {
      const target = browserSettingsTarget();
      if (!target) { status.textContent = T('请先打开一个网页标签，再管理扩展。', 'Open a browser tab to manage extensions.'); return; }
      openBrowserExtensions(target);
    }
  });
  dialog.showModal();
}

function openBrowserClearData() {
  if ($('browserClearDataDialog')?.open) return;
  const T = browserText, target = browserSettingsTarget();
  const dialog = document.createElement('dialog'); dialog.id = 'browserClearDataDialog'; dialog.className = 'file-settings-dialog browser-clear-dialog';
  dialog.setAttribute('aria-labelledby', 'browserClearTitle');
  dialog.innerHTML = `<header class="file-settings-head"><h2 id="browserClearTitle">${T('清除浏览数据', 'Clear browsing data')}</h2><button type="button" data-clear-close aria-label="${T('关闭', 'Close')}">×</button></header><form id="browserClearDataForm"><div class="file-settings-body"><p>${T('时间范围：全部时间。仅影响本应用的网页浏览器配置。', 'Time range: all time. Affects only this app’s browser profile.')}</p><label class="settings-preference"><span><strong>${T('网页访问历史', 'URL history')}</strong><small>${T('清空应用保存的网页地址；保留文件夹访问历史和当前标签的前进/后退。', 'Clear app URL history; retain folder history and current tab back/forward lists.')}</small></span><input name="history" type="checkbox"></label><label class="settings-preference"><span><strong>${T('上次网页标签快照', 'Saved browser tab snapshot')}</strong><small>${T('只清除保存的会话，不关闭现有标签。后续导航或切换可能再次保存；关闭“启动时恢复网页标签”可停止保存。', 'Clear the saved session without closing current tabs. Later navigation or switching may save again; turn off session restore to stop saving.')}</small></span><input name="session" type="checkbox"></label><label class="settings-preference"><span><strong>${T('缓存的图片和文件', 'Cached images and files')}</strong><small>${T('下次访问网站可能需要重新下载资源。', 'Sites may need to download resources again.')}</small></span><input name="cache" type="checkbox" ${target ? '' : 'disabled'}></label><label class="settings-preference"><span><strong>${T('Cookie 与网站数据', 'Cookies & site data')}</strong><small>${T('会退出网站登录，并移除网站本地存储；作用于所有网页标签。', 'Signs you out and removes site storage across all browser tabs.')}</small></span><input name="cookies" type="checkbox" ${target ? '' : 'disabled'}></label><p role="status" id="browserClearStatus">${target ? T('请选择要清除的项目，然后确认。清除后无法撤销。', 'Select data to clear, then confirm. Clearing cannot be undone.') : T('清理缓存与网站数据需要先打开一个网页标签。', 'Open a browser tab to clear cache or site data.')}</p></div><footer class="file-settings-footer"><button type="button" data-clear-close>${T('取消', 'Cancel')}</button><span class="file-settings-spacer"></span><button type="submit" class="file-settings-primary" disabled>${T('确认清除', 'Confirm clear')}</button></footer></form>`;
  document.body.appendChild(dialog); const form = dialog.querySelector('form'), status = dialog.querySelector('#browserClearStatus'); let busy = false;
  const selection = () => [...form.querySelectorAll('input:checked:not(:disabled)')].map((input) => input.name);
  form.addEventListener('change', () => { form.querySelector('[type=submit]').disabled = !selection().length; });
  dialog.addEventListener('click', (event) => { if (!busy && event.target.closest('[data-clear-close]')) dialog.close(); });
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy) return; const selected = selection(); if (!selected.length) return;
    busy = true; form.querySelectorAll('input,button').forEach((node) => { node.disabled = true; }); status.textContent = T('正在清除…', 'Clearing…');
    try {
      const kinds = selected.filter((kind) => kind === 'cache' || kind === 'cookies');
      if (kinds.length) await invoke('browser_clear_data', { key: target.key, kinds });
      if (selected.includes('history')) { store.set('urlHistory', []); if (store.get('urlHistory', []).length) throw new Error(T('网页历史保存失败', 'Could not clear URL history')); if (typeof clearClosedBrowserTabs === 'function') clearClosedBrowserTabs(); }
      if (selected.includes('session') && !clearBrowserSession()) throw new Error(T('网页会话快照清除失败', 'Could not clear the saved browser session'));
      status.textContent = T('所选数据已清除。已打开的网站仍可能生成新的数据。', 'Selected data cleared. Open websites may create new data.');
      form.querySelectorAll('input').forEach((node) => { node.checked = false; });
    } catch (error) { status.textContent = String(error); }
    finally { busy = false; form.querySelectorAll('input,button').forEach((node) => { node.disabled = node.type === 'checkbox' && ['cache', 'cookies'].includes(node.name) && !target; }); form.querySelector('[type=submit]').disabled = !selection().length; }
  });
  dialog.showModal();
}

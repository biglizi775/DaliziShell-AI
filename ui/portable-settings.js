'use strict';
/* Disk is authoritative for portable fields; machine paths remain in localStorage. */
const PORTABLE_KEYS = ['locale', 'theme', 'visualStyle', 'viewMode', 'sortKey', 'sortDir', 'showHidden', 'previewOpen', 'columns.v1', 'workspacePreferences', 'browserSettings', 'favorites', 'urlHistory'];
let portableStatus = null, portableLoaded = false, portablePaused = false, portableTransition = false;
let portablePending = null, portableWriter = null, portableLastSnapshot = '';
const portableText = (zh, en) => locale === 'zh' ? zh : en;

function portableSnapshot() {
  const result = { locale, theme: store.get('theme', 'light'), visualStyle: normalizeWorkspaceVisualStyle(store.get('visualStyle', 'studio')), viewMode: state.viewMode, sortKey: state.sortKey, sortDir: state.sortDir,
    showHidden: state.showHidden, previewOpen, 'columns.v1': columnLayout, workspacePreferences: workspacePreferences(), browserSettings: browserSettings() };
  // Include empty collections so clearing them follows the application to another PC.
  result.favorites = { version: 1, items: readFavorites().filter((item) => item.kind === 'browser') };
  result.urlHistory = store.get('urlHistory', []);
  if (result.browserSettings) { result.browserSettings = { ...result.browserSettings }; delete result.browserSettings.downloadDirectory; }
  return result;
}

function applyPortableSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid portable settings');
  const changes = new Map();
  for (const key of PORTABLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    let value = settings[key];
    if (key === 'visualStyle') value = normalizeWorkspaceVisualStyle(value);
    if (key === 'browserSettings') value = { ...value, downloadDirectory: store.get(key, {})?.downloadDirectory || '' };
    if (key === 'favorites') {
      const folders = readFavorites().filter((item) => item.kind === 'files');
      const websites = value?.items?.filter((item) => item.kind === 'browser') || [];
      if (folders.length + websites.length > PLACE_LIMIT) throw new Error(portableText('本机文件夹收藏与便携网页收藏合计超过 100 项，请先整理收藏后重启；配置未覆盖。', 'Local folder favorites plus portable bookmarks exceed 100; organize favorites and restart. Settings were not replaced.'));
      const ids = new Set(websites.map((item) => item.id));
      value = { version: 1, items: [...websites, ...folders.map((item) => ({ ...item, id: ids.has(item.id) ? crypto.randomUUID() : item.id }))] };
    }
    changes.set('df.' + key, JSON.stringify(value));
  }
  const before = new Map([...changes.keys()].map((key) => [key, localStorage.getItem(key)]));
  try { for (const [key, value] of changes) localStorage.setItem(key, value); }
  catch (error) {
    for (const [key, value] of before) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {} }
    throw error;
  }
}

function hydratePortablePreferences() {
  // These globals were initialized while scripts loaded, before disk IPC completed.
  applyWorkspaceVisualStyle(store.get('visualStyle', 'studio'), false);
  locale = store.get('locale', locale); dfmt = null;
  for (const key of ['sortKey', 'sortDir', 'showHidden', 'viewMode']) state[key] = store.get(key, state[key]);
  previewOpen = store.get('previewOpen', false);
  columnLayout = normalizeColumns(store.get('columns.v1', null));
}

async function initPortableSettings() {
  try {
    portableStatus = await invoke('portable_settings_load');
    if (portableStatus?.error) throw new Error(portableStatus.error);
    if (portableStatus?.enabled) { applyPortableSettings(portableStatus.settings || {}); hydratePortablePreferences(); }
  } catch (error) {
    portablePaused = true;
    portableStatus = { ...portableStatus, error: String(error) };
  }
  portableLoaded = true;
  portableLastSnapshot = JSON.stringify(portableSnapshot());
  if (portableStatus?.error) toast(portableText('便携配置未加载，继续使用本机设置：', 'Portable settings were not loaded; using local settings: ') + portableStatus.error, true);
}

function portableSettingsChanged(key) {
  if (!portableLoaded || !portableStatus?.enabled || portablePaused || portableTransition || !PORTABLE_KEYS.includes(key)) return;
  portablePending = portableSnapshot();
  void writePortableQueue();
}
function writePortableQueue() {
  if (portableWriter) return portableWriter;
  portableWriter = (async () => {
    while (portablePending) {
      const snapshot = portablePending; portablePending = null;
      const serialized = JSON.stringify(snapshot);
      if (serialized === portableLastSnapshot) continue;
      renderPortableStatus(portableText('正在保存…', 'Saving…'));
      try {
        portableStatus = await invoke('portable_settings_save', { enabled: true, settings: snapshot });
        if (!portableStatus) throw new Error('Portable storage unavailable');
        portableLastSnapshot = serialized;
      } catch (error) {
        portablePaused = true; portablePending = null;
        portableStatus = { ...portableStatus, error: String(error) };
        toast(portableText('便携配置保存失败，本机设置仍保留：', 'Portable save failed; local settings are retained: ') + String(error), true);
      }
    }
  })().finally(() => { portableWriter = null; renderPortableStatus(); if (portablePending && !portablePaused) void writePortableQueue(); });
  return portableWriter;
}

async function setPortableEnabled(enabled) {
  portableTransition = true;
  try {
    if (portableWriter) await portableWriter;
    const snapshot = portableSnapshot();
    const result = await invoke('portable_settings_save', { enabled, settings: snapshot });
    if (!result) throw new Error('Portable storage unavailable');
    portableStatus = result; portablePaused = false;
    portableLastSnapshot = JSON.stringify(snapshot);
  } catch (error) {
    portablePaused = true;
    portableStatus = { ...portableStatus, error: String(error) };
    throw error;
  } finally {
    portableTransition = false;
    // Catch changes made by background pages while the explicit save was pending.
    portableSettingsChanged('urlHistory');
    renderPortableStatus();
  }
}

function renderPortableStatus(message) {
  const output = $('portableStatus'); if (!output) return;
  const status = portableStatus;
  output.textContent = message || (status?.error ? portableText('未同步：', 'Not synced: ') + status.error : status?.enabled ? portableText('便携配置已开启 · 最近保存 ', 'Portable settings enabled · Saved ') + new Date(status.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') : portableText('尚未开启，当前只使用本机设置。', 'Disabled; using local settings only.'));
  output.classList.toggle('is-error', !!status?.error);
  const button = $('portableToggle'); if (button) button.textContent = status?.enabled ? portableText('关闭便携配置', 'Disable portable settings') : portableText('开启并保存当前配置', 'Enable and save current settings');
  const save = $('portableSave'); if (save) save.disabled = !status?.enabled || portableTransition;
}

function openPortableSettings() {
  let dialog = $('portableSettingsDialog');
  if (dialog?.open) { dialog.focus(); return; }
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'portableSettingsDialog'; dialog.className = 'file-settings-dialog workspace-settings'; document.body.appendChild(dialog); }
  const T = portableText;
  dialog.setAttribute('aria-labelledby', 'portableSettingsTitle');
  dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">DALIZI / PORTABLE</span><h2 id="portableSettingsTitle">${T('配置与迁移', 'Settings & migration')}</h2></div><button type="button" data-portable-close aria-label="${T('关闭', 'Close')}">×</button></header><div class="file-settings-body"><section class="workspace-settings-section"><h3>${T('把常用设置带到下一台电脑', 'Take your preferences to another computer')}</h3><p>${T('开启后会自动保存。退出软件后，将整个软件文件夹（包括 DaliziData）复制到新电脑，再运行 EXE 即可自动读取。', 'Enable automatic saving, then exit the app and copy the entire application folder, including DaliziData, to another PC. Launch the EXE to load your settings automatically.')}</p><p class="portable-path">${esc(portableStatus?.path || T('配置位置暂不可用', 'Configuration location unavailable'))}</p><button type="button" id="portableToggle" class="file-settings-primary"></button></section><section class="workspace-settings-section"><h3>${T('随软件保存', 'Saved with the application')}</h3><p>${T('界面风格、明暗主题、语言、列表列与排序、预览偏好、浏览器设置、网页收藏、网页访问历史（最多 200 条）。', 'Interface style, light/dark theme, language, columns and sorting, preview preference, browser settings, website bookmarks and URL history (up to 200 entries).')}</p><h3>${T('由每台电脑各自管理', 'Managed separately on each computer')}</h3><p>${T('快速访问、文件夹收藏与历史、上次打开的标签、下载目录、SSH 连接、密码、Cookie、网站登录和扩展仍保留在本机。', 'Quick access, folder favorites/history, previous tabs, download paths, SSH connections, passwords, cookies, website sign-ins and extensions stay local.')}</p><p>${T('此 JSON 文件可直接阅读，包含网址历史。关闭便携配置会停止自动保存和下次自动读取，但保留已有文件；需要彻底移除时请同时移除配置和备份。', 'The JSON file is readable and includes visited URLs. Disabling stops automatic saving and loading but retains existing files. To remove this data completely, remove both the settings file and its backup.')}</p></section><p id="portableStatus" class="portable-status" role="status"></p></div><footer class="file-settings-footer"><button type="button" id="portableReveal">${T('定位配置文件', 'Show settings file')}</button><button type="button" id="portableSave">${T('立即保存', 'Save now')}</button><span class="file-settings-spacer"></span><button type="button" data-portable-close>${T('完成', 'Done')}</button></footer>`;
  dialog.querySelectorAll('[data-portable-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  const action = async (enabled) => {
    dialog.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    renderPortableStatus(T('正在保存…', 'Saving…'));
    try { await setPortableEnabled(enabled); }
    catch (error) { portableStatus = { ...portableStatus, error: String(error) }; }
    finally { dialog.querySelectorAll('button').forEach((b) => { b.disabled = false; }); renderPortableStatus(); }
  };
  $('portableToggle').addEventListener('click', () => void action(!portableStatus?.enabled));
  $('portableSave').addEventListener('click', () => void action(true));
  $('portableReveal').addEventListener('click', async () => {
    try { if (!portableStatus?.updatedAt) throw new Error(T('请先开启并保存配置文件。', 'Enable and save settings first.')); await invoke('reveal', { path: portableStatus.path }); }
    catch (error) { $('portableStatus').textContent = String(error); }
  });
  renderPortableStatus(); dialog.showModal();
}

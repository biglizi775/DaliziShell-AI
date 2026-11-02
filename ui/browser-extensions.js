/* Runtime-backed extension controls. The shared browser profile owns all state. */
const extensionText = (zh, en) => locale === 'zh' ? zh : en;
let extensionView = null;

function extensionMarkup(items) {
  return items.map((item) => `<article class="extension-card" data-extension-id="${esc(item.id)}"><span class="extension-symbol" aria-hidden="true">✦</span><div class="extension-info"><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small><span>${extensionText(item.enabled ? '已启用' : '已停用', item.enabled ? 'Enabled' : 'Disabled')}</span></div><label class="extension-switch"><input type="checkbox" role="switch" data-extension-toggle="${esc(item.id)}" aria-label="${esc(extensionText('启用 ', 'Enable ') + item.name)}" ${item.enabled ? 'checked' : ''}><span></span></label><button type="button" data-extension-remove="${esc(item.id)}">${extensionText('移除', 'Remove')}</button></article>`).join('');
}

async function refreshBrowserExtensions(view = extensionView) {
  if (!view || extensionView !== view) return;
  const generation = ++view.generation;
  view.status.textContent = extensionText('正在读取浏览器扩展…', 'Reading browser extensions…');
  view.list.setAttribute('aria-busy', 'true');
  try {
    const items = await invoke('browser_extensions_list', { key: view.key });
    if (extensionView !== view || generation !== view.generation || !view.dialog.open) return;
    if (!Array.isArray(items)) throw new Error(extensionText('无法读取扩展列表', 'Extension list unavailable'));
    view.items = items;
    view.list.innerHTML = items.length ? extensionMarkup(items) : `<div class="extension-empty">${extensionText('还没有安装扩展。从下面加载解压后的扩展开始。', 'No extensions installed. Load an unpacked extension below.')}</div>`;
    view.status.textContent = extensionText(`${items.length} 个扩展 · ${items.filter((item) => item.enabled).length} 个已启用`, `${items.length} extensions · ${items.filter((item) => item.enabled).length} enabled`);
  } catch (error) {
    if (extensionView === view && generation === view.generation) { view.list.replaceChildren(); view.status.textContent = String(error); }
  } finally { if (extensionView === view) view.list.setAttribute('aria-busy', 'false'); }
}

async function changeBrowserExtension(view, id, enabled, remove = false) {
  if (view !== extensionView || view.busy) return;
  view.busy = true;
  view.dialog.querySelectorAll('input, button[data-extension-remove], button[data-extension-refresh], button[data-extension-install]').forEach((node) => { node.disabled = true; });
  try {
    await invoke(remove ? 'browser_extension_remove' : 'browser_extension_set_enabled', remove ? { key: view.key, id } : { key: view.key, id, enabled });
    await refreshBrowserExtensions(view);
  } catch (error) {
    // Restore runtime state after failure instead of showing an optimistic switch.
    await refreshBrowserExtensions(view);
    if (extensionView === view) view.status.textContent = String(error);
  } finally {
    view.busy = false;
    view.dialog.querySelectorAll('input, button').forEach((node) => { node.disabled = false; });
  }
}

function openBrowserExtensions(tb = curTab()) {
  if (!isBrowserTab(tb) || !tb.browserReady) { toast(extensionText('先打开一个浏览器标签页', 'Open a browser tab first'), true); return; }
  if (extensionView?.dialog.open) { extensionView.dialog.focus(); return; }
  const dialog = document.createElement('dialog');
  dialog.id = 'browserExtensionDialog'; dialog.className = 'browser-extension-dialog';
  dialog.setAttribute('aria-labelledby', 'extensionHeading');
  dialog.innerHTML = `<header><div><span class="browser-history-eyebrow">DALIZI / EXTENSIONS</span><h2 id="extensionHeading">${extensionText('扩展管理', 'Extensions')}</h2></div><button type="button" data-extension-close aria-label="${extensionText('关闭', 'Close')}">×</button></header><p>${extensionText('开关作用于共享浏览器配置中的所有网页标签，并在下次启动时保留。', 'Switches apply to all tabs in the shared browser profile and persist across restarts.')}</p><div class="extension-status-row"><span role="status" data-extension-status></span><button type="button" data-extension-refresh>${extensionText('刷新', 'Refresh')}</button></div><section class="extension-list" data-extension-list></section><section class="extension-loader"><h3>${extensionText('加载本地扩展', 'Load a local extension')}</h3><label for="extensionPath">${extensionText('包含 manifest.json 的扩展文件夹', 'Extension folder containing manifest.json')}</label><div><input id="extensionPath" type="text" spellcheck="false" placeholder="D:\\Extensions\\my-extension"><button type="button" data-extension-install>${extensionText('加载', 'Load')}</button></div><small>${extensionText('WebView2 支持的扩展 API 与 Chrome 有差异；商店安装、扩展弹出页和徽标尚未提供。', 'WebView2 extension APIs differ from Chrome. Store installation, extension popups and badges are not provided yet.')}</small></section><footer><button type="button" data-extension-close>${extensionText('完成', 'Done')}</button></footer>`;
  document.body.appendChild(dialog);
  const view = { dialog, key: tb.key, list: dialog.querySelector('[data-extension-list]'), status: dialog.querySelector('[data-extension-status]'), items: [], generation: 0, busy: false };
  extensionView = view;
  dialog.addEventListener('close', () => { if (extensionView === view) extensionView = null; dialog.remove(); });
  dialog.addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-extension-toggle]');
    if (toggle) changeBrowserExtension(view, toggle.dataset.extensionToggle, toggle.checked);
  });
  dialog.addEventListener('click', async (event) => {
    if (event.target.closest('[data-extension-close]')) dialog.close();
    if (event.target.closest('[data-extension-refresh]') && !view.busy) refreshBrowserExtensions(view);
    const remove = event.target.closest('[data-extension-remove]');
    if (remove && !view.busy) {
      if (remove.dataset.confirm !== 'yes') { remove.dataset.confirm = 'yes'; remove.textContent = extensionText('确认移除', 'Confirm removal'); return; }
      changeBrowserExtension(view, remove.dataset.extensionRemove, false, true);
    }
    if (event.target.closest('[data-extension-install]') && !view.busy) {
      const path = dialog.querySelector('#extensionPath').value.trim();
      if (!path) { dialog.querySelector('#extensionPath').focus(); return; }
      view.busy = true;
      const button = dialog.querySelector('[data-extension-install]'); button.disabled = true;
      try { await invoke('browser_extension_install', { key: view.key, path }); await refreshBrowserExtensions(view); }
      catch (error) { view.status.textContent = String(error); }
      finally { view.busy = false; button.disabled = false; }
    }
  });
  dialog.showModal(); refreshBrowserExtensions(view);
}

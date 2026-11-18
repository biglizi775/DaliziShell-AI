'use strict';
const dropText = (zh, en) => locale === 'zh' ? zh : en;
let externalDropTarget = null, externalDropInitialized = false;
function clearExternalDrop() {
  document.querySelectorAll('.external-drop-target').forEach((node) => node.classList.remove('external-drop-target'));
  $('externalDropHint')?.remove(); externalDropTarget = null;
}
function externalDropDestination(position) {
  if (isTermTab(curTab()) || isBrowserTab(curTab()) || !state.path || state.loading || state.error || localTaskBusy() || document.querySelector('dialog[open]')) return null;
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  const scale = window.devicePixelRatio || 1;
  const node = document.elementFromPoint(position.x / scale, position.y / scale);
  if (node?.closest('#companionPane') && typeof companionFor === 'function') {
    const p = companionFor(); if (!p?.open || p.loading || p.error) return null;
    const row = node.closest('.pane-file'), entry = p.entries.find(e => e.name === row?.dataset.name);
    return { path: entry?.isDir ? join(p.path, entry.name) : p.path, node: row || $('companionPane'), owner: curTab(), folder: state.path };
  }
  if (!node?.closest('#content')) return null;
  const row = node.closest('[data-i]'), item = row && state.view[Number(row.dataset.i)];
  return { path: item?.isDir ? join(state.path, item.name) : state.path, node: item?.isDir ? row : els.content, owner: curTab(), folder: state.path };
}
function handleExternalDrag(event) {
  if (event.type === 'leave') { clearExternalDrop(); return; }
  const target = externalDropDestination(event.position);
  if (!target) { clearExternalDrop(); return; }
  if (event.type === 'drop') {
    clearExternalDrop();
    const paths = Array.isArray(event.paths) ? [...new Set(event.paths.filter((p) => typeof p === 'string' && p))] : [];
    if (paths.length) openExternalDrop(paths, target);
    return;
  }
  if (externalDropTarget?.path === target.path && externalDropTarget.node === target.node) return;
  clearExternalDrop();
  externalDropTarget = target; target.node.classList.add('external-drop-target');
  const hint = document.createElement('div'); hint.id = 'externalDropHint'; hint.setAttribute('role', 'status');
  hint.textContent = dropText('松开后选择移动或复制到：', 'Release to move or copy into: ') + target.path;
  els.content.appendChild(hint);
}
function initExternalDrop() {
  if (externalDropInitialized) return; externalDropInitialized = true;
  const webview = window.__TAURI__?.webview?.getCurrentWebview?.();
  const ready = webview?.onDragDropEvent ? webview.onDragDropEvent((event) => handleExternalDrag(event.payload))
    : Promise.all(['enter', 'over', 'drop', 'leave'].map((type) => listen('tauri://drag-' + type, (event) => handleExternalDrag({ ...event.payload, type }), { target: { kind: 'Webview', label: 'main' } })));
  ready.catch((error) => toast(dropText('无法接收外部拖入：', 'External drop unavailable: ') + String(error), true));
  // Prevent the native webview from navigating to a dropped file on fallback paths.
  for (const type of ['dragover', 'drop']) document.addEventListener(type, (event) => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault(); });
}
function openExternalDrop(paths, target, options = {}) {
  if ($('externalDropDialog')?.open || localTaskBusy()) return;
  const T = dropText, dialog = document.createElement('dialog'); dialog.id = 'externalDropDialog'; dialog.className = 'file-settings-dialog'; dialog.setAttribute('aria-labelledby', 'externalDropTitle');
  dialog.innerHTML = `<header class="file-settings-head"><h2 id="externalDropTitle">${T('拖入文件', 'Dropped files')} · ${paths.length}</h2><button type="button" data-drop-close aria-label="${T('取消', 'Cancel')}">×</button></header><div class="file-settings-body"><p>${T('目标文件夹', 'Destination folder')}</p><p class="drop-destination">${esc(target.path)}</p><ul class="drop-files">${paths.slice(0, 12).map((path) => `<li title="${esc(path)}">${esc(path)}</li>`).join('')}${paths.length > 12 ? `<li>… +${paths.length - 12}</li>` : ''}</ul><p>${T('移动会将原文件移到目标位置；复制会保留原文件。同名项目由系统自动重命名，避免覆盖。', 'Move relocates the original files; copy keeps them. Windows renames colliding items to avoid overwriting.')}</p><p id="externalDropStatus" role="status"></p></div><footer class="file-settings-footer"><button type="button" data-drop-close>${T('取消', 'Cancel')}</button><span class="file-settings-spacer"></span><button type="button" data-drop-kind="copy">${T('复制到此处', 'Copy here')}</button><button type="button" data-drop-kind="move" class="file-settings-primary">${T('移动到此处', 'Move here')}</button></footer>`;
  document.body.appendChild(dialog); let running = false;
  if (options.kind) {
    $('externalDropTitle').textContent = T('重试未执行项', 'Retry unexecuted items') + ' · ' + paths.length;
    dialog.querySelectorAll('[data-drop-kind]').forEach(b => { b.hidden = b.dataset.dropKind !== options.kind; });
  }
  if (options.retryItems) {
    const list = dialog.querySelector('.drop-files');
    list.innerHTML = paths.map((path, i) => `<li><label><input type="checkbox" data-retry-index="${i}" checked> ${esc(path)}</label></li>`).join('');
    list.onchange = () => {
      dialog.querySelector('[data-drop-kind="' + options.kind + '"]').disabled = !list.querySelector(':checked');
    };
  }
  dialog.querySelectorAll('[data-drop-close]').forEach((button) => button.addEventListener('click', () => { if (!running) dialog.close(); }));
  dialog.addEventListener('cancel', (event) => { if (running) event.preventDefault(); });
  dialog.querySelectorAll('[data-drop-kind]').forEach((button) => button.addEventListener('click', async () => {
    if (running || localTaskBusy() || button.hidden) return; running = true;
    dialog.querySelectorAll('button, input').forEach((b) => { b.disabled = true; });
    $('externalDropStatus').textContent = T('正在检查源文件和目标目录…', 'Checking sources and destination…');
    try {
      const selected = options.retryItems && [...dialog.querySelectorAll('[data-retry-index]:checked')].map(box => options.retryItems[Number(box.dataset.retryIndex)]);
      const batch = await queueLocalTransfer(button.dataset.dropKind, selected ? selected.map(i => i.source) : paths, target, { ...options, retryItems: selected });
      dialog.close();
      if (options.retryItems) openLocalTaskCenter(batch.id);
    } catch (error) { $('externalDropStatus').textContent = String(error); }
    finally {
      running = false; dialog.querySelectorAll('button, input').forEach((b) => { b.disabled = false; });
    }
  }));
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}

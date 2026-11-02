'use strict';
const dropText = (zh, en) => locale === 'zh' ? zh : en;
let externalDropTarget = null, externalDropInitialized = false;
function clearExternalDrop() {
  document.querySelectorAll('.external-drop-target').forEach((node) => node.classList.remove('external-drop-target'));
  $('externalDropHint')?.remove(); externalDropTarget = null;
}
function externalDropDestination(position) {
  if (isTermTab(curTab()) || isBrowserTab(curTab()) || !state.path || state.loading || state.error || fileOpBusy || document.querySelector('dialog[open]')) return null;
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
function openExternalDrop(paths, target) {
  if ($('externalDropDialog')?.open || fileOpBusy) return;
  const T = dropText, dialog = document.createElement('dialog'); dialog.id = 'externalDropDialog'; dialog.className = 'file-settings-dialog'; dialog.setAttribute('aria-labelledby', 'externalDropTitle');
  dialog.innerHTML = `<header class="file-settings-head"><h2 id="externalDropTitle">${T('拖入文件', 'Dropped files')} · ${paths.length}</h2><button type="button" data-drop-close aria-label="${T('取消', 'Cancel')}">×</button></header><div class="file-settings-body"><p>${T('目标文件夹', 'Destination folder')}</p><p class="drop-destination">${esc(target.path)}</p><ul class="drop-files">${paths.slice(0, 12).map((path) => `<li title="${esc(path)}">${esc(path)}</li>`).join('')}${paths.length > 12 ? `<li>… +${paths.length - 12}</li>` : ''}</ul><p>${T('移动会将原文件移到目标位置；复制会保留原文件。同名项目由系统自动重命名，避免覆盖。', 'Move relocates the original files; copy keeps them. Windows renames colliding items to avoid overwriting.')}</p><p id="externalDropStatus" role="status"></p></div><footer class="file-settings-footer"><button type="button" data-drop-close>${T('取消', 'Cancel')}</button><span class="file-settings-spacer"></span><button type="button" data-drop-kind="copy">${T('复制到此处', 'Copy here')}</button><button type="button" data-drop-kind="move" class="file-settings-primary">${T('移动到此处', 'Move here')}</button></footer>`;
  document.body.appendChild(dialog); let running = false;
  dialog.querySelectorAll('[data-drop-close]').forEach((button) => button.addEventListener('click', () => { if (!running) dialog.close(); }));
  dialog.addEventListener('cancel', (event) => { if (running) event.preventDefault(); });
  dialog.querySelectorAll('[data-drop-kind]').forEach((button) => button.addEventListener('click', async () => {
    if (running || fileOpBusy) return; running = true; fileOpBusy = true;
    dialog.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    $('externalDropStatus').textContent = T('正在处理…需要取消时可使用系统文件操作进度窗口。', 'Working… Use the Windows file-operation progress window to cancel.');
    try {
      const result = await invoke('external_drop_transfer', { kind: button.dataset.dropKind, sources: paths, dest: target.path });
      if (!result?.completed) { $('externalDropStatus').textContent = T('操作已取消或部分完成，请检查目标文件夹。', 'Cancelled or partially completed. Check the destination folder.'); }
      else { dialog.close(); toast(result.processed ? T('文件已处理：', 'Transferred: ') + result.processed + (result.skipped ? T(' · 已跳过重复或原地项目 ', ' · Skipped duplicate or same-folder items: ') + result.skipped : '') : T('所有项目已在目标目录，未重复移动。', 'Items are already in the destination; nothing moved.')); }
    } catch (error) { $('externalDropStatus').textContent = String(error); }
    finally {
      running = false; fileOpBusy = false; dialog.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      if (typeof companionFor === 'function' && companionFor(target.owner)?.open) void loadCompanion(companionFor(target.owner).path, false, true, target.owner);
      if (curTab() === target.owner && state.path === target.folder) await refresh(true, true);
      renderBar2();
    }
  }));
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}

'use strict';

const localFileBatches = [];
let localQueueRunning = false;
let localPlanning = 0;
let localHistoryReady = null;
let localHistoryError = '';
let localHistoryLoaded = false;
let localTaskFrame = null;
const localTaskText = (zh, en) => locale === 'zh' ? zh : en;
const localTaskBusy = () => fileOpBusy && !localQueueRunning;
const localRetryable = item => !item.retried && (item.status === 'failed' || item.status === 'stopped');
const localSettled = b => b.finished && b.items.every(i => i.retried || i.status === 'complete' || i.status === 'skipped');
function localPendingCount() {
  return localFileBatches.reduce((n, batch) => n + batch.items.filter(i => i.status === 'queued' || i.status === 'running').length, 0);
}
function localPaint() {
  if (localTaskFrame !== null) return;
  localTaskFrame = requestAnimationFrame(() => {
    localTaskFrame = null;
    syncSshTaskButton();
    renderLocalTaskCenter();
  });
}
function ensureLocalHistory() {
  if (!localHistoryReady) localHistoryReady = readLocalHistory().then(async batches => {
    const expired = batches.filter(localSettled).slice(0, -40);
    const discard = new Set(expired.map(b => b.id));
    if (expired.length) {
      try { await forgetLocalRecords([...discard]); }
      catch (error) { discard.clear(); toast(String(error), true); }
    }
    localHistoryError = '';
    for (const b of batches) {
      if (discard.has(b.id)) continue;
      for (const i of b.items) if (localRetryable(i) && (!b.destinationKey || !i.sourceKey)) i.status = 'reselect';
      localFileBatches.push(b);
    }
    localHistoryLoaded = true;
    localPaint();
  }).catch(error => {
    localHistoryReady = null; localHistoryError = String(error); localPaint(); throw error;
  });
  return localHistoryReady;
}
async function queueLocalTransfer(kind, sources, target, options = {}) {
  if (desktopExitPending) throw new Error(localTaskText('工作区正在退出。', 'The workspace is closing.'));
  if (localTaskBusy()) throw new Error(localTaskText('请等待当前文件操作结束。', 'Wait for the current file operation.'));
  const paths = [...sources], dest = target.path;
  localPlanning++;
  try {
    await ensureLocalHistory();
    return await prepareLocalBatch(kind, paths, dest, target.owner, options);
  } finally { localPlanning--; }
}
async function prepareLocalBatch(kind, paths, dest, owner, options) {
  const inspection = await invoke('local_transfer_inspect', { kind, sources: paths, dest });
  const indexes = inspection?.ready;
  if (!Array.isArray(indexes) || !Array.isArray(inspection.sourceKeys) || inspection.sourceKeys.length !== paths.length || indexes.some(i => !Number.isInteger(i) || i < 0 || i >= paths.length)) {
    throw new Error(localTaskText('无法核对源文件列表。', 'Could not validate the source list.'));
  }
  if (localTaskBusy()) throw new Error(localTaskText('请等待当前文件操作结束。', 'Wait for the current file operation.'));
  if (options.retryItems) {
    for (const [i, old] of options.retryItems.entries()) {
      const previous = localFileBatches.find(b => b.id === old.batchId);
      if (!previous?.finished || !localRetryable(old) || old.source !== paths[i] || previous.kind !== kind || previous.dest !== dest ||
          previous.destinationKey !== inspection.destinationKey || old.sourceKey !== inspection.sourceKeys[i]) {
        throw new Error(localTaskText('源或目标与原记录不一致。请取消勾选此项，或在文件夹中重新选择：', 'Source or destination no longer matches. Uncheck this item or select it again in its folder: ') + paths[i]);
      }
    }
  }
  const ready = new Set(indexes);
  const batch = {
    kind, dest, destinationKey: inspection.destinationKey, created: Date.now(), owner, finished: false, clipboard: options.clipboard,
    items: paths.map((source, index) => ({ source, index, sourceKey: inspection.sourceKeys[index], status: ready.has(index) ? 'queued' : 'skipped' })),
  };
  try { batch.id = await createLocalRecord(batch, options.retryItems); }
  catch (error) { throw new Error(localTaskText('无法保存本地批次，请检查任务记录和可用磁盘空间。', 'Could not save the batch. Check task records and available disk space.') + ' ' + String(error)); }
  for (const item of batch.items) item.batchId = batch.id;
  batch.done = new Promise(resolve => { batch.resolve = resolve; });
  localFileBatches.push(batch);
  if (options.retryItems) for (const item of options.retryItems) item.retried = batch.id;
  localPaint();
  void pumpLocalTransfers();
  return batch;
}
function updateLocalCutClipboard(batch) {
  const cb = state.clipboard;
  if (!cb || cb.mode !== 'cut' || cb !== batch.clipboard?.deref()) return;
  const consumed = new Set(batch.items.filter(i => !localRetryable(i)).map(i => i.source));
  for (const item of batch.items) if (localRetryable(item)) consumed.delete(item.source);
  const remaining = cb.paths.filter(path => !consumed.has(path));
  if (!remaining.length) state.clipboard = null;
  else if (remaining.length !== cb.paths.length) cb.paths = remaining;
}
function stopLocalBatch(batch) {
  for (const item of batch.items) if (item.status === 'queued') item.status = 'stopped';
  localPaint();
}
async function clearLocalBatches(batches) {
  const ids = batches.map(b => b.id);
  await forgetLocalRecords(ids);
  const forgotten = new Set(ids);
  for (let i = localFileBatches.length - 1; i >= 0; i--) if (forgotten.has(localFileBatches[i].id)) localFileBatches.splice(i, 1);
  localPaint();
}
async function refreshLocalTransfer(batch) {
  const owner = batch.owner;
  const canonical = path => String(path || '').replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();
  const folders = new Set([canonical(batch.dest)]);
  if (batch.kind === 'move') for (const item of batch.items) {
    if (item.status === 'complete' || item.status === 'verify') folders.add(canonical(item.source.replace(/[\\/][^\\/]+$/, '')));
  }
  const active = curTab();
  for (const tab of new Set([active, owner])) {
    if (!tab || !state.tabs.includes(tab)) continue;
    const pane = companionFor(tab);
    if (pane?.open && folders.has(canonical(pane.path))) await loadCompanion(pane.path, false, true, tab);
  }
  if (curTab() === active && fileListingReady() && folders.has(canonical(state.path))) await refresh(true, true);
  renderBar2();
}
async function pumpLocalTransfers() {
  if (localQueueRunning) return;
  localQueueRunning = true;
  fileOpBusy = true;
  try {
    for (let batch; (batch = localFileBatches.find(b => !b.finished));) {
      for (const item of batch.items) {
        if (item.status !== 'queued') continue;
        item.status = 'running';
        localPaint();
        try {
          await writeLocalItem(item, 'queued', 'running');
        } catch (error) {
          item.status = 'failed';
          item.message = localTaskText('无法登记执行。请检查可用磁盘空间，再重试未执行项。', 'Could not record dispatch. Check available disk space before retrying.') + ' ' + String(error);
          stopLocalBatch(batch); break;
        }
        try {
          const expected = { sourceKey: item.sourceKey, destinationKey: batch.destinationKey };
          const receipt = await invoke('local_transfer_item', { kind: batch.kind, source: item.source, dest: batch.dest, expected });
          item.status = ['complete', 'skipped', 'failed', 'verify'].includes(receipt?.status) ? receipt.status : 'verify';
          item.target = receipt?.target;
          item.message = receipt?.message;
        } catch (error) {
          item.status = 'verify';
          item.message = String(error);
        }
        try { await writeLocalItem(item, 'running', item.status, item); }
        catch (error) {
          item.status = 'verify';
          item.message = localTaskText('未能保存完整回执，请检查两端。', 'Could not save the final receipt. Inspect both locations.') + ' ' + String(error);
        }
        if (item.status === 'verify') stopLocalBatch(batch);
        localPaint();
      }
      updateLocalCutClipboard(batch);
      try { await refreshLocalTransfer(batch); } catch (error) { toast(String(error), true); }
      batch.finished = true;
      batch.owner = null;
      batch.resolve(batch.items);
      delete batch.resolve;
      const settled = localFileBatches.filter(localSettled);
      if (settled.length > 40) {
        try { await clearLocalBatches(settled.slice(0, -40)); } catch (error) { toast(String(error), true); }
      }
      toast(localSummary(batch), batch.items.some(i => ['verify', 'failed'].includes(i.status)));
      localPaint();
    }
  } finally {
    fileOpBusy = false;
    localQueueRunning = false;
    localPaint();
  }
}
function localStatusText(status) {
  const T = localTaskText;
  return {
    queued: T('待处理', 'Queued'), running: T('正在处理', 'Running'), complete: T('已完成', 'Completed'),
    skipped: T('重复、包含或原地移动，已跳过', 'Skipped duplicate, nested or same-folder move'),
    failed: T('未执行，检查失败', 'Failed before transfer'), stopped: T('未开始', 'Stopped before transfer'),
    verify: T('请核对源和目标', 'Inspect source and destination'),
    reselect: T('无法验证原路径身份，请重新选择', 'Identity unavailable. Select the source again'),
  }[status];
}
function localKindText(kind) {
  return kind === 'move' ? localTaskText('移动', 'Move') : localTaskText('复制', 'Copy');
}
function localSummary(batch) {
  const count = status => batch.items.filter(i => i.status === status).length;
  const parts = [localKindText(batch.kind) + ' · ' + localTaskText('已完成 ', 'Completed ') + count('complete') + '/' + batch.items.length];
  for (const status of ['skipped', 'failed', 'stopped', 'verify', 'reselect']) {
    if (count(status)) parts.push(localStatusText(status) + ' ' + count(status));
  }
  return parts.join(' · ');
}
function openLocalTaskCenter(id) {
  void ensureLocalHistory().catch(() => {});
  let dialog = $('localTaskCenter');
  const T = localTaskText;
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'localTaskCenter'; dialog.className = 'file-settings-dialog ssh-task-center';
    dialog.setAttribute('aria-labelledby', 'localTaskTitle');
    dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">${T('本机任务记录', 'ON THIS DEVICE')}</span><h2 id="localTaskTitle">${T('本地文件任务', 'Local file tasks')}</h2></div><button data-close aria-label="${T('关闭', 'Close')}">×</button></header><div class="ssh-task-layout"><nav class="local-batches" aria-label="${T('批次', 'Batches')}"></nav><section class="ssh-task-detail" aria-live="off"><p data-empty>${T('复制或移动文件后，可在这里查看每一项的结果。', 'After copying or moving files, inspect individual results here.')}</p><div data-detail hidden><h3 data-kind></h3><p class="ssh-task-path" data-dest></p><p role="status" data-summary></p><div class="ssh-task-actions"><button data-stop>${T('停止后续项目', 'Stop remaining items')}</button><button data-retry>${T('重试未执行项…', 'Retry unexecuted items…')}</button></div><p class="preview-note" data-note></p><div data-items></div></div></section></div><footer class="file-settings-footer"><button data-sftp>SFTP</button><button data-forget>${T('移除此记录', 'Remove record')}</button><button data-clear>${T('清除已结束记录', 'Clear finished records')}</button><span class="file-settings-spacer"></span><button data-close>${T('关闭面板', 'Close panel')}</button></footer>`;
    document.body.appendChild(dialog);
    const historyStatus = document.createElement('p');
    historyStatus.className = 'preview-note'; historyStatus.dataset.historyError = ''; historyStatus.setAttribute('role', 'status');
    dialog.querySelector('.ssh-task-detail').prepend(historyStatus);
    const reload = document.createElement('button');
    reload.textContent = T('重新读取记录', 'Reload records'); reload.dataset.reload = '';
    reload.onclick = () => void ensureLocalHistory().catch(() => {});
    dialog.querySelector('[data-clear]').after(reload);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dialog.close());
    dialog.querySelector('[data-sftp]').onclick = () => { dialog.close(); openSshTaskCenter(); };
    const selected = () => localFileBatches.find(b => String(b.id) === dialog.dataset.selected);
    dialog.querySelector('[data-stop]').onclick = () => { const b = selected(); if (b) stopLocalBatch(b); };
    dialog.querySelector('[data-retry]').onclick = () => {
      const b = selected(); if (!b?.finished) return;
      const items = b.items.filter(localRetryable); if (!items.length) return;
      openExternalDrop(items.map(i => i.source), { path: b.dest, owner: curTab() }, { kind: b.kind, retryItems: items, clipboard: b.clipboard });
    };
    dialog.querySelector('.local-batches').onclick = event => {
      const button = event.target.closest('[data-id]'); if (button) { delete dialog.dataset.forgetting; dialog.dataset.selected = button.dataset.id; renderLocalTaskCenter(); }
    };
    dialog.querySelector('[data-forget]').onclick = async () => {
      const b = selected(); if (!b?.finished) return;
      if (dialog.dataset.forgetting !== String(b.id)) { dialog.dataset.forgetting = String(b.id); renderLocalTaskCenter(); return; }
      try { await clearLocalBatches([b]); delete dialog.dataset.forgetting; }
      catch (error) { toast(String(error), true); }
    };
    dialog.querySelector('[data-clear]').onclick = async () => {
      try { await clearLocalBatches(localFileBatches.filter(localSettled)); }
      catch (error) { toast(String(error), true); }
    };
    dialog.showModal();
  }
  dialog.dataset.selected = String(id || localFileBatches[localFileBatches.length - 1]?.id || '');
  renderLocalTaskCenter();
}
function renderLocalTaskCenter() {
  const dialog = $('localTaskCenter'); if (!dialog?.open) return;
  const T = localTaskText, q = sel => dialog.querySelector(sel);
  q('[data-history-error]').hidden = !localHistoryError;
  q('[data-history-error]').textContent = localHistoryError && T('无法读取本机任务记录 · ', 'Could not read task records · ') + localHistoryError;
  q('[data-reload]').hidden = !localHistoryError;
  q('[data-empty]').textContent = !localHistoryLoaded && !localHistoryError ? T('正在读取本机任务记录…', 'Reading task records…') : T('复制或移动文件后，可在这里查看每一项的结果。', 'After copying or moving files, inspect individual results here.');
  const b = localFileBatches.find(batch => String(batch.id) === dialog.dataset.selected) || localFileBatches[localFileBatches.length - 1];
  dialog.dataset.selected = String(b?.id || '');
  const nav = q('.local-batches');
  const listKey = localFileBatches.map(batch => batch.id).join(',');
  if (nav.dataset.batches !== listKey) {
    nav.dataset.batches = listKey;
    nav.innerHTML = localFileBatches.slice().reverse().map(batch => `<button data-id="${batch.id}" title="${esc(batch.dest)}"><strong>#${batch.id} · ${localKindText(batch.kind)} · ${batch.items.length}</strong><small dir="auto">${esc(batch.dest)}</small></button>`).join('');
  }
  for (const button of nav.children) button.setAttribute('aria-pressed', String(button.dataset.id === dialog.dataset.selected));
  q('[data-detail]').hidden = !b; q('[data-empty]').hidden = !!b || !!localHistoryError; q('[data-clear]').disabled = !localFileBatches.some(localSettled);
  q('[data-forget]').disabled = !b?.finished;
  q('[data-forget]').textContent = b && dialog.dataset.forgetting === String(b.id) ? T('确认移除记录', 'Confirm removal') : T('移除此记录', 'Remove record');
  if (!b) return;
  const when = b.created ? new Date(b.created).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en') : '';
  q('[data-kind]').textContent = '#' + b.id + ' · ' + localKindText(b.kind) + (b.restored ? T(' · 历史记录', ' · Saved record') : '') + (when ? ' · ' + when : '');
  q('[data-dest]').textContent = T('目标文件夹 · ', 'Destination · ') + b.dest;
  q('[data-summary]').textContent = localSummary(b);
  q('[data-stop]').disabled = !b.items.some(i => i.status === 'queued');
  q('[data-retry]').disabled = !b.finished || !b.items.some(localRetryable);
  q('[data-note]').textContent = b.items.some(i => i.status === 'verify') ? T('Windows 未确认完整结果。请检查源文件和目标文件夹。', 'Windows did not confirm the full result. Inspect the source and destination.') :
    b.restored && b.items.some(localRetryable) ? T('恢复项使用记录中的源和目标。勾选后再次确认即可继续。', 'Review the recorded sources and destination and confirm the items to resume.') :
    b.finished ? '' : T('当前项目可在 Windows 进度窗口中取消。停止后续项目会保留已完成的文件。', 'Cancel the current item in the Windows progress window. Stopping remaining items keeps completed files.');
  q('[data-items]').innerHTML = b.items.map(i => {
    const name = i.source.split(/[\\/]/).filter(Boolean).pop() || i.source;
    const actual = i.target ? `<small class="local-result-path">${T('实际目标', 'Saved to')} · ${esc(i.target)}</small>` : '';
    return `<div class="ssh-task-item" data-status="${i.status}"><strong>${esc(name)}</strong><span>${esc(localStatusText(i.status))}${i.retried ? ' → #' + i.retried : ''}</span><small class="local-result-path">${T('源', 'Source')} · ${esc(i.source)}</small>${actual}${i.message ? '<p>' + esc(i.message) + '</p>' : ''}</div>`;
  }).join('');
}

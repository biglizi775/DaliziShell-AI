'use strict';
// Session-only task records: no passwords, reconnects or automatic replay.
const sshTaskBatches = [];
let sshTaskDialog = null, sshTaskReview = null, sshTaskPicker = null, sshQueueTimer = null, sshTaskFrame = null;
const sshTaskText = (zh, en) => locale === 'zh' ? zh : en;
const sshItemActive = (item) => ['starting', 'running', 'finalizing'].includes(item.status);
const sshItemDone = (item) => ['complete', 'failed', 'cancelled', 'interrupted'].includes(item.status) && !item.launchPending;
const sshBatchDone = (batch) => batch.items.every(sshItemDone);
function sshQueueConnected(batch) {
  const tb = batch.owner;
  return !tb.disposed && !tb.exited && !tb.sshDisconnectRequested && tb.sshAuthenticated && tb.key === batch.key && tb.termId === batch.sessionId;
}
function sshQueueIdentity(tb) { const c = tb.sshConfig || {}; return JSON.stringify([String(c.host || '').toLowerCase(), c.port || 22, c.user || '', c.identityFile || '']); }
function sshQueueLabel(tb) { const c = tb.sshConfig || {}; return `${c.user || ''}@${c.host || ''}:${c.port || 22}`; }
function sshTaskStatus(status) {
  const labels = { queued: ['等待', 'Queued'], starting: ['启动中', 'Starting'], running: ['传输中', 'Transferring'], finalizing: ['完成保存中', 'Finalizing'], complete: ['完成', 'Complete'], failed: ['失败', 'Failed'], cancelled: ['已取消', 'Cancelled'], interrupted: ['结果待核对', 'Verify result'] };
  return labels[status] ? sshTaskText(...labels[status]) : status;
}
function sshBatchStats(batch) {
  const result = { complete: 0, failed: 0, cancelled: 0, interrupted: 0, queued: 0, bytes: 0, total: 0, known: true };
  for (const item of batch.items) {
    if (item.status in result) result[item.status]++;
    result.bytes += item.bytes || 0;
    if (item.total == null) result.known = false; else result.total += item.total;
  }
  return result;
}
function sshBatchCaption(batch) {
  const T = sshTaskText, s = sshBatchStats(batch);
  if (sshBatchDone(batch)) return `${T('已结束', 'Finished')} · ${s.complete}/${batch.items.length} ${T('成功', 'completed')}${s.failed ? ` · ${s.failed} ${T('失败', 'failed')}` : ''}${s.cancelled ? ` · ${s.cancelled} ${T('取消', 'cancelled')}` : ''}${s.interrupted ? ` · ${s.interrupted} ${T('待核对', 'to verify')}` : ''}`;
  return `${batch.cancelRequested ? T('正在取消', 'Cancelling') : batch.paused ? T('已暂停后续文件', 'Pending files paused') : batch.items.some(sshItemActive) ? T('传输中', 'Transferring') : T('排队等待', 'Queued')} · ${s.complete}/${batch.items.length}`;
}
function createSshBatch(tb, prepared, direction, destination, stopOnError = false, resumable = true) {
  if (!tb.sshAuthenticated || tb.exited || tb.disposed || tb.sshDisconnectRequested) throw new Error(sshTaskText('连接已变化，请重新连接后再开始。', 'The connection changed. Reconnect before starting.'));
  if (!Array.isArray(prepared) || !prepared.length || prepared.length > 2000) throw new Error(sshTaskText('每批最多 2000 个项目。', 'Maximum 2000 entries per batch.'));
  if (sshTaskBatches.length >= 50) throw new Error(sshTaskText('最多保留 50 批记录，请先清除已结束记录。', 'Maximum 50 batches. Clear finished records first.'));
  const batch = { id: crypto.randomUUID(), owner: tb, key: tb.key, sessionId: tb.termId, identity: sshQueueIdentity(tb), host: sshQueueLabel(tb), direction, destination, stopOnError, resumable, paused: false, cancelRequested: false, createdAt: Date.now(), retried: false,
    items: prepared.map((file) => ({ name: file.name, entryKind: file.entryKind || 'file', resumeId: file.resumeId || null, localPath: file.localPath, remote: file.remote, status: 'queued', bytes: 0, total: Number.isFinite(file.size) && file.size >= 0 ? file.size : null, error: '', transferId: null, launchPending: false })),
  };
  sshTaskBatches.push(batch); scheduleSshTaskPaint(); ensureSshQueuePoll(); void pumpSshQueue(tb);
  return batch;
}
async function pumpSshQueue(tb) {
  if (tb.sshQueuePumping) return;
  const batches = sshTaskBatches.filter((b) => b.owner === tb && b.key === tb.key && b.sessionId === tb.termId);
  if (batches.some((b) => b.items.some((item) => sshItemActive(item) || item.launchPending))) return;
  const batch = batches.find((b) => !sshBatchDone(b));
  if (!batch || !sshQueueConnected(batch) || batch.paused || batch.cancelRequested) return;
  const item = batch.items.find((i) => i.status === 'queued'); if (!item) return;
  tb.sshQueuePumping = true; item.status = 'starting'; item.transferId = crypto.randomUUID(); item.launchPending = true; item.startedAt = Date.now();
  scheduleSshTaskPaint();
  try {
    const token = await invoke('ssh_file_transfer', { id: batch.sessionId, direction: batch.direction, localPath: item.localPath, remote: item.remote, requestId: item.transferId, entryKind: item.entryKind, resumable: batch.resumable, resumeId: item.resumeId });
    if (token !== item.transferId) throw new Error(sshTaskText('传输标识未确认，请核对结果。', 'Transfer identity could not be confirmed. Verify the result.'));
    if (item.status === 'starting') item.status = 'running';
  } catch (error) {
    if (!sshItemDone({ ...item, launchPending: false })) {
      try {
        const progress = await invoke('ssh_transfer_status', { id: batch.sessionId, transferId: item.transferId });
        if (progress) receiveSshQueuedTransfer(progress);
        else { item.status = 'interrupted'; item.resolveUntil = Date.now() + 15000; item.error = String(error) + ' · ' + sshTaskText('未取得启动确认，请核对目标后重试。', 'No start acknowledgement. Verify the destination before retrying.'); batch.paused = true; }
      } catch {
        item.status = 'interrupted'; item.resolveUntil = Date.now() + 15000; item.error = String(error) + ' · ' + sshTaskText('无法确认启动结果，请核对目标后重试。', 'Start result unknown. Check the destination before retrying.'); batch.paused = true;
      }
    }
  } finally {
    item.launchPending = false; tb.sshQueuePumping = false;
    if (batch.cancelRequested && sshItemActive(item)) await cancelSshQueueItem(batch, item);
    finishSshBatch(batch); scheduleSshTaskPaint(); ensureSshQueuePoll();
    if (sshItemDone(item)) void pumpSshQueue(tb);
  }
}
function receiveSshQueuedTransfer(payload) {
  if (!payload || !['running', 'finalizing', 'complete', 'failed', 'cancelled'].includes(payload.status)) return false;
  const batch = sshTaskBatches.find((b) => b.key === payload.key && b.sessionId === payload.id && b.items.some((item) => item.transferId === payload.transferId));
  if (!batch) return false;
  const item = batch.items.find((i) => i.transferId === payload.transferId);
  // A slow status poll must not roll a completed item back to running.
  if (['complete', 'failed', 'cancelled'].includes(item.status)) return true;
  if (item.status === 'interrupted' && ['running', 'finalizing'].includes(payload.status)) return true;
  if (item.status === 'finalizing' && payload.status === 'running') return true;
  item.status = payload.status;
  if (Number.isFinite(payload.bytes) && payload.bytes >= 0) item.bytes = Math.max(item.bytes, payload.bytes);
  if (Number.isFinite(payload.total) && payload.total >= 0 && (payload.total > 0 || item.total == null || payload.status === 'complete')) item.total = payload.total;
  item.error = payload.error || ''; item.queryError = ''; item.resumeId = payload.resumeId || null; item.resumedBytes = payload.resumedBytes || 0;
  if (item.status === 'failed' && batch.stopOnError) batch.paused = true;
  if (['complete', 'failed', 'cancelled'].includes(item.status)) item.resolveUntil = 0;
  if (sshItemDone(item)) { finishSshBatch(batch); void pumpSshQueue(batch.owner); }
  scheduleSshTaskPaint(); return true;
}
function finishSshBatch(batch) {
  if (!sshBatchDone(batch) || batch.notified) return;
  batch.notified = true; batch.endedAt = Date.now();
  const tb = batch.owner;
  if (sshQueueConnected(batch) && batch.direction === 'upload' && tb.sshFiles?.path === batch.destination && !tb.sshFiles.busy) void loadSshFiles(tb, batch.destination, { preserveSelection: true });
}
async function cancelSshQueueItem(batch, item) {
  if (!item.transferId || item.launchPending || !sshItemActive(item) || item.status === 'finalizing' || item.cancelling) return;
  item.cancelling = true; item.cancelError = '';
  try { await invoke('ssh_transfer_cancel', { id: batch.sessionId, transferId: item.transferId }); }
  catch (error) { item.cancelError = String(error); }
  finally { item.cancelling = false; scheduleSshTaskPaint(); }
}
async function cancelSshBatch(batch) {
  batch.cancelRequested = true; batch.paused = true;
  for (const item of batch.items) if (item.status === 'queued') item.status = 'cancelled';
  await Promise.all(batch.items.filter(sshItemActive).map((item) => cancelSshQueueItem(batch, item)));
  finishSshBatch(batch); scheduleSshTaskPaint(); ensureSshQueuePoll();
  void pumpSshQueue(batch.owner);
}
function disconnectSshQueue(tb) {
  for (const batch of sshTaskBatches.filter((b) => b.owner === tb && !sshBatchDone(b))) {
    batch.paused = true;
    for (const item of batch.items) {
      if (item.status === 'queued') item.status = 'cancelled';
      else if (sshItemActive(item)) { item.status = 'interrupted'; item.resolveUntil = Date.now() + 15000; item.error = sshTaskText('连接已关闭；请核对目标文件，完成保存的结果仍可能随后返回。', 'Connection closed. Check the destination; final publication results may still arrive.'); }
    }
    finishSshBatch(batch);
  }
  scheduleSshTaskPaint();
}
function ensureSshQueuePoll() {
  if (sshQueueTimer || !sshTaskBatches.some((b) => !sshBatchDone(b) || b.items.some((i) => i.status === 'interrupted' && i.resolveUntil > Date.now()))) return;
  sshQueueTimer = setTimeout(async () => {
    try {
      const pending = [];
      for (const batch of sshTaskBatches) {
        if (!sshBatchDone(batch) && (batch.owner.disposed || batch.owner.exited || batch.owner.key !== batch.key || batch.owner.termId !== batch.sessionId)) disconnectSshQueue(batch.owner);
        for (const item of batch.items) if ((sshItemActive(item) || (item.status === 'interrupted' && item.resolveUntil > Date.now())) && !item.launchPending && item.transferId) pending.push((async () => {
          try {
            const progress = await invoke('ssh_transfer_status', { id: batch.sessionId, transferId: item.transferId });
            if (progress) receiveSshQueuedTransfer(progress);
            else if (sshItemActive(item)) { item.status = 'interrupted'; item.error = sshTaskText('未找到传输状态，请核对目标后重试。', 'Transfer status unavailable. Verify the destination before retrying.'); batch.paused = true; }
          } catch (error) { if (sshItemActive(item)) item.queryError = String(error); }
        })());
      }
      await Promise.all(pending);
      for (const tb of new Set(sshTaskBatches.map((b) => b.owner))) void pumpSshQueue(tb);
      scheduleSshTaskPaint();
    } finally { sshQueueTimer = null; ensureSshQueuePoll(); }
  }, 1200);
}
function scheduleSshTaskPaint() {
  if (sshTaskFrame != null) return;
  sshTaskFrame = requestAnimationFrame(() => {
    sshTaskFrame = null; syncSshTaskButton(); renderSshTaskCenter();
    for (const tb of new Set(sshTaskBatches.map((b) => b.owner))) if (tb.sshFilesPanel && !tb.disposed) renderSshTransfer(tb);
  });
}
function sshQueueForTab(tb) { return sshTaskBatches.filter((b) => b.owner === tb && b.key === tb.key && b.sessionId === tb.termId); }
function renderSshQueueSummary(tb) {
  const batches = sshQueueForTab(tb), batch = batches.find((b) => !sshBatchDone(b)) || batches.at(-1);
  if (!batch) return false;
  const host = tb.sshFilesPanel?.querySelector('.ssh-transfer-status'); if (!host) return false;
  if (!host.querySelector('[data-queue-summary]')) host.innerHTML = '<span data-queue-summary></span><progress></progress><button type="button" data-queue-open></button>';
  const s = sshBatchStats(batch); host.querySelector('[data-queue-summary]').textContent = sshBatchCaption(batch);
  const progress = host.querySelector('progress'); progress.max = batch.items.length; progress.value = batch.items.filter(sshItemDone).length;
  progress.setAttribute('aria-label', sshTaskText('批次处理进度（包括失败和取消）', 'Batch items processed (including errors and cancellations)'));
  const open = host.querySelector('[data-queue-open]'); open.textContent = sshTaskText('查看任务', 'View tasks'); open.onclick = () => openSshTaskCenter(batch.id);
  host.title = `${sshSize(s.bytes)} / ${s.known ? sshSize(s.total) : sshTaskText('总大小待确认', 'Unknown total')}`;
  updateSshTransferControls(tb); return true;
}
function syncSshTaskButton() {
  const button = $('btnTransfers'); if (!button) return;
  const pending = sshTaskBatches.reduce((n, b) => n + b.items.filter((i) => !sshItemDone(i)).length, 0);
  const text = sshTaskText('传输任务', 'Transfers') + (pending ? ` · ${pending}` : '');
  button.querySelector('span:last-child').textContent = text; button.title = text; button.setAttribute('aria-label', text);
}
function initSshTaskCenter() {
  if ($('btnTransfers')) return;
  const button = document.createElement('button'); button.id = 'btnTransfers'; button.className = 'command-trigger'; button.innerHTML = '<span aria-hidden="true">⇅</span><span></span>';
  $('btnSettings').before(button); button.onclick = () => openSshTaskCenter(); syncSshTaskButton();
}
function selectedSshFiles(view) { return view.entries.filter((entry, index) => view.selection?.has(index) && !entry.isLink); }
async function beginSshBatch(tb, direction, folder = false) {
  const view = tb.sshFiles;
  if (!view || view.busy || view.ready === false || tb.exited || !tb.sshAuthenticated || tb.sshDisconnectRequested || sshTaskPicker || sshTaskReview?.open) return;
  const selected = selectedSshFiles(view);
  if (direction === 'download' && !selected.length) return;
  if (selected.length > 200) { toast(sshTaskText('每批最多 200 个文件，请减少选择。', 'Select at most 200 files per batch.'), true); return; }
  const captured = { key: tb.key, id: tb.termId, remote: view.path }; sshTaskPicker = captured; tb.sshBatchPicking = true; updateSshTransferControls(tb);
  try {
    await ensureManagedSshEvents();
    let paths, directory = null;
    if (direction === 'upload') { if (folder) { const path = await invoke('ssh_pick_download_directory'); paths = path ? [path] : []; } else paths = await invoke('ssh_pick_upload_files'); if (!paths?.length) return; }
    else { directory = await invoke('ssh_pick_download_directory'); if (!directory) return; paths = selected.map((e) => e.name); }
    if (tb.disposed || tb.exited || tb.key !== captured.key || tb.termId !== captured.id) return;
    const files = await invoke('ssh_transfer_prepare', { id: captured.id, direction, paths, directory, remote: captured.remote, recursive: folder || selected.some(e => e.isDir) });
    if (tb.disposed || tb.exited || tb.key !== captured.key || tb.termId !== captured.id) return;
    if (direction === 'download') for (const file of files) file.size ??= selected.find((e) => e.name === file.name)?.size ?? null;
    showSshBatchReview(tb, files, direction, direction === 'upload' ? captured.remote : directory);
  } catch (error) { toast(String(error), true); }
  finally { if (sshTaskPicker === captured) sshTaskPicker = null; tb.sshBatchPicking = false; updateSshTransferControls(tb); }
}
function showSshBatchReview(tb, files, direction, destination, retry = null) {
  if (sshTaskReview?.open) return;
  const T = sshTaskText, key = tb.key, sessionId = tb.termId, uncertain = !!retry?.items.some((i) => i.status === 'interrupted');
  const dialog = document.createElement('dialog'); dialog.className = 'file-settings-dialog ssh-batch-review'; dialog.id = 'sshBatchReview'; dialog.setAttribute('aria-labelledby', 'sshBatchTitle');
  dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">SFTP · ${esc(sshQueueLabel(tb))}</span><h2 id="sshBatchTitle">${T(direction === 'upload' ? '批量上传' : '批量下载', direction === 'upload' ? 'Upload files' : 'Download files')}</h2></div><button data-batch-close aria-label="${T('关闭', 'Close')}">×</button></header><div class="file-settings-body"><p>${T('目标目录', 'Destination')} <strong class="ssh-task-path">${esc(destination)}</strong></p><p class="preview-note">${files.length} ${T('个项目（含目录）。保留目录层次与空目录；已有目录可合并，同名文件不覆盖。目标不会随目录切换改变。', 'entries including folders. Folder hierarchy and empty folders are preserved; existing folders merge, files are not overwritten. This destination stays fixed.')}</p><ul class="ssh-batch-files">${files.map((f) => `<li><strong>${f.entryKind === 'directory' ? '📁 ' : ''}${esc(f.name)}${f.resumeId ? ' ⏯' : ''}</strong><small>${esc(direction === 'upload' ? f.localPath : f.remote)}</small></li>`).join('')}</ul><label class="ssh-task-check"><input type="checkbox" id="sshBatchStop">${T('遇到失败时暂停后续文件', 'Pause remaining files after an error')}</label>${uncertain ? `<label class="ssh-task-check"><input type="checkbox" id="sshBatchVerified">${T('已核对目标文件，确认需要重新传输这些未确认的项目', 'I checked the destination and want to transfer these uncertain items again')}</label>` : ''}<label class="ssh-task-check"><input type="checkbox" id="sshBatchResume" checked>${T('断线或失败时保留临时文件以便续传', 'Keep partial files after disconnect/errors for resume')}</label><p class="preview-note">${T('续传会先读取并核对已有内容，取消则删除临时数据。仅本次运行保留续传记录；退出前请完成任务或清理临时文件。重新登录后需手动重试，不自动传输。', 'Resume first verifies all existing bytes. Cancel deletes partial data. Checkpoints last for this app session; finish or discard partial files before exiting. Reconnect never replays tasks automatically.')}</p><p id="sshBatchError" role="status"></p></div><footer class="file-settings-footer"><button data-batch-close>${T('取消', 'Cancel')}</button><span class="file-settings-spacer"></span><button id="sshBatchStart" class="file-settings-primary" ${uncertain ? 'disabled' : ''}>${T('加入传输队列', 'Add to transfer queue')}</button></footer>`;
  document.body.appendChild(dialog); sshTaskReview = dialog;
  dialog.querySelectorAll('[data-batch-close]').forEach((b) => b.onclick = () => dialog.close());
  if (uncertain) dialog.querySelector('#sshBatchVerified').onchange = (e) => { dialog.querySelector('#sshBatchStart').disabled = !e.target.checked; };
  dialog.querySelector('#sshBatchStart').onclick = () => {
    try {
      if (tb.key !== key || tb.termId !== sessionId || (retry && sshQueueIdentity(tb) !== retry.identity)) throw new Error(T('连接已变化，请关闭后重试。', 'Connection changed. Close this dialog and retry.'));
      if (uncertain && !dialog.querySelector('#sshBatchVerified').checked) return;
      const batch = createSshBatch(tb, files, direction, destination, dialog.querySelector('#sshBatchStop').checked, dialog.querySelector('#sshBatchResume').checked);
      if (retry) { retry.retried = true; for (const item of retry.items) item.resumeId = null; }
      dialog.close(); openSshTaskCenter(batch.id);
    } catch (error) { dialog.querySelector('#sshBatchError').textContent = String(error); }
  };
  dialog.addEventListener('close', () => { if (sshTaskReview === dialog) sshTaskReview = null; dialog.remove(); }); dialog.showModal();
}
function retrySshBatch(batch) {
  if (!sshBatchDone(batch) || batch.retried) return;
  const connected = (tb) => !tb.disposed && !tb.exited && tb.sshAuthenticated && !tb.sshDisconnectRequested && sshQueueIdentity(tb) === batch.identity;
  const tb = connected(batch.owner) ? batch.owner : state.tabs.find((tab) => tab.sshConfig?.managed && connected(tab));
  if (!tb) { toast(sshTaskText('请先连接同一主机和账户，再重试这些项目。', 'Connect to the same host and account before retrying these items.'), true); return; }
  const files = batch.items.filter((i) => i.status !== 'complete').map((i) => ({ name: i.name, localPath: i.localPath, remote: i.remote, size: i.total, entryKind: i.entryKind, resumeId: i.resumeId }));
  if (files.length) showSshBatchReview(tb, files, batch.direction, batch.destination, batch);
}
function openSshTaskCenter(id) {
  if (sshTaskDialog?.open) { if (id) sshTaskDialog.dataset.selected = id; renderSshTaskCenter(); return; }
  const T = sshTaskText, dialog = document.createElement('dialog'); dialog.id = 'sshTaskCenter'; dialog.className = 'file-settings-dialog ssh-task-center'; dialog.setAttribute('aria-labelledby', 'sshTaskTitle');
  dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">SFTP · ${T('本次运行', 'THIS SESSION')}</span><h2 id="sshTaskTitle">${T('传输任务', 'Transfers')}</h2></div><button data-tasks-close aria-label="${T('关闭', 'Close')}">×</button></header><div class="ssh-task-layout"><nav id="sshBatchList" aria-label="${T('传输批次', 'Transfer batches')}"></nav><section class="ssh-task-detail"><p id="sshTaskEmpty">${T('还没有传输任务。在 SSH 远程文件面板中多选文件后下载，或选择多个本地文件上传。', 'No transfers yet. Select files in the SSH file panel to download, or choose local files to upload.')}</p><div id="sshTaskDetails" hidden><h3 id="sshTaskHost"></h3><p id="sshTaskDestination" class="ssh-task-path"></p><p id="sshTaskSummary" role="status"></p><div class="ssh-task-actions"><button data-task-pause></button><button data-task-cancel>${T('取消本批', 'Cancel batch')}</button><button data-task-retry>${T('重试未成功项…', 'Retry unsuccessful items…')}</button><button data-task-discard>${T('清理续传临时文件', 'Discard partial files')}</button><button data-task-source>${T('回到连接', 'Go to connection')}</button></div><p id="sshTaskNotice" class="preview-note"></p><div id="sshTaskItems"></div></div></section></div><footer class="file-settings-footer"><button data-task-clear>${T('清除已结束记录', 'Clear finished records')}</button><span class="file-settings-spacer"></span><button data-tasks-close>${T('关闭面板（任务继续）', 'Close panel (keep transferring)')}</button></footer>`;
  document.body.appendChild(dialog); sshTaskDialog = dialog; dialog.dataset.selected = id || sshTaskBatches.at(-1)?.id || '';
  dialog.querySelectorAll('[data-tasks-close]').forEach((b) => b.onclick = () => dialog.close());
  dialog.querySelector('#sshBatchList').onclick = (event) => { const button = event.target.closest('[data-batch]'); if (button) { dialog.dataset.selected = button.dataset.batch; renderSshTaskCenter(); } };
  const selected = () => sshTaskBatches.find((b) => b.id === dialog.dataset.selected);
  dialog.querySelector('[data-task-pause]').onclick = () => { const b = selected(); if (b && !b.cancelRequested && sshQueueConnected(b)) { b.paused = !b.paused; if (!b.paused) void pumpSshQueue(b.owner); scheduleSshTaskPaint(); } };
  dialog.querySelector('[data-task-cancel]').onclick = () => { const b = selected(); if (b) void cancelSshBatch(b); };
  dialog.querySelector('[data-task-retry]').onclick = () => { const b = selected(); if (b) retrySshBatch(b); };
  dialog.querySelector('[data-task-discard]').onclick = async () => { const b = selected(); if (!b || !sshBatchDone(b)) return; const tb = state.tabs.find(t => t.sshAuthenticated && !t.exited && sshQueueIdentity(t) === b.identity); if (!tb) { toast(T('请连接同一主机和账户后清理。', 'Connect to the same host/account to discard partials.'), true); return; } try { for (const item of b.items.filter(i => i.resumeId)) { await invoke('ssh_resume_discard', { id: tb.termId, resumeId: item.resumeId }); item.resumeId = null; } } catch(e) { toast(String(e), true); } scheduleSshTaskPaint(); };
  dialog.querySelector('[data-task-source]').onclick = () => { const index = state.tabs.indexOf(selected()?.owner); if (index >= 0) { dialog.close(); switchTab(index); } };
  dialog.querySelector('[data-task-clear]').onclick = () => { for (let i = sshTaskBatches.length - 1; i >= 0; i--) if (sshBatchDone(sshTaskBatches[i]) && !sshTaskBatches[i].items.some(item => item.resumeId)) sshTaskBatches.splice(i, 1); scheduleSshTaskPaint(); };
  dialog.addEventListener('close', () => { if (sshTaskDialog === dialog) sshTaskDialog = null; dialog.remove(); }); dialog.showModal(); renderSshTaskCenter();
}
function renderSshTaskCenter() {
  const dialog = sshTaskDialog; if (!dialog?.open) return;
  const T = sshTaskText, list = dialog.querySelector('#sshBatchList');
  if (!sshTaskBatches.some((b) => b.id === dialog.dataset.selected)) dialog.dataset.selected = sshTaskBatches.at(-1)?.id || '';
  const old = new Map([...list.children].map((node) => [node.dataset.batch, node]));
  for (const batch of sshTaskBatches) {
    let row = old.get(batch.id); old.delete(batch.id);
    if (!row) { row = document.createElement('button'); row.dataset.batch = batch.id; row.innerHTML = '<strong></strong><span></span><small></small>'; list.prepend(row); }
    row.querySelector('strong').textContent = (batch.direction === 'upload' ? '↑ ' : '↓ ') + batch.host;
    row.querySelector('span').textContent = sshBatchCaption(batch); row.querySelector('small').textContent = new Date(batch.createdAt).toLocaleTimeString();
    row.setAttribute('aria-pressed', String(row.dataset.batch === dialog.dataset.selected));
  }
  for (const row of old.values()) row.remove();
  let batch = sshTaskBatches.find((b) => b.id === dialog.dataset.selected);
  if (!batch) { batch = sshTaskBatches.at(-1); dialog.dataset.selected = batch?.id || ''; }
  dialog.querySelector('#sshTaskEmpty').hidden = !!batch; dialog.querySelector('#sshTaskDetails').hidden = !batch;
  dialog.querySelector('[data-task-clear]').disabled = !sshTaskBatches.some(sshBatchDone);
  if (!batch) return;
  const s = sshBatchStats(batch), active = batch.items.find(sshItemActive);
  dialog.querySelector('#sshTaskHost').textContent = batch.host + ' · ' + T(batch.direction === 'upload' ? '上传' : '下载', batch.direction === 'upload' ? 'Upload' : 'Download');
  dialog.querySelector('#sshTaskDestination').textContent = T('目标：', 'Destination: ') + batch.destination;
  dialog.querySelector('#sshTaskSummary').textContent = sshBatchCaption(batch) + ` · ${sshSize(s.bytes)} / ${s.known ? sshSize(s.total) : T('总大小待确认', 'unknown total')}` + (active?.status === 'running' ? ` · ${sshSize(Math.max(0, active.bytes - (active.resumedBytes || 0)) / Math.max(1, (Date.now() - active.startedAt) / 1000))}/s` : '');
  const pause = dialog.querySelector('[data-task-pause]'); pause.textContent = batch.paused ? T('继续队列', 'Resume queue') : T('完成当前文件后暂停', 'Pause after current file'); pause.disabled = sshBatchDone(batch) || batch.cancelRequested || !sshQueueConnected(batch);
  dialog.querySelector('[data-task-cancel]').disabled = sshBatchDone(batch);
  dialog.querySelector('[data-task-retry]').disabled = !sshBatchDone(batch) || batch.retried || batch.items.every((i) => i.status === 'complete');
  dialog.querySelector('[data-task-discard]').disabled = !sshBatchDone(batch) || !batch.items.some(i => i.resumeId);
  dialog.querySelector('[data-task-source]').disabled = !state.tabs.includes(batch.owner);
  dialog.querySelector('#sshTaskNotice').textContent = T('失败与取消计入已处理数量，不代表传输成功。取消需等待当前读写与临时文件清理；完成保存阶段会等待最终结果。', 'Processed items include failures and cancellations. Cancelling waits for I/O and temporary file cleanup; finalization waits for the actual result.');
  const host = dialog.querySelector('#sshTaskItems');
  if (host.dataset.batch !== batch.id) { host.replaceChildren(); host.dataset.batch = batch.id; }
  batch.items.forEach((item, index) => {
    let row = host.children[index];
    if (!row) { row = document.createElement('div'); row.className = 'ssh-task-item'; row.innerHTML = '<strong></strong><span></span><progress></progress><small></small><p></p>'; host.append(row); }
    row.dataset.status = item.status; row.querySelector('strong').textContent = item.name; row.querySelector('span').textContent = sshTaskStatus(item.status) + (item.resumeId && sshItemDone(item) ? T(' · 可续传', ' · Resumable') : '');
    const progress = row.querySelector('progress'); progress.max = Math.max(1, item.total || 1); progress.value = item.status === 'complete' ? progress.max : Math.min(item.bytes, progress.max); progress.setAttribute('aria-label', item.name);
    row.querySelector('small').textContent = `${sshSize(item.bytes)} / ${item.total == null ? '—' : sshSize(item.total)}${item.resumedBytes ? T(' · 续传起点 ', ' · Resumed at ') + sshSize(item.resumedBytes) : ''}`;
    const error = row.querySelector('p'); error.textContent = item.error || item.cancelError || (item.queryError ? T('状态查询失败：', 'Status query failed: ') + item.queryError : ''); error.hidden = !error.textContent;
    row.title = item.localPath + ' ⇄ ' + item.remote;
  });
}

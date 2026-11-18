'use strict';
// Archives contain text, never live plan handles, permissions or API settings.
const chatText = (zh, en) => locale === 'zh' ? zh : en;
let chatHistoryView = null;
function aiArchive(session) {
  return session.archive ||= { id: crypto.randomUUID(), title: '', revision: 0, auto: false, saved: '', saving: null, timer: null, error: '' };
}
function aiArchiveSnapshot(session) {
  const archive = aiArchive(session);
  const messages = session.messages.map((message) => {
    let text = String(message.text || '');
    if (message.plan) text += '\n\n[Historical plan; status: ' + message.planState + '. A proposal is not proof of execution.]\n' + JSON.stringify(message.plan.actions, (field, value) => field === 'content' || field === 'original' ? undefined : value);
    if (message.journalId) text += '\n[Local file operation record: ' + message.journalId + ']';
    if (message.results) text += '\n\n[Local execution results]\n' + JSON.stringify(message.results);
    return { id: message.id, role: message.role, text, omitHistory: !!message.omitHistory, ...(message.steps?.length ? { steps: message.steps } : {}) };
  });
  const title = archive.title || aiChars((messages.find((m) => m.role === 'user')?.text || chatText('未命名对话', 'Untitled conversation')).replace(/[\x00-\x1f\x7f]/g, ' ').trim(), 60);
  const ids = new Set(messages.map((m) => m.id));
  return { id: archive.id, title, messages, summary: session.conversationSummary || '', summarizedIds: [...(session.summarizedIds || [])].filter((id) => ids.has(id)), compactedMessages: session.compactedMessages || 0 };
}
async function saveAiArchive(session, fresh = false) {
  if (!session?.messages.length) return false;
  const archive = aiArchive(session);
  clearTimeout(archive.timer); archive.timer = null;
  // Every write to this conversation observes the revision of the previous write.
  if (archive.saving) {
    await archive.saving;
    if (session.archive !== archive || archive.error) return false;
    return saveAiArchive(session, fresh);
  }
  const snapshot = aiArchiveSnapshot(session);
  if (fresh) snapshot.id = crypto.randomUUID();
  const serialized = JSON.stringify(snapshot);
  if (archive.saved === serialized) return true;
  archive.error = '';
  const job = invoke('agent_chat_save', { root: session.root, snapshot, expectedRevision: fresh ? 0 : archive.revision }).then((result) => {
    archive.id = snapshot.id; archive.revision = result.revision; archive.saved = serialized;
    archive.failedWrite = ''; archive.dismissed = '';
    return true;
  }).catch((error) => {
    archive.error = String(error); archive.auto = false; archive.failedWrite = fresh ? 'copy' : 'save'; archive.dismissed = '';
    toast(chatText('对话未保存：', 'Chat not saved: ') + archive.error, true);
    return false;
  });
  archive.saving = job; renderAiArchiveStatus();
  const ok = await job;
  archive.saving = null;
  renderAiArchiveStatus();
  // A reply may have arrived during disk I/O. Queue its own snapshot afterwards.
  if (ok && archive.auto && session.archive === archive && JSON.stringify(aiArchiveSnapshot(session)) !== archive.saved) scheduleAiArchive(session);
  return ok;
}
function scheduleAiArchive(session) {
  const archive = session?.archive;
  if (!archive?.auto) return;
  clearTimeout(archive.timer);
  archive.timer = setTimeout(() => { archive.timer = null; void saveAiArchive(session); }, 350);
}
function retireAiArchive(session) {
  const archive = session?.archive;
  if (!archive) return;
  clearTimeout(archive.timer); archive.timer = null;
  if (archive.auto) void saveAiArchive(session);
}
function aiArchiveHasUnsavedText(session) {
  return !!session?.messages.length && (!session.archive?.saved || JSON.stringify(aiArchiveSnapshot(session)) !== session.archive.saved);
}
function aiArchiveNeedsFlush(session, finishWrite = false) {
  const archive = session?.archive;
  if (!archive) return false;
  if (archive.saving) return true;
  if ((!archive.auto && !archive.failedWrite && !finishWrite) || !aiArchiveHasUnsavedText(session)) return false;
  return !archive.dismissed || archive.dismissed !== JSON.stringify(aiArchiveSnapshot(session));
}
// Only a user action that would leave this conversation opens recovery. Background saves stay paused.
function chooseAiArchiveRecovery(session) {
  if (document.getElementById('chatRecoveryDialog')) return Promise.resolve('keep');
  const T = chatText, dialog = document.createElement('dialog');
  dialog.id = 'chatRecoveryDialog'; dialog.className = 'file-settings-dialog';
  dialog.setAttribute('aria-labelledby', 'chatRecoveryTitle');
  dialog.innerHTML = '<header class="file-settings-head"><h2 id="chatRecoveryTitle"></h2></header><div class="file-settings-body"><strong></strong><p class="chat-root"></p><p role="status"></p><p class="chat-note"></p><div class="chat-actions"></div></div>';
  dialog.querySelector('h2').textContent = T('这段对话尚未保存', 'This conversation has unsaved changes');
  dialog.querySelector('strong').textContent = aiArchiveSnapshot(session).title;
  dialog.querySelector('.chat-root').textContent = session.root;
  dialog.querySelector('[role=status]').textContent = session.archive.error;
  dialog.querySelector('.chat-note').textContent = T('另存会保留原记录。放弃只允许本次操作跳过保存，不会删除磁盘上的记录。', 'Saving a copy keeps the original. Discard skips saving these changes and leaves the disk record intact.');
  const actions = [['keep',T('保留并返回','Keep editing')],['retry',T('重试保存','Retry save')],['copy',T('另存为新对话','Save as new')],['discard',T('放弃本次未保存的修改','Discard these changes')]];
  for (const [value,label] of actions) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.recovery = value; button.textContent = label;
    button.onclick = () => dialog.close(value); dialog.querySelector('.chat-actions').append(button);
  }
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue || 'keep'); }, {once:true});
    dialog.showModal(); dialog.querySelector('[data-recovery=keep]').focus();
  });
}
async function flushAiArchiveForExit(session, finishWrite = false, stillLeaving = () => true) {
  if (!aiArchiveNeedsFlush(session, finishWrite)) return true;
  const archive = session.archive;
  if (archive.leaving) return false;
  archive.leaving = true;
  try {
    let ok = archive.failedWrite && !archive.saving ? false : await saveAiArchive(session);
    while (stillLeaving() && session.archive === archive && !session.closed) {
      if (!ok) {
        const snapshot = JSON.stringify(aiArchiveSnapshot(session)), revision = archive.revision;
        const choice = await chooseAiArchiveRecovery(session);
        if (choice === 'keep' || !stillLeaving() || session.closed || session.archive !== archive || archive.saving || archive.revision !== revision ||
            snapshot !== JSON.stringify(aiArchiveSnapshot(session))) return false;
        if (choice === 'discard') { archive.dismissed = snapshot; return true; }
        ok = await saveAiArchive(session, choice === 'copy' || archive.failedWrite === 'copy');
      } else if (aiArchiveHasUnsavedText(session)) {
        // A reply can arrive while a manual save or a recovery write is in progress.
        ok = await saveAiArchive(session);
      } else return true;
    }
    return false;
  } finally { archive.leaving = false; }
}
function aiHasWorkToStop(s) { return !!s.requestId || s.messages.some(m => m.plan && m.planState === 'pending'); }
function aiSessionNeedsExitWork(s) { return s.running || aiHasWorkToStop(s) || aiArchiveNeedsFlush(s); }
async function prepareAiSessionForExit(s, stillOwner = () => !s.closed) {
  if (s.running || !stillOwner()) return false;
  // If a write has already failed, let Keep preserve a live request or approval as well as its text.
  const protect = aiArchiveNeedsFlush(s) || s.archive?.auto;
  if (aiHasWorkToStop(s) && aiArchiveNeedsFlush(s) && !await flushAiArchiveForExit(s)) return false;
  if (s.running || !stillOwner()) return false;
  const stopping = aiHasWorkToStop(s);
  if (s.requestId) cancelAiRequest(s, false);
  if (s.messages.some(m => m.plan && m.planState === 'pending')) discardSessionPlans(s);
  // Finalizing can add the streamed text or change a plan status after a successful manual retry.
  return flushAiArchiveForExit(s, !!(protect && stopping && !s.archive?.dismissed));
}
function aiTabArchiveNeedsFlush(tab) {
  return [...aiSessions.values()].some(s => s.tab === tab && aiSessionNeedsExitWork(s));
}
function clearAiArchiveDismissal(session) { if (session?.archive) session.archive.dismissed = ''; }
async function flushAiTabArchives(tab) {
  const owners = [...aiSessions.values()].filter(s => s.tab === tab);
  if (owners.some(s => s.running)) { toast(chatText('文件操作正在执行，请在完成后关闭标签。','A file operation is running. Close the tab after it finishes.'), true); return false; }
  for (const session of owners) {
    if (aiSessionNeedsExitWork(session) && !await prepareAiSessionForExit(session)) return false;
  }
  return true;
}
function renderAiArchiveStatus() {
  const bar = $('aiArchiveBar'); if (!bar) return;
  const session = aiCurrentSession(), archive = session?.archive;
  const dirty = aiArchiveHasUnsavedText(session);
  bar.querySelector('[data-chat-open]').disabled = !session;
  const save = bar.querySelector('[data-chat-save]'); save.disabled = !session?.messages.length || !!archive?.saving;
  save.textContent = chatText('保存', 'Save');
  bar.querySelector('[data-chat-open]').textContent = chatText('对话历史', 'Chat history');
  const files = bar.querySelector('[data-file-history]');
  if (files) { files.disabled = !session; files.textContent = chatText('工作区历史', 'Workspace history'); }
  const status = bar.querySelector('[data-chat-status]');
  status.textContent = archive?.saving ? chatText('正在保存…', 'Saving…') : archive?.error ? chatText('保存失败', 'Save failed') : !dirty && archive?.revision ? chatText('已保存', 'Saved') : archive?.auto ? chatText('自动保存中', 'Auto-save on') : chatText('临时对话', 'Temporary chat');
  status.title = archive?.error || (archive?.revision ? session.root + '\\.dalizi\\chat-history.json' : chatText('点“保存”或在对话历史中开启自动保存', 'Save manually or enable auto-save in Chat history'));
  if (chatHistoryView?.dialog.open && chatHistoryView.session === session) renderChatCurrentStatus(chatHistoryView);
}
function initAiArchives() {
  if (!aiPanel || $('aiArchiveBar')) return;
  const bar = document.createElement('div'); bar.id = 'aiArchiveBar';
  bar.innerHTML = '<span data-chat-status role="status"></span><button class="ai-link" data-chat-save></button><button class="ai-link" data-file-history></button><button class="ai-link" data-chat-open></button>';
  // A compact, dedicated row leaves history accessible when messages scroll.
  $('aiContextRow').after(bar);
  aiPanel.classList.add('has-chat-archives');
  bar.querySelector('[data-chat-save]').addEventListener('click', () => { const session = aiCurrentSession(); if (session) void saveAiArchive(session); });
  bar.querySelector('[data-chat-open]').addEventListener('click', openAiChatHistory);
  bar.querySelector('[data-file-history]').addEventListener('click', () => openFileHistory());
  renderAiArchiveStatus();
}
function renderChatCurrentStatus(view) {
  const { session, dialog } = view, archive = aiArchive(session);
  const active = aiSessions.get(session.key) === session && !session.closed;
  dialog.querySelector('#chatAutoSave').disabled = !active || !!archive.saving;
  dialog.querySelector('#chatAutoSave').checked = archive.auto;
  for (const id of ['chatSave', 'chatSaveCopy']) dialog.querySelector('#' + id).disabled = !active || !session.messages.length || !!archive.saving || view.busy;
  dialog.querySelector('#chatExportCurrent').disabled = !session.messages.length || view.busy;
  const dirty = archive.saved !== JSON.stringify(aiArchiveSnapshot(session));
  dialog.querySelector('#chatCurrentStatus').textContent = archive.error || (archive.saving ? chatText('正在保存…', 'Saving…') : archive.revision && !dirty ? archive.auto ? chatText('已保存，后续消息会自动保存。', 'Saved. New messages will be saved automatically.') : chatText('已保存；后续修改请再次保存或启用自动保存。', 'Saved. Save again after changes or enable auto-save.') : chatText('当前有尚未保存到磁盘的内容。', 'This conversation has unsaved content.'));
}
async function refreshChatHistory(view) {
  const sequence = ++view.sequence;
  try {
    const items = await invoke('agent_chat_list', { root: view.root });
    if (chatHistoryView !== view || sequence !== view.sequence) return;
    view.items = items; const list = view.dialog.querySelector('#chatSavedList');
    const repair = view.dialog.querySelector('#chatPrepareRollback');
    if (repair) repair.hidden = !items.some(item => item.inlineSteps);
    list.innerHTML = items.length ? items.map((item, index) => `<button type="button" data-chat-item="${index}"><strong>${esc(item.title)}</strong><small>${esc(new Date(item.updatedAt).toLocaleString())} · ${item.messageCount} ${chatText('条消息', 'messages')}</small></button>`).join('') : `<p>${chatText('此目录还没有已保存的对话。', 'No saved conversations in this folder.')}</p>`;
  } catch (error) { if (chatHistoryView === view) view.dialog.querySelector('#chatHistoryStatus').textContent = String(error); }
}
async function continueChatArchive(view, record) {
  if (view.busy) return;
  view.busy = true;
  try {
    if (typeof aiProjectScope === 'function' && aiProjectScope(view.root) && aiCurrentSession() === view.session) {
      const current = view.session;
      if (current.running || current.restoring) return;
      if (aiSessionNeedsExitWork(current) && !await prepareAiSessionForExit(current, () => aiCurrentSession() === current)) return;
      if (aiCurrentSession() !== current || current.running || current.requestId) return;
      clearTimeout(aiArchive(current).timer);
      const revision = current.revision, draft = current.draft, activation = current.activation;
      // Reload after flushing, since the selected record may be the active one.
      const latest = await invoke('agent_chat_read', {root:view.root, id:record.snapshot.id});
      if (aiCurrentSession() !== current || current.running || current.requestId || current.revision !== revision ||
          current.activation !== activation || current.draft !== draft || aiArchiveNeedsFlush(current)) return;
      loadProjectRecord(current, latest); current.activation++; current.draft = ''; $('aiPrompt').value = '';
      aiPaintIdentity = ''; renderAiConversation(); updateAiComposer(); view.dialog.close(); return;
    }
    // A new tab keeps the current draft and session untouched and revokes all old authority.
    const loading = newTab(view.root), owner = curTab(); await loading;
    if (curTab() !== owner || state.error || aiKey(state.path) !== aiKey(view.root)) throw new Error(chatText('目录无法打开或标签已切换，未恢复对话。', 'The folder could not open or the active tab changed; conversation was not restored.'));
    const session = aiCurrentSession();
    if (!session || session.messages.length || session.requestId || session.running) throw new Error(chatText('标签状态已变化，请重试。', 'The active tab changed; please retry.'));
    const snapshot = record.snapshot;
    session.messages = snapshot.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, omitHistory: m.omitHistory, steps: m.steps || [] }));
    session.conversationSummary = snapshot.summary; session.summarizedIds = new Set(snapshot.summarizedIds);
    session.compactedMessages = snapshot.compactedMessages; session.permissionMode = 'confirm'; session.activation++; session.revision++;
    session.agentRole = null; session.useRoleSkills = false; session.roleGeneration = (session.roleGeneration || 0) + 1;
    aiArchive(session).auto = false; aiArchive(session).title = snapshot.title; // independent ID; the original remains intact
    aiPaintIdentity = ''; renderAiConversation(); updateAiComposer(); openAiAssistant();
    view.dialog.close(); toast(chatText('已在新标签恢复文字记录；操作需要重新生成并确认。', 'Restored text in a new tab. Actions need a new plan and confirmation.'));
  } catch (error) { view.dialog.querySelector('#chatHistoryStatus').textContent = String(error); }
  finally { clearAiArchiveDismissal(view.session); view.busy = false; }
}
async function exportChatSnapshot(snapshot, view) {
  const path = await invoke('agent_chat_export', { snapshot });
  if (path && view.dialog.open) view.dialog.querySelector('#chatHistoryStatus').textContent = chatText('已导出：', 'Exported: ') + path;
}
function openAiChatHistory() {
  if (chatHistoryView?.dialog.open) return chatHistoryView.dialog.focus();
  const session = aiCurrentSession(); if (!session) return;
  const T = chatText, archive = aiArchive(session), dialog = document.createElement('dialog');
  dialog.id = 'chatHistoryDialog'; dialog.className = 'file-settings-dialog chat-history-dialog'; dialog.setAttribute('aria-labelledby', 'chatHistoryTitle');
  dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">${T('当前目录 · 对话档案', 'FOLDER · CONVERSATIONS')}</span><h2 id="chatHistoryTitle">${T('对话历史', 'Chat history')}</h2></div><button type="button" data-chat-close aria-label="${T('关闭', 'Close')}">×</button></header><div class="file-settings-body"><p class="chat-root">${esc(session.root)}</p><p class="chat-note">${T('保存到本目录 .dalizi/chat-history.json（明文）。最多 30 条对话，每条保留最近 60 条消息和摘要。不保存 API 密钥与执行权限；正文中粘贴的内容会原样保存。', 'Saved as plain text in .dalizi/chat-history.json here. Up to 30 chats, each with its latest 60 messages and summary. API credentials and permissions are excluded; pasted text is saved as entered.')}</p><section class="chat-current"><label for="chatArchiveTitle">${T('当前对话标题', 'Current chat title')}</label><input id="chatArchiveTitle" maxlength="120" value="${esc(aiArchiveSnapshot(session).title)}"><label class="chat-auto"><input type="checkbox" id="chatAutoSave" ${archive.auto ? 'checked' : ''}>${T('自动保存本次对话（仅此会话）', 'Auto-save this conversation only')}</label><div class="chat-actions"><button id="chatSave">${T('保存', 'Save')}</button><button id="chatSaveCopy">${T('另存为新对话', 'Save as new')}</button><button id="chatExportCurrent">${T('导出 Markdown', 'Export Markdown')}</button></div><small id="chatCurrentStatus" role="status"></small></section><div class="chat-list-heading"><h3>${T('已保存的对话', 'Saved conversations')}</h3><button id="chatRefresh">${T('刷新', 'Refresh')}</button></div><div id="chatSavedList"></div><section id="chatSavedPreview" hidden><h3 id="chatPreviewTitle"></h3><pre id="chatPreviewText"></pre><p class="chat-note">${T('在新的文件夹标签继续，不会覆盖当前对话或重放旧操作。', 'Continue in a new folder tab. Current chats and prior actions remain untouched.')}</p><div class="chat-actions"><button id="chatContinue">${T('在新标签继续', 'Continue in new tab')}</button><button id="chatExportSaved">${T('导出', 'Export')}</button><button id="chatDelete">${T('删除…', 'Delete…')}</button><button id="chatConfirmDelete" hidden>${T('确认删除这条记录', 'Confirm deletion')}</button></div></section><p id="chatHistoryStatus" role="status" aria-live="polite"></p></div><footer class="file-settings-footer"><span class="file-settings-spacer"></span><button data-chat-close>${T('关闭', 'Close')}</button></footer>`;
  document.body.appendChild(dialog);
  const view = { dialog, session, root: session.root, sequence: 0, selection: 0, items: [], record: null, busy: false }; chatHistoryView = view;
  const status = (error) => { if (dialog.open) dialog.querySelector('#chatHistoryStatus').textContent = String(error); };
  const run = async (task) => { if (view.busy) return; view.busy = true; renderChatCurrentStatus(view); try { await task(); } catch (error) { status(error); } finally { view.busy = false; if (dialog.open) renderChatCurrentStatus(view); } };
  const title = () => { archive.title = dialog.querySelector('#chatArchiveTitle').value.trim(); if (!archive.title) throw new Error(T('请输入标题', 'Enter a title')); };
  dialog.querySelectorAll('[data-chat-close]').forEach((button) => button.addEventListener('click', () => { if (!view.busy) dialog.close(); }));
  dialog.addEventListener('cancel', (event) => { if (view.busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (chatHistoryView === view) chatHistoryView = null; dialog.remove(); });
  dialog.querySelector('#chatSave').onclick = () => run(async () => { title(); if (await saveAiArchive(session)) await refreshChatHistory(view); });
  dialog.querySelector('#chatSaveCopy').onclick = () => run(async () => { title(); if (await saveAiArchive(session, true)) await refreshChatHistory(view); });
  dialog.querySelector('#chatExportCurrent').onclick = () => run(async () => { title(); await exportChatSnapshot(aiArchiveSnapshot(session), view); });
  dialog.querySelector('#chatAutoSave').onchange = (event) => { const enabled = event.target.checked; return run(async () => { title(); archive.auto = enabled; if (archive.auto) { if (await saveAiArchive(session)) await refreshChatHistory(view); } else { clearTimeout(archive.timer); archive.timer = null; } renderAiArchiveStatus(); }); };
  dialog.querySelector('#chatArchiveTitle').onchange = () => { try { title(); scheduleAiArchive(session); } catch (error) { status(error); } };
  dialog.querySelector('#chatRefresh').onclick = () => { if (!view.busy) void refreshChatHistory(view); };
  const repair = document.createElement('button'); repair.id = 'chatPrepareRollback'; repair.hidden = true;
  repair.textContent = T('整理步骤，使旧版可读', 'Make history readable by 0.5.1');
  repair.title = T('将早期候选版的操作步骤另存；保留每条聊天的正文、时间和版本。','Store early candidate receipts separately; preserve transcripts, timestamps and revisions.');
  dialog.querySelector('#chatRefresh').before(repair);
  repair.onclick = () => run(async () => {
    const n = await invoke('agent_chat_prepare_rollback', {root:view.root});
    await refreshChatHistory(view); status(T('已整理对话：', 'Conversations prepared: ') + n);
  });
  dialog.querySelector('#chatSavedList').onclick = async (event) => {
    const button = event.target.closest('[data-chat-item]'); if (!button || view.busy) return;
    const item = view.items[Number(button.dataset.chatItem)]; if (!item) return;
    const selection = ++view.selection; view.record = null; dialog.querySelector('#chatSavedPreview').hidden = true;
    try {
      const record = await invoke('agent_chat_read', { root: view.root, id: item.id });
      if (selection !== view.selection || chatHistoryView !== view) return;
      view.record = record; dialog.querySelector('#chatPreviewTitle').textContent = record.snapshot.title;
      status(record.receiptWarning || '');
      dialog.querySelector('#chatPreviewText').textContent = (record.snapshot.summary ? T('摘要：', 'Summary: ') + record.snapshot.summary + '\n\n' : '') + record.snapshot.messages.map((m) => m.role + '\n' + m.text).join('\n\n');
      dialog.querySelector('#chatSavedPreview').hidden = false; dialog.querySelector('#chatConfirmDelete').hidden = true;
    } catch (error) { if (selection === view.selection) status(error); }
  };
  dialog.querySelector('#chatContinue').onclick = () => { if (view.record) void continueChatArchive(view, view.record); };
  dialog.querySelector('#chatExportSaved').onclick = () => run(async () => { if (view.record) await exportChatSnapshot(view.record.snapshot, view); });
  dialog.querySelector('#chatDelete').onclick = () => { if (!view.busy) dialog.querySelector('#chatConfirmDelete').hidden = false; };
  dialog.querySelector('#chatConfirmDelete').onclick = () => run(async () => {
    const record = view.record; if (!record) return;
    // Stop all live writers for this ID before deleting it; stale revisions cannot resurrect it.
    const owners = [...aiSessions.values()].filter((s) => aiKey(s.root) === aiKey(view.root) && s.archive?.id === record.snapshot.id);
    for (const owner of owners) { owner.archive.auto = false; clearTimeout(owner.archive.timer); if (owner.archive.saving) await owner.archive.saving; }
    const revision = owners[0]?.archive.revision || record.revision;
    await invoke('agent_chat_delete', { root: view.root, id: record.snapshot.id, expectedRevision: revision });
    for (const owner of owners) { owner.archive.saved = ''; owner.archive.failedWrite = ''; owner.archive.dismissed = ''; owner.archive.error = T('已删除磁盘记录；如需保留当前文字，请另存为新对话。', 'Saved record deleted. Save as new to keep this text.'); }
    view.record = null; dialog.querySelector('#chatSavedPreview').hidden = true; status(T('已删除。', 'Deleted.')); renderAiArchiveStatus(); await refreshChatHistory(view);
  });
  if (typeof aiProjectScope === 'function' && aiProjectScope(session.root)) {
    dialog.querySelector('#chatContinue').textContent = T('继续这段对话', 'Resume conversation');
    dialog.querySelector('#chatSavedPreview .chat-note').textContent = T('恢复文字和摘要，项目工具权限回到逐次确认。','Restore the transcript and summary with fresh permissions.');
  }
  dialog.showModal(); renderChatCurrentStatus(view); void refreshChatHistory(view);
}

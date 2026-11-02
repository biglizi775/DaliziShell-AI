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
    if (message.plan) text += '\n\n[Historical plan; status: ' + message.planState + '. A proposal is not proof of execution.]\n' + JSON.stringify(message.plan.actions);
    if (message.results) text += '\n\n[Local execution results]\n' + JSON.stringify(message.results);
    return { id: message.id, role: message.role, text, omitHistory: !!message.omitHistory };
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
  if (fresh) { archive.id = crypto.randomUUID(); archive.revision = 0; archive.saved = ''; }
  const snapshot = aiArchiveSnapshot(session), serialized = JSON.stringify(snapshot);
  if (archive.saved === serialized) return true;
  archive.error = '';
  const job = invoke('agent_chat_save', { root: session.root, snapshot, expectedRevision: archive.revision }).then((result) => {
    archive.revision = result.revision; archive.saved = serialized;
    return true;
  }).catch((error) => {
    archive.error = String(error); archive.auto = false;
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
function aiArchiveNeedsFlush(session) {
  return !!session?.archive?.auto && !!session.messages.length && (!!session.archive.saving || JSON.stringify(aiArchiveSnapshot(session)) !== session.archive.saved);
}
function aiTabArchiveNeedsFlush(tab) { return [...aiSessions.values()].some((s) => s.tab === tab && aiArchiveNeedsFlush(s)); }
async function flushAiTabArchives(tab) {
  for (const session of aiSessions.values()) if (session.tab === tab && aiArchiveNeedsFlush(session) && !await saveAiArchive(session)) return false;
  return true;
}
function renderAiArchiveStatus() {
  const bar = $('aiArchiveBar'); if (!bar) return;
  const session = aiCurrentSession(), archive = session?.archive;
  const dirty = !!session?.messages.length && (!archive?.saved || JSON.stringify(aiArchiveSnapshot(session)) !== archive.saved);
  bar.querySelector('[data-chat-open]').disabled = !session;
  const save = bar.querySelector('[data-chat-save]'); save.disabled = !session?.messages.length || !!archive?.saving;
  save.textContent = chatText('保存', 'Save');
  bar.querySelector('[data-chat-open]').textContent = chatText('对话历史', 'Chat history');
  const status = bar.querySelector('[data-chat-status]');
  status.textContent = archive?.saving ? chatText('正在保存…', 'Saving…') : archive?.error ? chatText('保存失败', 'Save failed') : !dirty && archive?.revision ? chatText('已保存', 'Saved') : archive?.auto ? chatText('自动保存中', 'Auto-save on') : chatText('临时对话', 'Temporary chat');
  status.title = archive?.error || (archive?.revision ? session.root + '\\.dalizi\\chat-history.json' : chatText('点“保存”或在对话历史中开启自动保存', 'Save manually or enable auto-save in Chat history'));
  if (chatHistoryView?.dialog.open && chatHistoryView.session === session) renderChatCurrentStatus(chatHistoryView);
}
function initAiArchives() {
  if (!aiPanel || $('aiArchiveBar')) return;
  const bar = document.createElement('div'); bar.id = 'aiArchiveBar';
  bar.innerHTML = '<span data-chat-status role="status"></span><button class="ai-link" data-chat-save></button><button class="ai-link" data-chat-open></button>';
  // A compact, dedicated row leaves history accessible when messages scroll.
  $('aiAgentContext').after(bar);
  aiPanel.classList.add('has-chat-archives');
  bar.querySelector('[data-chat-save]').addEventListener('click', () => { const session = aiCurrentSession(); if (session) void saveAiArchive(session); });
  bar.querySelector('[data-chat-open]').addEventListener('click', openAiChatHistory);
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
    list.innerHTML = items.length ? items.map((item, index) => `<button type="button" data-chat-item="${index}"><strong>${esc(item.title)}</strong><small>${esc(new Date(item.updatedAt).toLocaleString())} · ${item.messageCount} ${chatText('条消息', 'messages')}</small></button>`).join('') : `<p>${chatText('此目录还没有已保存的对话。', 'No saved conversations in this folder.')}</p>`;
  } catch (error) { if (chatHistoryView === view) view.dialog.querySelector('#chatHistoryStatus').textContent = String(error); }
}
async function continueChatArchive(view, record) {
  if (view.busy) return;
  view.busy = true;
  try {
    // A new tab keeps the current draft and session untouched and revokes all old authority.
    const loading = newTab(view.root), owner = curTab(); await loading;
    if (curTab() !== owner || state.error || aiKey(state.path) !== aiKey(view.root)) throw new Error(chatText('目录无法打开或标签已切换，未恢复对话。', 'The folder could not open or the active tab changed; conversation was not restored.'));
    const session = aiCurrentSession();
    if (!session || session.messages.length || session.requestId || session.running) throw new Error(chatText('标签状态已变化，请重试。', 'The active tab changed; please retry.'));
    const snapshot = record.snapshot;
    session.messages = snapshot.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, omitHistory: m.omitHistory }));
    session.conversationSummary = snapshot.summary; session.summarizedIds = new Set(snapshot.summarizedIds);
    session.compactedMessages = snapshot.compactedMessages; session.permissionMode = 'confirm'; session.activation++; session.revision++;
    aiArchive(session).title = snapshot.title; // independent ID; the original remains intact
    aiPaintIdentity = ''; renderAiConversation(); updateAiComposer(); openAiAssistant();
    view.dialog.close(); toast(chatText('已在新标签恢复文字记录；操作需要重新生成并确认。', 'Restored text in a new tab. Actions need a new plan and confirmation.'));
  } catch (error) { view.dialog.querySelector('#chatHistoryStatus').textContent = String(error); }
  finally { view.busy = false; }
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
  dialog.querySelector('#chatSavedList').onclick = async (event) => {
    const button = event.target.closest('[data-chat-item]'); if (!button || view.busy) return;
    const item = view.items[Number(button.dataset.chatItem)]; if (!item) return;
    const selection = ++view.selection; view.record = null; dialog.querySelector('#chatSavedPreview').hidden = true;
    try {
      const record = await invoke('agent_chat_read', { root: view.root, id: item.id });
      if (selection !== view.selection || chatHistoryView !== view) return;
      view.record = record; dialog.querySelector('#chatPreviewTitle').textContent = record.snapshot.title;
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
    for (const owner of owners) { owner.archive.saved = ''; owner.archive.error = T('已删除磁盘记录；如需保留当前文字，请另存为新对话。', 'Saved record deleted. Save as new to keep this text.'); }
    view.record = null; dialog.querySelector('#chatSavedPreview').hidden = true; status(T('已删除。', 'Deleted.')); renderAiArchiveStatus(); await refreshChatHistory(view);
  });
  dialog.showModal(); renderChatCurrentStatus(view); void refreshChatHistory(view);
}

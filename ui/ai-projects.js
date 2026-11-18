'use strict';

function projectText(zh, en) { return locale === 'zh' ? zh : en; }

function aiProjectList() {
  const items = store.get('aiProjects', []);
  return Array.isArray(items) ? items.filter(item => item && typeof item.root === 'string' && typeof item.name === 'string') : [];
}

function initAiProjects() {
  $('aiProjectsButton').onclick = openAiProjects;
  invoke('agent_project_directory', { name: null }).then(root => {
    if (typeof root === 'string' && root) {
      aiInboxRoot = root;
      syncAiWorkspace();
    }
  }).catch(error => { $('aiProjectsButton').title = String(error); });
}

function loadProjectRecord(session, record) {
  const snapshot = record.snapshot;
  session.messages = snapshot.messages.map(({id, role, text, omitHistory, steps}) => ({id, role, text, omitHistory, steps: steps || []}));
  session.conversationSummary = snapshot.summary;
  session.summarizedIds = new Set(snapshot.summarizedIds);
  session.compactedMessages = snapshot.compactedMessages;
  session.permissionMode = 'confirm';
  session.agentRole = null;
  session.useRoleSkills = false;
  session.roleGeneration = (session.roleGeneration || 0) + 1;
  session.projectTools = false;
  session.revision++;
  const archive = aiArchive(session);
  Object.assign(archive, {id:snapshot.id, title:snapshot.title, revision:record.revision, auto:!record.receiptWarning, error:record.receiptWarning || '', failedWrite:'', dismissed:''});
  archive.saved = JSON.stringify(aiArchiveSnapshot(session));
}

async function resumeAiProject(session) {
  if (session.resumeChecked || session.messages.length) return;
  session.resumeChecked = true;
  session.restoring = true;
  try {
    const records = await invoke('agent_chat_list', {root:session.root});
    if (!records?.length) return;
    const record = await invoke('agent_chat_read', {root:session.root, id:records[0].id});
    if (aiSessions.get(session.key) === session && !session.messages.length) loadProjectRecord(session, record);
  } catch (error) {
    toast(projectText('读取项目对话失败：', 'Could not load conversation: ') + String(error), true);
  } finally {
    session.restoring = false;
    if (aiCurrentSession() === session) { aiPaintIdentity = ''; renderAiConversation(); updateAiComposer(); }
  }
}

function openAiProjects() {
  const dialog = document.createElement('dialog');
  dialog.className = 'file-settings-dialog project-dialog';
  const t = projectText, items = aiProjectList();
  dialog.innerHTML = `<header class="file-settings-head"><div><h2>${t('Agent 项目','Agent projects')}</h2><p>${t('项目有独立的记忆和对话。打开项目会继续最近一次对话。','Each project keeps its own memory and resumes its latest chat.')}</p></div></header>
    <div class="file-settings-body"><button class="ai-secondary" data-follow>${t('跟随当前标签目录','Follow current tab')}</button>
    ${aiInboxRoot ? `<button class="ai-secondary" data-project-inbox>${t('使用本地收件箱','Use local inbox')}</button>` : ''}
    <h3>${t('我的项目','My projects')}</h3>
    <div class="ai-project-list">${items.map((item, index) => `<button type="button" data-project="${index}" aria-current="${aiKey(item.root) === aiKey(aiProjectRoot)}"><strong>${esc(item.name)}</strong><small>${esc(item.root)}</small></button>`).join('') || esc(t('尚无项目','No projects yet'))}</div>
    <label for="newProjectName">${t('新项目名称','New project name')}</label><div class="project-create"><input id="newProjectName" maxlength="80" data-name>
    <button class="ai-secondary" data-create>${t('创建项目','Create project')}</button></div>
    <button class="ai-secondary" data-pick>${t('选择已有目录作为项目','Use an existing folder')}</button><p role="status"></p></div>
    <footer class="file-settings-footer"><button data-close>${t('关闭','Close')}</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
  dialog.onclick = async event => {
    const button = event.target.closest('button');
    if (!button || dialog.inert) return;
    if (button.hasAttribute('data-close')) { dialog.close(); return; }
    const original = aiCurrentSession();
    if (original?.running) { dialog.querySelector('[role=status]').textContent = aiText('modelBusy'); return; }
    dialog.inert = true;
    try {
      let root = '', name = '';
      if (button.hasAttribute('data-create')) {
        name = dialog.querySelector('[data-name]').value.trim();
        if (!name) throw Error(t('请输入项目名称','Enter a project name'));
        root = await invoke('agent_project_directory', {name});
      } else if (button.hasAttribute('data-pick')) {
        root = await invoke('agent_pick_project');
        if (!root) return;
        name = basename(root) || root;
      } else if (button.hasAttribute('data-project-inbox')) {
        root = aiInboxRoot;
        name = basename(root) || root;
      } else if (button.hasAttribute('data-project')) {
        ({root, name} = items[Number(button.dataset.project)]);
      }
      if (!dialog.open || aiCurrentSession() !== original || original?.running) return;
      if (original && aiSessionNeedsExitWork(original) && !await prepareAiSessionForExit(original, () => dialog.open && aiCurrentSession() === original)) return;
      if (!dialog.open || aiCurrentSession() !== original || original?.running || original?.requestId) return;
      if (root) store.set('aiProjects', [{name, root}, ...items.filter(item => aiKey(item.root) !== aiKey(root))]);
      aiProjectRoot = root;
      store.set('aiActiveProject', root);
      syncAiWorkspace();
      dialog.close();
    } catch (error) { dialog.querySelector('[role=status]').textContent = String(error); }
    finally { clearAiArchiveDismissal(original); dialog.inert = false; }
  };
  dialog.showModal();
}

async function openReplyDocument(messageId) {
  const session = aiCurrentSession();
  const message = session?.messages.find(item => item.id === messageId && item.role === 'assistant');
  if (!message || session.running || session.permissionMode === 'read-only') return;
  const t = projectText;
  const dialog = document.createElement('dialog');
  dialog.className = 'file-settings-dialog ai-save-document';
  dialog.setAttribute('aria-labelledby', 'aiSaveDocumentTitle');
  dialog.innerHTML = `<form><header class="file-settings-head"><h2 id="aiSaveDocumentTitle">${t('存为项目文档','Save reply to project')}</h2></header>
    <div class="file-settings-body"><small>${t('项目目录','Project folder')}</small><code data-root></code>
    <label>${t('新文件名（.md 或 .txt）','New filename (.md or .txt)')}<input required data-name></label>
    <label>${t('文档正文，可在保存前修改','Document text, editable before saving')}<textarea data-content rows="10" spellcheck="false"></textarea></label>
    <p role="status" aria-live="polite"></p></div>
    <footer class="file-settings-footer"><button type="button" data-cancel>${t('取消','Cancel')}</button>
    <button class="file-settings-primary" type="submit">${t('保存文档','Save document')}</button></footer></form>`;
  const form = dialog.querySelector('form');
  const name = form.querySelector('[data-name]'), content = form.querySelector('[data-content]');
  form.querySelector('[data-root]').textContent = session.root;
  name.value = `Agent-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.md`;
  content.value = message.text;
  form.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.oncancel = event => { if (form.inert) event.preventDefault(); };
  dialog.onclose = () => dialog.remove();
  form.onsubmit = async event => {
    event.preventDefault();
    if (form.inert) return;
    if (aiCurrentSession() !== session || session.permissionMode === 'read-only') {
      form.querySelector('[role=status]').textContent = t('项目或权限已变化，请重新打开。','Project or permissions changed. Reopen this dialog.');
      return;
    }
    if (aiAnyExecution()) {
      form.querySelector('[role=status]').textContent = t('请等待当前文件操作完成。','Wait for the current file operation to finish.');
      return;
    }
    form.inert = true; session.running = true; updateAiComposer();
    try {
      const receipt = await invoke('ai_save_reply', {root:session.root, target:name.value.trim(), content:content.value, permissionMode:session.permissionMode, withReceipt:true});
      const outcome = reportDocumentReceipt(session,receipt,t('文档已保存至 ', 'Document saved to ') + receipt.target);
      if (receipt.error) { form.querySelector('[role=status]').textContent = outcome; return; }
      dialog.close();
      if (aiCurrentSession() === session) toast(outcome,!!receipt.journalWarning);
    } catch (error) {
      form.querySelector('[role=status]').textContent = String(error);
    } finally {
      form.inert = false; session.running = false; session.revision++;
      renderAiConversation(); updateAiComposer();
    }
  };
  document.body.append(dialog); dialog.showModal(); name.focus(); name.select();
}

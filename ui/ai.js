/* Each tab owns its conversation and permissions; memories live in its current folder. */
const AI_TEXT = {
  zh: {
    title: 'Agent 助手', projects: '切换项目', streamLabel: '普通对话逐段显示回复', streamHint: '接口不支持流式输出时可关闭。', projectTools: '项目工具（允许模型读取项目文本）', caption: '对话 · 项目 · 记忆', close: '收起对话', settings: '接口设置', newChat: '新对话',
    float: '浮动对话', dock: '停靠到最右侧', remember: '存入记忆', memoryReview: '建议记住 · 待你确认', memorySave: '编辑并保存', memoryIgnore: '忽略', memorySaved: '已保存到记忆', memorySaving: '正在编辑…', memoryUsed: '已使用 {n} 条记忆', skillsUsed: '技能', contextPartial: '部分技能或记忆超出上下文上限',
    apiFormat: 'API 格式', formatHint: '选择服务实际支持的格式；可填基础地址或对应的完整请求地址。Anthropic 使用服务默认思考设置。', formatInvalid: 'API 格式无效，或完整地址与格式不匹配。', testApi: '测试 API', testRunning: '正在测试…', testCancel: '取消测试', testHint: '用当前表单发送一条简短测试消息，可能产生少量费用；不会发送文件、目录或聊天记录，也不会保存配置。', testSuccess: '测试成功 · 已收到有效文本回复', testFailed: '测试失败',
    endpoint: 'API 地址', model: '模型名称', key: 'API Key', rememberKey: '在本机记住密钥', forgetKey: '清除此接口的已存密钥', save: '保存并返回', back: '返回对话',
    dialect: '推理参数协议', generic: '通用兼容（不发送推理参数）', reasoning: '思考强度', reasoningDefault: '服务默认', reasoningNone: '关闭思考', reasoningMinimal: '极低', reasoningLow: '低', reasoningMedium: '中', reasoningHigh: '高', reasoningXhigh: '极高', reasoningMax: '最高', reasoningHint: '强度越高可能耗时更长、消耗更多 Token。可用等级由具体模型决定；报不支持时请选择服务默认或通用兼容。', reasoningInvalid: '此接口模式不支持所选思考强度。', preset: '切换已保存模型', currentModel: '当前模型', modelSettings: '配置其他模型…', modelBusy: '请等待当前文件操作完成。',
    settingsShort: '设置', settingsDescription: '配置你使用的模型服务，对所有文件夹生效。', connection: '连接模型', credentials: '访问凭据',
    optional: '可选', cancelSettings: '取消', savedState: '当前设置已保存', unsaved: '有未保存的更改', initialSettings: '填写接口地址和模型名称后保存',
    endpointRequired: '请输入 API 地址。', endpointInvalid: '请输入完整的网址，例如 https://api.example.com/v1。',
    endpointSecure: '远程接口需使用 HTTPS；HTTP 仅支持 localhost、127.0.0.1 或 ::1。', endpointParts: '地址不能包含用户名、密码、查询参数或 # 片段。',
    endpointLong: '接口地址过长，请使用 2048 字节以内的地址。', modelRequired: '请输入服务商提供的模型名称。', modelLong: '模型名称需在 256 字节以内。', keyInvalid: '密钥不能包含换行，且需在 4096 字节以内。',
    modelHint: '使用服务商列出的模型 ID，或本地已安装的模型名称。', keyOptionalHint: '服务需要认证时填写；本地免认证服务可以留空。',
    requestAddress: '请求将发送到', showKey: '显示密钥', hideKey: '隐藏密钥', sharing: '发送内容与操作范围', settingsFooter: '取消或按 Esc 不会保存修改。', invalidSettings: '请修正标出的设置后保存。',
    keyHint: '勾选记住后，密钥由当前 Windows 用户的凭据管理器保存。留空沿用此接口的已存密钥。', endpointHint: '远程使用 HTTPS，本机可使用 HTTP；下方显示实际请求地址。',
    privacy: '通用对话发送消息、对话上下文和已启用的技能与记忆。开启项目工具后，模型可获取目录元数据并按需读取项目内的小型 UTF-8 文本。',
    support: '支持问答、新建文件夹和 Markdown/文本文档、移动、重命名、复制文件；不执行删除、文件夹复制或终端命令。',
    following: '当前标签页目录', terminal: '当前终端启动目录', permissions: '本标签页权限', readOnly: '只读', confirmMode: '确认后执行', autoMode: '自动执行（当前目录）',
    readOnlyHint: 'AI 仅分析和回答，不执行文件操作。', confirmHint: '每份文件操作计划经你核对确认后执行。', autoHint: '发送后可自动创建目录和文档、移动、重命名和复制；修改已有文档时先审阅。', modeChanged: '权限已更新，之前的待执行计划已失效。', memoryLocation: '目录记忆文件',
    noFolder: '选择本地任务目标', noFolderHint: '打开本地目录，或在「项目」中选择固定项目或本地收件箱。', remoteFolder: '远程 SSH 终端', remoteHint: '当前 Agent 未连接此主机。要继续本地任务，请在「项目」中选择本地目标。',
    welcome: '今天想一起完成什么？', welcomeHint: '可以直接讨论问题、写作或开发。需要读取项目文件时，切换到项目工具。',
    example1: '帮我把一个想法写成可执行计划', example2: '帮我设计一个小程序', example3: '帮我润色一段文字',
    prompt: '描述你的问题或任务…', send: '发送', sending: '正在思考…', cancel: '停止',
    hint: 'Enter 发送 · Shift+Enter 换行', memory: '对话保留在本次运行中', selection: '本轮选中项', ignore: '忽略选择', include: '加入选择',
    you: '你', assistant: 'Agent', notice: '工作记录', configure: '先配置模型接口', missing: '请填写接口地址和模型名称。',
    configured: '接口设置已保存。', noModel: '未配置模型', cancelled: '本轮已停止；迟到回复不会成为可执行计划。',
    review: '待确认操作', confirmation: '我已核对路径与操作内容', execute: '确认执行', discard: '放弃计划',
    executing: '正在执行…', done: '操作已完成', partial: '部分操作失败，后续步骤已停止；已完成步骤不会自动回滚。',
    superseded: '旧计划已失效，请查看最新回复。', expired: '计划已过期，未执行。需要时请重新生成。', discarded: '此计划未执行或未全部完成。',
    source: '源路径', target: '目标路径', mkdir: '新建文件夹', move: '移动', rename: '重命名', copy: '复制文件', create_text: '新建文档', edit_text: '修改文档', saveReply: '存为项目文档', documentPreview: '将写入的完整正文',
    success: '已完成', failed: '失败', skipped: '未执行', context: '基于 {n} 条目录信息', truncated: '目录信息超过上限，仅包含部分项目。',
    invalidScope: '回复的工作目录与当前会话不符，已丢弃此计划。', resize: '调整对话面板宽度',
  },
  en: {
    title: 'Agent assistant', projects: 'Projects', streamLabel: 'Stream chat replies', streamHint: 'Turn this off for endpoints that reject streaming.', projectTools: 'Project tools (allow reading project text)', caption: 'Chat · Projects · Memory', close: 'Hide chat', settings: 'API settings', newChat: 'New chat',
    float: 'Float chat', dock: 'Dock on the right', remember: 'Save to memory', memoryReview: 'Suggested memory · Review first', memorySave: 'Edit and save', memoryIgnore: 'Dismiss', memorySaved: 'Saved to memory', memorySaving: 'Editing…', memoryUsed: '{n} memories used', skillsUsed: 'Skills', contextPartial: 'Some skills or memories exceeded the context limit',
    apiFormat: 'API format', formatHint: 'Match the service protocol. Enter a base URL or a complete request URL. Anthropic uses service-default reasoning.', formatInvalid: 'Invalid API format or mismatched endpoint.', testApi: 'Test API', testRunning: 'Testing…', testCancel: 'Cancel test', testHint: 'Send a short message using this form; a small charge may apply. No files, folders or chat history are sent, and settings are not saved.', testSuccess: 'Test passed · Received a valid text reply', testFailed: 'Test failed',
    endpoint: 'API endpoint', model: 'Model', key: 'API key', rememberKey: 'Remember key on this PC', forgetKey: 'Forget saved key for this endpoint', save: 'Save and return', back: 'Back to chat',
    dialect: 'Reasoning protocol', generic: 'Generic (omit reasoning parameters)', reasoning: 'Thinking effort', reasoningDefault: 'Service default', reasoningNone: 'Off', reasoningMinimal: 'Minimal', reasoningLow: 'Low', reasoningMedium: 'Medium', reasoningHigh: 'High', reasoningXhigh: 'Extra high', reasoningMax: 'Maximum', reasoningHint: 'Higher effort may take longer and use more tokens. Supported levels depend on the model; use Service default or Generic if your service rejects a level.', reasoningInvalid: 'This protocol does not support the selected effort.', preset: 'Switch saved model', currentModel: 'Current model', modelSettings: 'Configure another model…', modelBusy: 'Wait for the current file operation to finish.',
    settingsShort: 'Settings', settingsDescription: 'Configure your model service. These settings apply to every folder.', connection: 'Model connection', credentials: 'Credentials',
    optional: 'Optional', cancelSettings: 'Cancel', savedState: 'Current settings are saved', unsaved: 'Unsaved changes', initialSettings: 'Enter an endpoint and model, then save',
    endpointRequired: 'Enter an API endpoint.', endpointInvalid: 'Enter a full URL, such as https://api.example.com/v1.',
    endpointSecure: 'Remote endpoints require HTTPS. HTTP is allowed only for localhost, 127.0.0.1 or ::1.', endpointParts: 'Do not include credentials, query parameters or a # fragment in the URL.',
    endpointLong: 'Keep the endpoint within 2048 bytes.', modelRequired: 'Enter the model name supplied by your service.', modelLong: 'Keep the model name within 256 bytes.', keyInvalid: 'The key must have no line breaks and be at most 4096 bytes.',
    modelHint: 'Use the model ID listed by your provider, or the name of an installed local model.', keyOptionalHint: 'Required when your service uses authentication; leave blank for a local service without authentication.',
    requestAddress: 'Requests will be sent to', showKey: 'Show key', hideKey: 'Hide key', sharing: 'Shared context and available actions', settingsFooter: 'Cancel or press Esc to discard changes.', invalidSettings: 'Correct the highlighted settings before saving.',
    keyHint: 'Remembered keys use Windows Credential Manager. Leave blank to reuse the key saved for this endpoint.', endpointHint: 'HTTPS required except for localhost. The resolved request URL appears below.',
    privacy: 'Chat shares messages, context, enabled skills and memory. Project tools also share directory metadata and can read small UTF-8 files within the project.',
    support: 'Ask questions, create folders or Markdown/text documents, move, rename or copy files. No deletion, folder copying or terminal commands.',
    following: 'Current tab folder', terminal: 'Current terminal starting folder', permissions: 'Permissions for this tab', readOnly: 'Read-only', confirmMode: 'Ask before changes', autoMode: 'Auto in this folder',
    readOnlyHint: 'The AI can analyze and answer, but cannot run file operations.', confirmHint: 'Review and confirm each file operation plan before it runs.', autoHint: 'Sending may create folders or documents, move, rename or copy within this folder. No overwrite or deletion.', modeChanged: 'Permissions updated. Previous pending plans have expired.', memoryLocation: 'Folder memory file',
    noFolder: 'Choose a local task target', noFolderHint: 'Open a local folder, or use Projects to pin a project or the local inbox.', remoteFolder: 'Remote SSH terminal', remoteHint: 'The agent is not connected to this host. To continue a local task, choose its target in Projects.',
    welcome: 'What would you like to work on?', welcomeHint: 'Ask a question, draft something, or plan a project. Enable project tools to work with local files.',
    example1: 'Help me turn an idea into a plan', example2: 'Help me design a small application', example3: 'Help me edit a draft',
    prompt: 'Ask a question or describe a task…', send: 'Send', sending: 'Thinking…', cancel: 'Stop',
    hint: 'Enter to send · Shift+Enter for a new line', memory: 'Chats stay in this app session', selection: 'Selected for this message', ignore: 'Ignore selection', include: 'Include selection',
    you: 'You', assistant: 'Agent', notice: 'Activity', configure: 'Configure a model first', missing: 'Enter an API endpoint and model.',
    configured: 'API settings saved.', noModel: 'No model configured', cancelled: 'Stopped. A late response cannot become an executable plan.',
    review: 'Review operations', confirmation: 'I reviewed the paths and proposed changes', execute: 'Confirm and run', discard: 'Discard plan',
    executing: 'Running…', done: 'Operations completed', partial: 'An action failed. Later actions stopped; completed steps were not rolled back.',
    superseded: 'This plan was superseded. Review the latest reply.', expired: 'This plan expired without running. Request a new plan if needed.', discarded: 'This plan was not fully executed.',
    source: 'Source', target: 'Target', mkdir: 'Create folder', move: 'Move', rename: 'Rename', copy: 'Copy file', create_text: 'Create document', edit_text: 'Edit document', saveReply: 'Save to project', documentPreview: 'Full document to write',
    success: 'Completed', failed: 'Failed', skipped: 'Skipped', context: 'Based on {n} directory entries', truncated: 'Only part of the directory was included.',
    invalidScope: 'The reply used a different working folder. Its plan was discarded.', resize: 'Resize chat panel',
  },
};
function aiText(key) { return AI_TEXT[locale === 'en' ? 'en' : 'zh'][key] || key; }
const aiSessions = new Map();
let aiPanel = null, aiCurrentKey = null;
let aiPanelOpen = store.get('aiPanelOpen', true) !== false;
let aiSettings = store.get('aiSettings', {}) || {}, aiSessionKey = '';
let aiModelPresets = store.get('aiModelPresets', []);
if (!Array.isArray(aiModelPresets)) aiModelPresets = [];
aiModelPresets = aiModelPresets.filter((p) => p && typeof p.endpoint === 'string' && typeof p.model === 'string').slice(0, 12).map(aiPublicSettings);
let aiTestRun = null;
let aiStreamReplies = store.get('aiStreamReplies', true) !== false;
let aiProjectRoot = store.get('aiActiveProject', '') || '', aiInboxRoot = '';
function aiProjectScope(root) { return !!root && (!!aiProjectRoot || aiKey(root) === aiKey(aiInboxRoot)); }
function aiFormatOf(value) { return value.apiFormat || 'openai-completions'; }
function aiFormatSuffix(format) { return { 'openai-completions': '/chat/completions', 'openai-responses': '/responses', 'anthropic-messages': '/messages' }[format]; }
function aiDialectAllowed(format, dialect) { return format === 'anthropic-messages' ? !dialect || dialect === 'generic' : format === 'openai-responses' ? dialect !== 'deepseek' : true; }
let aiSettingsOpen = false, aiSettingsValidated = false, aiPaintIdentity = '', aiResize = null;
const aiKey = (path) => (path || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const aiChars = (text, max) => Array.from(String(text)).slice(0, max).join('');
function aiCurrentSession() { return aiSessions.get(aiCurrentKey) || null; }
function aiTabId(tab = curTab()) { return tab ? (tab.aiSessionId ||= crypto.randomUUID()) : ''; }
function aiSessionKeyFor(root, tab = curTab()) { return root ? (aiProjectScope(root) ? 'project' : aiTabId(tab)) + '::' + aiKey(root) : ''; }
function aiTabIsActive(session) { return !!session && aiSessionKeyFor(aiBrowsingFolder()) === session.key; }
function aiAutoTab(session) {
  const tab = curTab();
  if (!session || !tab || tab.kind === 'browser' || tab.connection === 'ssh') return null;
  const folder = isTermTab(tab) ? tab.cwd : state.path;
  return folder && aiKey(folder) === aiKey(session.root) ? tab : null;
}
// A pinned conversation follows the user; its permission to write without review does not.
function syncPinnedAuto(session) {
  if (!session || session.tab || session.permissionMode !== 'auto' ||
      (session.autoTab && session.autoTab === aiAutoTab(session) && aiTabIsActive(session))) return;
  session.autoTab = null; session.permissionMode = 'confirm'; session.activation++; session.revision++;
  if (typeof setHarnessEditMode === 'function') setHarnessEditMode(session.root, 'confirm');
}
function aiPlanModeMatches(session, plan, approved) {
  return plan.permissionMode === session.permissionMode ||
    (approved && plan.permissionMode === 'auto' && session.permissionMode === 'confirm');
}
function aiAnyExecution() { return [...aiSessions.values()].some((s) => s.running); }
function aiEfforts(dialect) {
  return dialect === 'openai' ? ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : dialect === 'deepseek' ? ['default', 'none', 'low', 'high', 'max'] : ['default'];
}
function aiEffortLabel(effort) { return aiText('reasoning' + (effort || 'default').replace(/^./, (c) => c.toUpperCase())); }
function aiEffortOptions(dialect) { return aiEfforts(dialect).map((effort) => `<option value="${effort}">${esc(aiEffortLabel(effort))}</option>`).join(''); }
function aiPublicSettings(value) {
  const settings = { endpoint: String(value.endpoint || '').trim(), model: String(value.model || '').trim() };
  if (['openai-responses', 'anthropic-messages'].includes(value.apiFormat)) settings.apiFormat = value.apiFormat;
  if (['openai', 'deepseek'].includes(value.apiDialect) && aiDialectAllowed(aiFormatOf(value), value.apiDialect)) {
    settings.apiDialect = value.apiDialect;
    if (value.reasoningEffort && value.reasoningEffort !== 'default') settings.reasoningEffort = value.reasoningEffort;
  }
  return settings;
}
function refreshAiEffortField() {
  const format = $('aiApiFormat').value || 'openai-completions';
  for (const option of $('aiApiDialect').options || []) option.disabled = !aiDialectAllowed(format, option.value);
  if (!aiDialectAllowed(format, $('aiApiDialect').value)) $('aiApiDialect').value = 'generic';
  const select = $('aiReasoningEffort'), previous = select.value || 'default', dialect = $('aiApiDialect').value;
  select.innerHTML = aiEffortOptions(dialect); select.value = aiEfforts(dialect).includes(previous) ? previous : 'default';
  select.disabled = dialect === 'generic';
}
function applyAiRuntimeSettings(settings, key, remember = false) {
  const next = aiPublicSettings(settings);
  const sameProvider = next.endpoint === aiSettings.endpoint && aiFormatOf(next) === aiFormatOf(aiSettings);
  aiSessionKey = key ?? (sameProvider ? aiSessionKey : '');
  aiSettings = next; store.set('aiSettings', next);
  if (remember) {
    aiModelPresets = [next, ...aiModelPresets.filter((p) => p && !(p.endpoint === next.endpoint && aiFormatOf(p) === aiFormatOf(next) && p.model === next.model)).map(aiPublicSettings)].slice(0, 12);
    store.set('aiModelPresets', aiModelPresets);
  }
  aiPaintIdentity = ''; renderAiConversation(); updateAiComposer();
  return true;
}
function changeAiQuickEffort(effort) {
  if (!aiEfforts(aiSettings.apiDialect).includes(effort)) return false;
  return applyAiRuntimeSettings({ ...aiSettings, reasoningEffort: effort });
}
function changeAiModelPreset(index) {
  if (index === 'settings') { toggleAiSettings(true); updateAiComposer(); return; }
  const preset = aiModelPresets[Number(index)];
  if (!preset) return false;
  return applyAiRuntimeSettings(preset);
}
function aiBrowsingFolder() {
  if (aiProjectRoot) return aiProjectRoot;
  if (curTab()?.connection === 'ssh' || curTab()?.kind === 'browser') return null;
  const path = isTermTab(curTab()) ? curTab().cwd : state.path;
  return path && /^[a-z]:[\\/]/i.test(path) ? path : null;
}
function canReleaseAiSession(session) {
  if (session.draft || session.editReference || session.permissionMode === 'read-only' || session.useRoleSkills ||
      (session.agentRole && session.agentRole.id !== 'general') ||
      session.requestId || session.running || session.restoring || session.compacting ||
      session.archive?.error || session.archive?.saving) return false;
  if (session.messages.some(m => m.planState === 'pending' || m.memoryEditing ||
      m.memorySuggestions?.some(s => s.status === 'pending') ||
      (!m.undone && m.results?.some(r => r.kind === 'edit_text' && r.status === 'success')))) return false;
  return !session.messages.length ||
    (typeof aiArchiveHasUnsavedText === 'function' && !aiArchiveHasUnsavedText(session));
}
function aiSessionFor(root) {
  if (!root) return null;
  const key = aiSessionKeyFor(root);
  let session = aiSessions.get(key);
  if (!session) {
    session = { key, root, tab: aiProjectScope(root) ? null : curTab(), permissionMode: 'confirm', activation: 0, messages: [], draft: '', requestId: null, running: false, revision: 0, includeSelection: true };
    if (typeof aiArchive === 'function') aiArchive(session).auto = true;
    aiSessions.set(key, session);
  } else { aiSessions.delete(key); aiSessions.set(key, session); }
  // Map iteration is least-recently-used first. Navigation must never save a draft
  // or discard a live plan just to make space for the next folder.
  for (const candidate of aiSessions.values()) {
    if (aiSessions.size <= 24) break;
    if (candidate === session || !canReleaseAiSession(candidate)) continue;
    if (candidate.archive?.timer != null) clearTimeout(candidate.archive.timer);
    aiSessions.delete(candidate.key);
  }
  return session;
}
function disposeAiTab(tab) {
  for (const session of aiSessions.values()) {
    if (session.tab !== tab) continue;
    session.closed = true; session.activation++;
    cancelAiRequest(session, false); discardSessionPlans(session);
    if (typeof retireAiArchive === 'function') retireAiArchive(session);
    if (!session.running) aiSessions.delete(session.key);
  }
}
function setAiPermissionMode(mode) {
  const session = aiCurrentSession();
  if (!session || session.running || !['read-only', 'confirm', 'auto'].includes(mode) || session.permissionMode === mode) return;
  if (session.agentRole && session.agentRole.access !== 'standard' && mode !== 'read-only') return;
  if (mode === 'auto' && !aiAutoTab(session)) { updateAiComposer(); return; }
  cancelAiRequest(session, false); discardSessionPlans(session);
  session.autoTab = mode === 'auto' ? curTab() : null;
  session.permissionMode = mode; session.activation++; session.revision++;
  if (typeof setHarnessEditMode === 'function') setHarnessEditMode(session.root,mode);
  renderAiConversation(); updateAiComposer();
  if (typeof toast === 'function') toast(aiText('modeChanged'));
}
function addAiMessage(session, role, text, extra = {}) {
  const message = { id: crypto.randomUUID(), role, text, ...extra };
  session.messages.push(message);
  if (session.messages.length > 60) session.messages.splice(0, session.messages.length - 60);
  if (session.summarizedIds) { const ids = new Set(session.messages.map((item) => item.id)); session.summarizedIds = new Set([...session.summarizedIds].filter((id) => ids.has(id))); }
  session.revision++;
  if (typeof scheduleAiArchive === 'function') scheduleAiArchive(session);
  return message;
}
function discardSessionPlans(session, status = 'superseded', roleChanged = false) {
  for (const message of session.messages) {
    if (message.plan && message.planState === 'pending') {
      clearAiPlanTimer(message);
      invoke('ai_discard', { id: message.plan.id }).catch(() => {});
      message.planState = status; message.roleChanged = roleChanged; session.revision++;
    }
  }
  if (typeof scheduleAiArchive === 'function') scheduleAiArchive(session);
}
function clearAiPlanTimer(message) {
  if (message.expiryTimer != null) clearTimeout(message.expiryTimer);
  message.expiryTimer = null;
}
function expireAiPlan(session, message) {
  if (message.planState !== 'pending' || message.planDeadline == null || performance.now() < message.planDeadline) return false;
  clearAiPlanTimer(message);
  message.planState = 'expired'; session.revision++;
  invoke('ai_discard', {id:message.plan.id}).catch(() => {});
  if (typeof scheduleAiArchive === 'function') scheduleAiArchive(session);
  if (aiCurrentSession() === session) renderAiConversation();
  return true;
}
function watchAiPlanExpiry(session, message) {
  const ms = message.plan?.validForMs;
  if (!Number.isSafeInteger(ms) || ms <= 0) return;
  message.planDeadline = performance.now() + ms;
  const check = () => {
    if (message.planState !== 'pending') return;
    if (!expireAiPlan(session, message)) message.expiryTimer = setTimeout(check, Math.ceil(message.planDeadline - performance.now()));
  };
  message.expiryTimer = setTimeout(check, ms);
}
function aiHistory(session) {
  if (typeof aiMemoryHistory === 'function') return aiMemoryHistory(session);
  const history = [];
  let length = 0;
  for (const message of [...session.messages].reverse()) {
    if (message.omitHistory || !message.text) continue;
    let content = message.text;
    if (message.plan) content += '\n[Plan status: ' + message.planState + '; a proposed plan is not proof of execution.]\n' + JSON.stringify(message.plan.actions, (field, value) => field === 'content' || field === 'original' ? undefined : value);
    if (message.results) content += '\n[Local execution results]\n' + JSON.stringify(message.results);
    const item = { role: message.role === 'assistant' ? 'assistant' : 'user', content: aiChars(content, Math.min(8000, 24000 - length)) };
    if (!item.content) break;
    history.unshift(item); length += Array.from(item.content).length;
    if (history.length >= 16 || length >= 24000) break;
  }
  return history;
}
function aiComposerSelection(session) {
  const empty = {paths: [], included: false, subfolderKey: null};
  if (!session || !aiTabIsActive(session)) return empty;
  if (session.editReference) return {paths: [session.editReference], included: session.includeSelection, subfolderKey: null};
  if (isTermTab(curTab()) || curTab()?.kind === 'browser' || !state.path || state.loading || state.error) return empty;
  const current = aiKey(state.path), root = aiKey(session.root);
  if (current !== root && !current.startsWith(root + '\\')) return empty;
  const base = state.path.replace(/\//g, '\\').replace(/\\+$/, '');
  const prefix = current === root ? '' : base.slice(root.length + 1) + '\\';
  const paths = (state.entries || []).filter((entry) => state.selection.has(entry.name) && !entry.isReparse).slice(0, 20).map((entry) => prefix + entry.name);
  // Re-enumerating the same selection can change entry order without changing what the user attached.
  const subfolderKey = prefix && paths.length ? JSON.stringify([aiTabId(), base, paths.slice().sort()]) : null;
  return {paths, subfolderKey, included: subfolderKey ? session.subfolderSelection === subfolderKey : session.includeSelection};
}
function aiSelectedPaths(session) {
  const {paths, included} = aiComposerSelection(session);
  return included ? paths : [];
}

function initAiAssistant() {
  if (aiPanel) return;
  aiPanel = document.createElement('aside'); aiPanel.id = 'aiPanel';
  aiPanel.setAttribute('aria-label', aiText('title'));
  aiPanel.innerHTML = `<div class="ai-resize-handle" tabindex="0" role="separator" aria-orientation="vertical" data-ai-resize></div>
    <header class="ai-chat-header"><div class="ai-chat-brand"><span class="ai-mark">✦</span><div><strong data-ai-text="title"></strong><small id="aiPanelStatus" data-ai-text="caption"></small></div></div><div class="ai-header-actions"><button class="ibtn" data-ai-action="new" data-ai-title="newChat">${IC.plus}</button><button class="ibtn ai-settings-entry" data-ai-action="settings" data-ai-title="settings" aria-haspopup="dialog" aria-controls="aiSettingsPanel"><span aria-hidden="true">⚙</span><span data-ai-text="settingsShort"></span></button><button class="ibtn" data-ai-action="float" data-ai-title="float" aria-pressed="false">⤢</button><button class="ibtn" data-ai-action="close" data-ai-title="close">${IC.x}</button></div></header>
    <section class="ai-folder-context">${IC.folderS}<div class="ai-folder-copy"><span id="aiScopeMode"></span><strong id="aiFolderName"></strong><small id="aiFolderPath"></small><small id="aiMemoryPath"></small><small id="aiReferenceStatus" hidden></small></div><button class="ai-secondary" type="button" id="aiProjectsButton" data-ai-text="projects">项目</button></section>
    <section id="aiContextRow"><div id="aiRoleBar" hidden><select id="aiRoleSelect"></select><details><summary></summary><div class="ai-role-details"><p data-role-description></p><label><input type="checkbox" id="aiRoleSkills"><span data-role-toggle-label></span></label><p data-role-effective></p><p data-role-pending></p></div></details></div><div id="aiAgentContext" class="ai-agent-context" aria-live="polite"></div></section>
    <dialog id="aiSettingsPanel" class="ai-settings-dialog" aria-labelledby="aiSettingsTitle" aria-describedby="aiSettingsDescription">
      <header class="ai-settings-heading"><div><h2 id="aiSettingsTitle" data-ai-text="settings"></h2><p id="aiSettingsDescription" data-ai-text="settingsDescription"></p></div><button type="button" class="ibtn" data-ai-action="cancel-settings" data-ai-title="cancelSettings">${IC.x}</button></header>
      <form id="aiSettingsForm" novalidate>
        <div class="ai-settings-body">
          <section class="ai-settings-group"><h3><span>01</span><span data-ai-text="connection"></span></h3>
            <label for="aiApiFormat" data-ai-text="apiFormat"></label><select id="aiApiFormat" aria-describedby="aiFormatHint aiApiFormatError"><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select><small id="aiFormatHint" data-ai-text="formatHint"></small><p id="aiApiFormatError" class="ai-field-error" hidden></p>
            <label for="aiEndpoint" data-ai-text="endpoint"></label><input id="aiEndpoint" type="url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1" aria-describedby="aiEndpointHint aiEndpointError" required><small id="aiEndpointHint" data-ai-text="endpointHint"></small><p id="aiEndpointError" class="ai-field-error" hidden></p><div id="aiRequestAddress" class="ai-request-address" hidden><span data-ai-text="requestAddress"></span><code id="aiRequestUrl"></code></div>
            <label for="aiModel" data-ai-text="model"></label><input id="aiModel" autocomplete="off" spellcheck="false" placeholder="model-name" aria-describedby="aiModelHint aiModelError" required><small id="aiModelHint" data-ai-text="modelHint"></small><p id="aiModelError" class="ai-field-error" hidden></p>
            <label for="aiApiDialect" data-ai-text="dialect"></label><select id="aiApiDialect"><option value="generic" data-ai-text="generic"></option><option value="openai">OpenAI / reasoning_effort</option><option value="deepseek">DeepSeek / thinking</option></select>
            <label for="aiReasoningEffort" data-ai-text="reasoning"></label><select id="aiReasoningEffort" aria-describedby="aiReasoningHint aiReasoningEffortError"></select><small id="aiReasoningHint" data-ai-text="reasoningHint"></small><p id="aiReasoningEffortError" class="ai-field-error" hidden></p>
            <label><input id="aiStreamReplies" type="checkbox" checked><span data-ai-text="streamLabel"></span></label><small data-ai-text="streamHint"></small>
          </section>
          <section class="ai-settings-group"><h3><span>02</span><span data-ai-text="credentials"></span></h3><label for="aiKey"><span data-ai-text="key"></span><span class="ai-optional" data-ai-text="optional"></span></label><div class="ai-key-field"><input id="aiKey" type="password" autocomplete="off" spellcheck="false" aria-describedby="aiKeyHint aiKeyError"><button type="button" class="ai-link" data-ai-action="show-key" aria-pressed="false" data-ai-text="showKey"></button></div><small data-ai-text="keyOptionalHint"></small><label><input id="aiRememberKey" type="checkbox" checked> <span data-ai-text="rememberKey"></span></label><button type="button" class="ai-link" id="aiForgetKey" data-ai-text="forgetKey"></button><small id="aiKeyHint" class="ai-key-hint" data-ai-text="keyHint"></small><p id="aiKeyError" class="ai-field-error" hidden></p></section>
          <section class="ai-settings-group ai-api-test"><button type="button" class="ai-secondary" data-ai-action="test-api" data-ai-text="testApi"></button><button type="button" class="ai-link" data-ai-action="cancel-test" data-ai-text="testCancel" hidden></button><small data-ai-text="testHint"></small><p id="aiApiTestStatus" role="status" aria-live="polite"></p></section>
          <details class="ai-settings-details"><summary data-ai-text="sharing"></summary><p data-ai-text="privacy"></p><p data-ai-text="support"></p></details>
        </div>
        <footer class="ai-settings-footer"><div><div id="aiSettingsStatus" role="status" aria-live="polite"></div><small data-ai-text="settingsFooter"></small></div><div class="ai-settings-actions"><button type="button" class="ai-secondary" data-ai-action="cancel-settings" data-ai-text="cancelSettings"></button><button type="submit" class="ai-primary" data-ai-action="save-settings" data-ai-text="save"></button></div></footer>
      </form>
    </dialog>
    <div id="aiMessages" class="ai-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
    <footer class="ai-composer"><div id="aiContextMeter" class="ai-context-meter"></div><div id="aiSelectionContext" class="ai-selection-context"></div><textarea id="aiPrompt" maxlength="4000" rows="2"></textarea><div class="ai-permissions"><label><input id="aiProjectTools" type="checkbox"> <span data-ai-text="projectTools"></span></label><label for="aiPermissionMode" data-ai-text="permissions"></label><select id="aiPermissionMode" aria-describedby="aiPermissionHint"><option value="read-only" data-ai-text="readOnly"></option><option value="confirm" data-ai-text="confirmMode"></option><option value="auto" data-ai-text="autoMode"></option></select><small id="aiPermissionHint"></small></div><div class="ai-composer-toolbar"><span id="aiModelLabel"></span><button class="ai-secondary hidden" data-ai-action="cancel" data-ai-text="cancel"></button><button class="ai-primary" data-ai-action="send" data-ai-text="send"></button></div><small class="ai-composer-note" id="aiComposerNote"></small></footer>`;
  $('agentDock').appendChild(aiPanel);
  if (typeof initAiArchives === 'function') initAiArchives();
  initAiProjects();
  initHarnessTasks();
  listen('ai-text-delta', ({payload}) => onAiTextDelta(payload)).catch(() => {});
  listen('ai-file-progress', ({payload}) => onAiFileProgress(payload), {target:'main'}).catch(() => {});
  $('aiStreamReplies').onchange = updateAiSettingsForm;
  listen('ai-tool-progress', ({payload}) => {
    const owner = [...aiSessions.values()].find(s => s.requestId && s.requestId === payload.requestId);
    if (!owner || !Number.isInteger(payload.index) || payload.index < 0 || payload.index >= 4 || !payload.step) return;
    const step = payload.step;
    if (owner.toolSteps[payload.index] && owner.toolSteps[payload.index].status !== 'unconfirmed') return;
    owner.toolSteps[payload.index] = step;
    owner.activity = step.status === 'unconfirmed' ? aiStepKind(step.kind) + '　' + step.path : projectText('正在整理工具结果','Processing tool results');
    owner.revision++;
    if (aiCurrentSession() === owner) renderAiConversation();
  }, {target: 'main'}).catch(() => {});
  $('aiProjectTools').onchange = (event) => {
    const session = aiCurrentSession();
    if (!session || session.running || session.agentRole?.access === 'advice') return;
    cancelAiRequest(session, false);
    discardSessionPlans(session);
    session.projectTools = event.target.checked;
    if (!session.projectTools) session.editReference = '';
    renderAiSelection();
    session.activation++;
    updateAiComposer();
  };
  $('aiForgetKey').onclick = async () => {
    const value = readAiSettingsForm();
    try {
      await invoke('ai_save_key', {endpoint:value.endpoint, apiFormat:value.apiFormat, key:''});
      if (value.endpoint === aiSettings.endpoint && value.apiFormat === aiFormatOf(aiSettings)) aiSessionKey = '';
      $('aiKey').value = ''; updateAiSettingsForm(); toast(locale === 'zh' ? '已清除保存的密钥' : 'Saved key removed');
    } catch (error) { toast(String(error), true); }
  };
  const runtimeControls = document.createElement('div'); runtimeControls.className = 'ai-runtime-controls';
  runtimeControls.innerHTML = '<select id="aiModelPreset"></select><select id="aiQuickEffort"></select>';
  aiPanel.querySelector('.ai-composer-toolbar').before(runtimeControls);
  $('aiApiFormat').addEventListener('change', () => { $('aiKey').value = ''; refreshAiEffortField(); updateAiSettingsForm(); });
  $('aiApiDialect').addEventListener('change', () => { refreshAiEffortField(); updateAiSettingsForm(); });
  $('aiReasoningEffort').addEventListener('change', updateAiSettingsForm);
  $('aiQuickEffort').addEventListener('change', (event) => changeAiQuickEffort(event.target.value));
  $('aiModelPreset').addEventListener('change', (event) => changeAiModelPreset(event.target.value));
  if (typeof initAgentLayout === 'function') initAgentLayout(aiPanel);
  if (typeof initAgentProfile === 'function') initAgentProfile();
  if (typeof initAgentRoles === 'function') initAgentRoles();
  $('btnAiAssistant')?.addEventListener('click', () => aiPanelOpen ? closeAiAssistant() : openAiAssistant());
  $('aiPermissionMode').addEventListener('change', (event) => setAiPermissionMode(event.target.value));
  $('aiEndpoint').value = aiSettings.endpoint || ''; $('aiModel').value = aiSettings.model || '';
  aiPanel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-action]');
    if (!button) return;
    const action = button.dataset.aiAction;
    if (action === 'close') closeAiAssistant();
    else if (action === 'float' && typeof toggleAgentFloating === 'function') toggleAgentFloating();
    else if (action === 'settings') toggleAiSettings();
    else if (action === 'cancel-settings') toggleAiSettings(false);
    else if (action === 'test-api') void testAiConnection();
    else if (action === 'cancel-test') resetAiConnectionTest();
    else if (action === 'show-key') { const visible = $('aiKey').type !== 'password'; $('aiKey').type = visible ? 'password' : 'text'; button.textContent = aiText(visible ? 'showKey' : 'hideKey'); button.setAttribute('aria-pressed', String(!visible)); }
    else if (action === 'new') newAiConversation();
    else if (action === 'send') sendAiMessage();
    else if (action === 'cancel') cancelAiRequest(aiCurrentSession());
    else if (action === 'save-reply') openReplyDocument(button.dataset.message);
    else if (action === 'review-edit') openDocumentReview(button.dataset.message);
    else if (action === 'undo-edit') void undoDocumentResult(button.dataset.message);
    else if (action === 'clear-reference') { const s = aiCurrentSession(); if (s) { s.editReference = ''; s.includeSelection = false; renderAiSelection(); } }
    else if (action === 'execute') executeAiPlan(button.dataset.message);
    else if (action === 'stop-files') void stopAiFilePlan(button.dataset.message);
    else if (action === 'file-receipt') openFileHistory(button.dataset.record);
    else if (action === 'discard') { const session = aiCurrentSession(); if (session) { discardSessionPlans(session, 'discarded'); renderAiConversation(); } }
    else if (action === 'selection') {
      const session = aiCurrentSession();
      if (session?.projectTools) {
        const {subfolderKey, included} = aiComposerSelection(session);
        if (subfolderKey) session.subfolderSelection = included ? null : subfolderKey;
        else session.includeSelection = !session.includeSelection;
        renderAiSelection();
      }
    }
    else if (action === 'compact') void compactAiConversation();
    else if (action === 'remember') reviewAiMemory(button.dataset.message);
    else if (action === 'memory-save') reviewAiMemory(button.dataset.message, Number(button.dataset.index));
    else if (action === 'memory-ignore') {
      const session = aiCurrentSession(), message = session?.messages.find((m) => m.id === button.dataset.message);
      const suggestion = message?.memorySuggestions?.[Number(button.dataset.index)];
      if (suggestion && !message.memoryEditing) { suggestion.status = 'dismissed'; session.revision++; renderAiConversation(); }
    }
    else if (action === 'example') { $('aiPrompt').value = aiText(button.dataset.example); const session = aiCurrentSession(); if (session) session.draft = $('aiPrompt').value; $('aiPrompt').focus(); }
  });
  aiPanel.addEventListener('input', (event) => {
    if (event.target.id === 'aiEndpoint') $('aiKey').value = '';
    if (['aiEndpoint', 'aiModel', 'aiKey'].includes(event.target.id)) updateAiSettingsForm();
    if (event.target.id === 'aiPrompt') { const session = aiCurrentSession(); if (session) session.draft = event.target.value; }
    if (event.target.matches('[data-ai-confirm]')) {
      const message = aiCurrentSession()?.messages.find((m) => m.id === event.target.dataset.aiConfirm);
      const button = aiPanel.querySelector(`[data-ai-action="execute"][data-message="${message?.id}"]`);
      if (button) button.disabled = !event.target.checked || aiAnyExecution() || message.planState !== 'pending';
    }
  });
  $('aiSettingsForm').addEventListener('submit', (event) => { event.preventDefault(); saveAiSettings(); });
  $('aiSettingsPanel').addEventListener('cancel', (event) => { event.preventDefault(); toggleAiSettings(false); });
  aiPanel.addEventListener('toggle', (event) => {
    if (event.target.dataset.aiSteps) {
      const message = aiCurrentSession()?.messages.find(m => m.id === event.target.dataset.aiSteps);
      if (message && event.target.isConnected) message.stepsExpanded = event.target.open;
      return;
    }
    const messageId = event.target.dataset.aiPlanDetails;
    const message = aiCurrentSession()?.messages.find((m) => m.id === messageId);
    if (message) message.expanded = event.target.open;
  }, true);
  aiPanel.addEventListener('keydown', (event) => {
    if (event.target.id === 'aiPrompt' && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendAiMessage(); }
    if (event.key === 'Escape' && aiSettingsOpen) { event.preventDefault(); toggleAiSettings(false); }
    event.stopPropagation();
  });
  aiPanel.querySelector('[data-ai-resize]').addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.target.setPointerCapture(event.pointerId);
    aiResize = { id: event.pointerId, x: event.clientX, width: aiPanel.getBoundingClientRect().width };
    document.body.classList.add('resizing-ai-panel');
  });
  aiPanel.addEventListener('pointermove', (event) => { if (aiResize?.id === event.pointerId) setAiWidth(aiResize.width + aiResize.x - event.clientX); });
  const finishResize = () => { if (aiResize) { store.set('aiPanelWidth', aiPanel.getBoundingClientRect().width); aiResize = null; document.body.classList.remove('resizing-ai-panel'); } };
  aiPanel.addEventListener('pointerup', finishResize); aiPanel.addEventListener('pointercancel', finishResize); aiPanel.addEventListener('lostpointercapture', finishResize);
  aiPanel.querySelector('[data-ai-resize]').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); setAiWidth(aiPanel.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 16 : -16)); store.set('aiPanelWidth', aiPanel.getBoundingClientRect().width);
  });
  setAiWidth(store.get('aiPanelWidth', 380));
  syncAiWorkspace();
}
function setAiWidth(value) {
  const width = Math.max(320, Math.min(560, Number.isFinite(value) ? value : 380));
  aiPanel.style.setProperty('--ai-panel-width', `${width}px`);
  aiPanel.querySelector('[data-ai-resize]').setAttribute('aria-valuenow', String(width));
  if (typeof syncAgentLayout === 'function') syncAgentLayout(aiPanelOpen, width);
}
function syncAiWorkspace() {
  if (!aiPanel) return;
  if(typeof syncHarnessUnread==='function')syncHarnessUnread();
  const root = aiBrowsingFolder(), key = aiSessionKeyFor(root), previous = aiCurrentSession();
  syncPinnedAuto(previous);
  if (key !== aiCurrentKey) {
    if (previous) { previous.draft = $('aiPrompt').value; previous.subfolderSelection = null; previous.activation++; }
    aiCurrentKey = key;
    const session = root ? aiSessionFor(root) : null;
    if (session && aiProjectScope(root)) void resumeAiProject(session);
    $('aiPrompt').value = session?.draft || ''; aiPaintIdentity = '';
  }
  aiPanel.classList.toggle('hidden', !aiPanelOpen); document.body.classList.toggle('ai-panel-open', aiPanelOpen);
  if (typeof syncFileHistoryScope === 'function') syncFileHistoryScope();
  aiPanel.querySelectorAll('[data-ai-text]').forEach((el) => { el.textContent = aiText(el.dataset.aiText); });
  aiPanel.querySelectorAll('[data-ai-title]').forEach((el) => { el.title = aiText(el.dataset.aiTitle); el.setAttribute('aria-label', el.title); });
  aiPanel.querySelector('[data-ai-resize]').setAttribute('aria-label', aiText('resize'));
  const remote = curTab()?.connection === 'ssh';
  $('aiPrompt').placeholder = aiText(root ? 'prompt' : remote ? 'remoteFolder' : 'noFolder'); $('aiPrompt').setAttribute('aria-label', aiText('prompt'));
  $('aiFolderName').textContent = root ? basename(root) || root : aiText(remote ? 'remoteFolder' : 'noFolder');
  $('aiFolderPath').textContent = root || aiText(remote ? 'remoteHint' : 'noFolderHint'); $('aiFolderPath').title = root || '';
  $('aiScopeMode').textContent = !root ? (locale === 'zh' ? '未选择任务目标' : 'No task target') : aiProjectRoot ? (locale === 'zh' ? '固定的本地项目' : 'Pinned local project') : aiText(isTermTab(curTab()) ? 'terminal' : 'following');
  $('aiContextRow')?.classList.toggle('hidden', remote && !root);
  const memoryPath = root ? root.replace(/[\\/]+$/, '') + '\\.dalizi\\agent-memory.json' : '';
  $('aiMemoryPath').textContent = root ? '.dalizi / agent-memory.json' : '';
  $('aiMemoryPath').title = aiText('memoryLocation') + ': ' + memoryPath;
  $('btnAiAssistant')?.setAttribute('aria-pressed', String(aiPanelOpen));
  if (aiSettingsOpen) updateAiSettingsForm();
  if (typeof syncAgentLayout === 'function') syncAgentLayout(aiPanelOpen);
  if (typeof syncAgentProfile === 'function') syncAgentProfile(root);
  renderAiSelection(); renderAiConversation(); updateAiComposer();
}
function openAiAssistant() {
  initAiAssistant(); aiPanelOpen = true; store.set('aiPanelOpen', true);
  if (typeof renderWorkspace === 'function') renderWorkspace(); else syncAiWorkspace();
  $('aiPrompt').focus();
}
function closeAiAssistant() { aiPanelOpen = false; store.set('aiPanelOpen', false); syncAiWorkspace(); }
function readAiSettingsForm() {
  return { apiFormat: $('aiApiFormat').value || 'openai-completions', endpoint: $('aiEndpoint').value.trim(), model: $('aiModel').value.trim(), key: $('aiKey').value, apiDialect: $('aiApiDialect').value || 'generic', reasoningEffort: $('aiReasoningEffort').value || 'default' };
}
function validateAiSettings(value) {
  const errors = {}, bytes = (text) => new TextEncoder().encode(text).length;
  let requestUrl = '';
  const format = aiFormatOf(value), suffix = aiFormatSuffix(format);
  if (!suffix) errors.format = 'formatInvalid';
  if (!value.endpoint) errors.endpoint = 'endpointRequired';
  else if (bytes(value.endpoint) > 2048) errors.endpoint = 'endpointLong';
  else {
    try {
      const url = new URL(value.endpoint), host = url.hostname.toLowerCase();
      const loopback = host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
      if (!url.hostname) errors.endpoint = 'endpointInvalid';
      else if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) errors.endpoint = 'endpointSecure';
      else if (url.username || url.password || /[?#]/.test(value.endpoint)) errors.endpoint = 'endpointParts';
      else {
        const path = url.pathname.replace(/\/+$/, '');
        const known = ['/chat/completions', '/responses', '/messages'].find(part => path.endsWith(part));
        if (!suffix || (known && known !== suffix)) errors.format = 'formatInvalid';
        else {
          if (!known) url.pathname = (path || '/v1') + (format === 'anthropic-messages' && path && !path.endsWith('/v1') ? '/v1' : '') + suffix;
          requestUrl = url.href;
        }
      }
    } catch { errors.endpoint = 'endpointInvalid'; }
  }
  if (!value.model) errors.model = 'modelRequired';
  else if (bytes(value.model) > 256) errors.model = 'modelLong';
  if (bytes(value.key) > 4096 || /[\r\n\0]/.test(value.key)) errors.key = 'keyInvalid';
  if (!aiDialectAllowed(format, value.apiDialect) || !['generic', 'openai', 'deepseek'].includes(value.apiDialect || 'generic') || !aiEfforts(value.apiDialect).includes(value.reasoningEffort || 'default')) errors.reasoning = 'reasoningInvalid';
  return { errors, requestUrl };
}
function updateAiSettingsForm() {
  const value = readAiSettingsForm(), validation = validateAiSettings(value);
  if (aiTestRun && aiTestRun.stamp !== JSON.stringify(value)) resetAiConnectionTest();
  const dirty = $('aiStreamReplies').checked !== aiStreamReplies || JSON.stringify(aiPublicSettings(value)) !== JSON.stringify(aiPublicSettings(aiSettings)) || value.key !== aiSessionKey;
  for (const [key, id] of [['format', 'aiApiFormat'], ['endpoint', 'aiEndpoint'], ['model', 'aiModel'], ['key', 'aiKey'], ['reasoning', 'aiReasoningEffort']]) {
    const error = aiSettingsValidated && validation.errors[key];
    $(id).setAttribute('aria-invalid', String(!!error));
    $(id + 'Error').textContent = error ? aiText(error) : ''; $(id + 'Error').hidden = !error;
  }
  $('aiRequestAddress').hidden = !validation.requestUrl;
  $('aiRequestUrl').textContent = validation.requestUrl;
  const invalid = aiSettingsValidated && Object.keys(validation.errors).length > 0;
  $('aiSettingsStatus').textContent = aiText(invalid ? 'invalidSettings' : dirty ? 'unsaved' : aiSettings.endpoint && aiSettings.model ? 'savedState' : 'initialSettings');
  $('aiSettingsStatus').classList.toggle('is-error', !!invalid);
  $('aiSettingsStatus').classList.toggle('is-dirty', dirty && !invalid);
  aiPanel.querySelector('[data-ai-action="save-settings"]').disabled = !dirty && !!aiSettings.endpoint && !!aiSettings.model;
  aiPanel.querySelector('[data-ai-action="show-key"]').textContent = aiText($('aiKey').type === 'password' ? 'showKey' : 'hideKey');
  return validation;
}
function toggleAiSettings(open = !aiSettingsOpen) {
  if (open === aiSettingsOpen) return;
  resetAiConnectionTest();
  aiSettingsOpen = open; aiSettingsValidated = false;
  $('aiStreamReplies').checked = aiStreamReplies;
  $('aiEndpoint').value = aiSettings.endpoint || ''; $('aiModel').value = aiSettings.model || ''; $('aiKey').value = aiSessionKey;
  $('aiApiFormat').value = aiFormatOf(aiSettings);
  $('aiApiDialect').value = aiSettings.apiDialect || 'generic'; refreshAiEffortField(); $('aiReasoningEffort').value = aiSettings.reasoningEffort || 'default';
  $('aiKey').type = 'password'; aiPanel.querySelector('[data-ai-action="show-key"]').setAttribute('aria-pressed', 'false');
  aiPanel.querySelector('.ai-settings-entry').setAttribute('aria-pressed', String(open));
  const dialog = $('aiSettingsPanel');
  if (open) { updateAiSettingsForm(); if (!dialog.open) dialog.showModal(); $('aiEndpoint').focus(); }
  else { dialog.close(); aiPanel.querySelector('.ai-settings-entry').focus(); }
}
function saveAiSettings() {
  aiSettingsValidated = true;
  const { errors } = updateAiSettingsForm();
  if (Object.keys(errors).length) { $({ format: 'aiApiFormat', endpoint: 'aiEndpoint', model: 'aiModel', key: 'aiKey', reasoning: 'aiReasoningEffort' }[Object.keys(errors)[0]]).focus(); return false; }
  const value = readAiSettingsForm();
  value.streamReplies = $('aiStreamReplies').checked;
  if (value.key && $('aiRememberKey').checked) {
    const form = $('aiSettingsForm');
    if (form.inert) return false;
    form.inert = true;
    return invoke('ai_save_key', {endpoint:value.endpoint, apiFormat:value.apiFormat, key:value.key})
      .then(() => finishAiSettings(value, '')).catch(error => { toast(String(error), true); return false; })
      .finally(() => { form.inert = false; });
  }
  return finishAiSettings(value, value.key);
}
function finishAiSettings(value, sessionKey) {
  if (!applyAiRuntimeSettings(value, sessionKey, true)) return false;
  aiStreamReplies = value.streamReplies; store.set('aiStreamReplies', aiStreamReplies);
  toggleAiSettings(false); aiPaintIdentity = ''; renderAiConversation(); updateAiComposer();
  if (typeof toast === 'function') toast(aiText('configured'));
  return true;
}
function resetAiConnectionTest() {
  if (aiTestRun?.id) invoke('ai_cancel', { requestId: aiTestRun.id }).catch(() => {});
  aiTestRun = null;
  $('aiApiTestStatus').textContent = '';
  if (!aiPanel) return;
  aiPanel.querySelector('[data-ai-action="test-api"]').disabled = false;
  aiPanel.querySelector('[data-ai-action="test-api"]').textContent = aiText('testApi');
  aiPanel.querySelector('[data-ai-action="cancel-test"]').hidden = true;
}
async function testAiConnection() {
  if (aiTestRun?.id) return;
  aiSettingsValidated = true;
  const validation = updateAiSettingsForm();
  if (Object.keys(validation.errors).length) return;
  const value = readAiSettingsForm(), job = { id: crypto.randomUUID(), stamp: JSON.stringify(value) };
  aiTestRun = job;
  const button = aiPanel.querySelector('[data-ai-action="test-api"]'), status = $('aiApiTestStatus');
  button.disabled = true; button.textContent = aiText('testRunning');
  aiPanel.querySelector('[data-ai-action="cancel-test"]').hidden = false;
  status.classList.toggle('is-error', false); status.textContent = aiText('testRunning');
  try {
    const result = await invoke('ai_test_connection', { request: { requestId: job.id, ...aiPublicSettings(value), apiKey: value.key } });
    if (aiTestRun !== job || !aiSettingsOpen) return;
    status.textContent = `${aiText('testSuccess')} · ${result.elapsedMs} ms · ${result.model}\n${result.requestUrl}`;
  } catch (error) {
    if (aiTestRun !== job || !aiSettingsOpen) return;
    status.classList.toggle('is-error', true);
    const message = String(error);
    status.textContent = aiText('testFailed') + ' · ' + (value.key ? message.split(value.key).join('[redacted]') : message);
  } finally {
    value.key = '';
    if (aiTestRun === job) {
      job.id = null;
      button.disabled = false; button.textContent = aiText('testApi');
      aiPanel.querySelector('[data-ai-action="cancel-test"]').hidden = true;
    }
  }
}
function newAiConversation() {
  const session = aiCurrentSession();
  if (!session || session.running || session.restoring) return;
  if (typeof aiSessionNeedsExitWork === 'function' && aiSessionNeedsExitWork(session)) {
    return prepareAiSessionForExit(session, () => aiCurrentSession() === session).then(ok => {
      if (ok && aiCurrentSession() === session) return newAiConversation();
    }).finally(() => clearAiArchiveDismissal(session));
  }
  cancelAiRequest(session, false); discardSessionPlans(session);
  if (typeof retireAiArchive === 'function') retireAiArchive(session);
  aiSessions.delete(session.key);
  const fresh = aiSessionFor(session.root); fresh.resumeChecked = true; fresh.permissionMode = 'confirm';
  $('aiPrompt').value = ''; aiPaintIdentity = ''; renderAiConversation(); updateAiComposer();
}
function renderAiSelection() {
  if (!aiPanel) return;
  const session = aiCurrentSession();
  const {paths: selected, included, subfolderKey} = aiComposerSelection(session?.projectTools ? session : null);
  if (session?.subfolderSelection && session.subfolderSelection !== subfolderKey) session.subfolderSelection = null;
  const label = subfolderKey ? (locale === 'zh' ? '子目录选中项' : 'Subfolder selection') : aiText('selection');
  const action = subfolderKey && !included ? (locale === 'zh' ? '本次引用' : 'Attach for this message') : aiText(included ? 'ignore' : 'include');
  const html = selected.length ? `<span>${esc(label)} · ${selected.length}${state.selection.size > 20 ? '+' : ''}</span><button class="ai-link" data-ai-action="selection" aria-pressed="${!!included}">${esc(action)}</button><div class="ai-selection-chips${included ? '' : ' ignored'}">${selected.slice(0, 3).map((name) => `<span title="${esc(name)}">${esc(name)}</span>`).join('')}${selected.length > 3 ? `<span>+${selected.length - 3}</span>` : ''}</div>` : '';
  const status = $('aiReferenceStatus');
  if (status) {
    const names = included ? selected : [];
    status.textContent = (locale === 'zh' ? '本次引用　' : 'References　') + (names.length ? names.join('、') : (locale === 'zh' ? '无' : 'None'));
    status.title = status.textContent;
    status.hidden = !session?.projectTools;
  }
  if ($('aiSelectionContext').innerHTML !== html) $('aiSelectionContext').innerHTML = html;
}
function updateAiComposer() {
  if (!aiPanel) return;
  if (typeof renderAgentRole === 'function') renderAgentRole();
  const session = aiCurrentSession(), busy = !!(session?.requestId || session?.running || session?.restoring);
  $('aiProjectTools').checked = !!session?.projectTools; $('aiProjectTools').disabled = !session || busy || session.agentRole?.access === 'advice';
  $('aiPrompt').disabled = !session || session.running;
  const send = aiPanel.querySelector('[data-ai-action="send"]'); send.disabled = !session || busy; send.textContent = aiText(session?.running ? 'executing' : 'send');
  aiPanel.querySelector('[data-ai-action="cancel"]').classList.toggle('hidden', !session?.requestId);
  aiPanel.querySelector('[data-ai-action="new"]').disabled = !session || session.running;
  $('aiModelLabel').textContent = aiSettings.model || aiText('noModel'); $('aiModelLabel').title = aiSettings.endpoint || aiText('configure');
  const effort = $('aiQuickEffort'), preset = $('aiModelPreset');
  effort.innerHTML = aiEffortOptions(aiSettings.apiDialect); effort.value = aiSettings.reasoningEffort || 'default'; effort.disabled = !aiSettings.apiDialect || aiSettings.apiDialect === 'generic'; effort.setAttribute('aria-label', aiText('reasoning')); effort.title = aiText('reasoningHint');
  preset.innerHTML = `<option value="current">${esc(aiSettings.model || aiText('noModel'))}</option>` + aiModelPresets.map((p, index) => p.endpoint !== aiSettings.endpoint || aiFormatOf(p) !== aiFormatOf(aiSettings) || p.model !== aiSettings.model ? `<option value="${index}">${esc(p.model)}${p.endpoint === aiSettings.endpoint && aiFormatOf(p) === aiFormatOf(aiSettings) ? '' : ' · ' + esc(p.endpoint)}</option>` : '').join('') + `<option value="settings">${esc(aiText('modelSettings'))}</option>`;
  preset.value = 'current'; preset.setAttribute('aria-label', aiText('preset'));
  if (typeof renderAiContextMeter === 'function') renderAiContextMeter();
  $('aiComposerNote').textContent = aiText('hint') + ' · ' + (typeof chatText === 'function' ? chatText('对话可在当前目录保存与恢复', 'Save and restore conversations in this folder') : aiText('memory'));
  if (typeof renderAiArchiveStatus === 'function') renderAiArchiveStatus();
  $('aiPermissionMode').value = session?.permissionMode || 'confirm';
  $('aiPermissionMode').disabled = !session?.projectTools || session.running || (!!session.agentRole && session.agentRole.access !== 'standard');
  const autoTab = aiAutoTab(session), autoOption = $('aiPermissionMode').querySelector?.('option[value="auto"]');
  if (autoOption) autoOption.disabled = !autoTab;
  $('aiPermissionHint').textContent = session?.projectTools && session.permissionMode === 'confirm' && !autoTab
    ? (locale === 'zh' ? '文件操作需要确认。要开启自动执行，请回到项目的本地目录。' : 'Review file changes here. Return to the local project folder to enable automatic execution.')
    : aiText(session?.permissionMode === 'auto' ? 'autoHint' : session?.permissionMode === 'read-only' ? 'readOnlyHint' : 'confirmHint');
  $('aiPermissionHint').classList.toggle('is-auto', session?.permissionMode === 'auto');
  aiPanel.querySelector('.ai-permissions')?.classList.toggle('hidden', !session);
}
function aiActionMarkup(action, result) {
  const preview = action.kind === 'create_text' && typeof action.content === 'string'
    ? `<div class="ai-document-preview"><small>${esc(aiText('documentPreview'))}</small><pre>${esc(action.content)}</pre></div>` : '';
  return `<div class="ai-action"><div class="ai-action-title"><strong>${esc(aiText(action.kind))}</strong>${result ? `<span class="ai-result ${esc(result.status)}">${esc(aiText(result.status))}</span>` : ''}</div>${action.source ? `<div class="ai-path"><span>${aiText('source')}</span><code>${esc(action.source)}</code></div>` : ''}<div class="ai-path"><span>${aiText('target')}</span><code>${esc(action.target)}</code></div>${preview}${result?.message ? `<small class="ai-action-message">${esc(result.message)}</small>` : ''}</div>`;
}
function aiStepKind(kind) {
  if (kind === 'read') return projectText('读取文件', 'Read file');
  if (kind === 'list') return projectText('列出目录', 'List directory');
  if (kind === 'inspect') return projectText('检查路径', 'Inspect path');
  return aiText(kind);
}

function aiStepsMarkup(message) {
  if (!message.steps?.length) return '';
  const rows = message.steps.map(step => {
    const status = step.status === 'unconfirmed' ? projectText('结果未确认','Unconfirmed') : aiText(step.status);
    const time = Number.isFinite(step.elapsedMs) ? (step.elapsedMs < 1 ? '<1' : String(step.elapsedMs)) + ' ms' : '';
    return `<li><strong>${esc(aiStepKind(step.kind))}</strong><span class="ai-result ${esc(step.status)}">${esc(status)}</span><small>${esc(time)}</small><code>${esc(step.path)}</code>${step.detail ? `<small class="step-detail">${esc(step.detail)}</small>` : ''}</li>`;
  }).join('');
  const failed = message.steps.some(s => s.status === 'failed');
  return `<details class="ai-plan-card ai-steps" data-ai-steps="${esc(message.id)}" ${message.stepsExpanded ? 'open' : ''}><summary>${projectText('执行记录', 'Activity')} · ${message.steps.length}${failed ? ' · ' + projectText('含失败步骤', 'Includes failed steps') : ''}</summary><ol>${rows}</ol></details>`;
}

function aiModelAttribution(route, roleLabel) {
  const name = roleLabel?.[locale];
  return (route ? ` · <span title="${esc(route.endpoint)}">${esc(route.model)}</span>` : '') + (name ? ' · ' + esc(name) : '');
}
function aiMessageMarkup(message) {
  let card = '';
  if (message.plan?.actions.length) {
    const pending = message.planState === 'pending';
    const label = {pending:'review', running:'executing', done:'done', discarded:'discarded', expired:'expired'}[message.planState] || 'superseded';
    const title = message.roleChanged ? (locale === 'zh' ? '角色或推荐技能已更改，请重新生成计划' : 'Role or skills changed. Generate a new plan.') : aiText(label);
    card = `<details class="ai-plan-card" data-ai-plan-details="${message.id}" ${message.expanded ? 'open' : ''}><summary>${esc(title)} · ${message.plan.actions.length}</summary><div class="ai-plan-actions">${message.plan.actions.map((action) => aiActionMarkup(action)).join('')}</div>${pending ? `<div class="ai-confirmation"><label><input type="checkbox" data-ai-confirm="${message.id}"><span>${esc(aiText('confirmation'))}</span></label><div><button class="ai-primary" data-ai-action="execute" data-message="${message.id}" disabled>${esc(aiText('execute'))}</button><button class="ai-secondary" data-ai-action="discard">${esc(aiText('discard'))}</button></div></div>` : ''}</details>`;
  }
  if (message.plan?.actions[0]?.kind === 'edit_text' && message.planState === 'pending') {
    const filename = basename(message.plan.actions[0].target);
    card = `<div class="edit-proposal"><strong>${esc(filename)}</strong><button type="button" class="ai-primary" data-ai-action="review-edit" data-message="${esc(message.id)}">${esc(locale === 'zh' ? '审阅修改' : 'Review changes')}</button></div>`;
  }
  if (message.planState === 'running' && message.fileProgress) {
    const {index,status} = message.fileProgress, actions = message.plan.actions;
    card += `<p class="ai-message-meta" data-file-progress>${index + 1}/${actions.length} · ${esc(fileHistoryLabel(status))} · ${esc(actions[index].target)}</p>`;
  }
  if (message.planState === 'running' && message.plan?.actions.length > 1) {
    card += `<button class="ai-secondary" data-ai-action="stop-files" data-message="${esc(message.id)}"${message.stopRequested ? ' disabled' : ''}>${esc(locale === 'zh' ? (message.stopRequested ? '已请求停止后续步骤' : '停止后续步骤') : (message.stopRequested ? 'Stop requested' : 'Stop remaining steps'))}</button>`;
  }
  if (message.journalId) card += `<button class="ai-link" data-ai-action="file-receipt" data-record="${esc(message.journalId)}">${esc(locale === 'zh' ? '查看文件操作记录' : 'View file operation record')}</button>`;
  if (message.planState === 'pending' && message.foregroundChanged) {
    card = '<p class="ai-message-meta">' + esc(locale === 'zh' ? '等待回答时切换过标签或目录，未自动执行。请核对目标后确认。' : 'The tab or folder changed while waiting. Review the destination and confirm to run this plan.') + '</p>' + card;
  }
  if (message.results?.some(r => r.kind === 'edit_text' && r.status === 'success') && !message.undone) {
    card += `<button type="button" class="ai-link" data-ai-action="undo-edit" data-message="${esc(message.id)}">${esc(locale === 'zh' ? '撤销这次修改' : 'Undo this edit')}</button>`;
  }
  if (message.results) card += `<details class="ai-plan-card"><summary>${esc(aiText('notice'))} · ${message.results.length}</summary>${message.results.map((result) => aiActionMarkup(result, result)).join('')}</details>`;
  card += aiStepsMarkup(message);
  if (message.planState === 'done' && message.plan?.actions[0]?.kind === 'edit_text') {
    card += `<button type="button" class="ai-link" data-ai-action="review-edit" data-message="${esc(message.id)}">${projectText('查看此次差异','View applied changes')}</button>`;
  }
  const suggestions = (message.memorySuggestions || []).map((suggestion, index) => suggestion.status === 'dismissed' ? '' : `<div class="ai-memory-suggestion"><small>${esc(aiText(suggestion.status === 'saved' ? 'memorySaved' : 'memoryReview'))}</small><p>${esc(suggestion.content)}</p>${suggestion.status !== 'saved' ? `<div><button type="button" class="ai-link" data-ai-action="memory-save" data-message="${message.id}" data-index="${index}" ${message.memoryEditing ? 'disabled' : ''}>${esc(aiText(message.memoryEditing ? 'memorySaving' : 'memorySave'))}</button><button type="button" class="ai-link" data-ai-action="memory-ignore" data-message="${message.id}" data-index="${index}" ${message.memoryEditing ? 'disabled' : ''}>${esc(aiText('memoryIgnore'))}</button></div>` : ''}</div>`).join('');
  const used = [message.appliedSkills?.length ? aiText('skillsUsed') + ' · ' + message.appliedSkills.map((skill) => skill.name).join(' / ') : '', message.memoryCount ? aiText('memoryUsed').replace('{n}', message.memoryCount) : '', message.agentContextTruncated ? aiText('contextPartial') : ''].filter(Boolean).join(' · ');
  const remember = !message.error && ['user', 'assistant'].includes(message.role) && typeof saveAgentSuggestedMemory === 'function' ? `<button type="button" class="ai-link ai-message-remember" data-ai-action="remember" data-message="${message.id}" ${message.memoryEditing ? 'disabled' : ''}>${esc(aiText('remember'))}</button>` : '';
  const saveReply = message.role === 'assistant' && !message.error && message.text
    ? `<button type="button" class="ai-link" data-ai-action="save-reply" data-message="${message.id}" ${aiCurrentSession()?.permissionMode === 'read-only' ? 'disabled' : ''}>${esc(aiText('saveReply'))}</button>` : '';
  return `<article class="ai-message ${message.role}${message.error ? ' is-error' : ''}" data-ai-message="${message.id}"><div class="ai-message-label">${esc(aiText(message.role === 'user' ? 'you' : message.role === 'assistant' ? 'assistant' : 'notice'))}${aiModelAttribution(message.modelRoute, message.roleLabel)}</div><div class="ai-message-body">${esc(message.text)}</div>${card}${suggestions}${message.contextCount != null ? `<small class="ai-message-meta">${esc(aiText('context').replace('{n}', message.contextCount))}${message.contextTruncated ? ' · ' + esc(aiText('truncated')) : ''}</small>` : ''}${used ? `<small class="ai-message-meta ai-context-used">${esc(used)}</small>` : ''}${(saveReply || remember) ? `<div class="ai-message-actions">${saveReply}${remember}</div>` : ''}</article>`;
}
async function reviewAiMemory(messageId, index) {
  const session = aiCurrentSession(), message = session?.messages.find((item) => item.id === messageId);
  if (!message || message.memoryEditing || typeof saveAgentSuggestedMemory !== 'function') return;
  const suggestion = index == null ? null : message.memorySuggestions?.[index];
  if (index != null && (!suggestion || suggestion.status !== 'pending')) return;
  message.memoryEditing = true; session.revision++; renderAiConversation();
  try {
    const saved = await saveAgentSuggestedMemory(session.root, aiChars(suggestion ? suggestion.content : message.text, 2000));
    if (saved && suggestion) suggestion.status = 'saved';
  } catch (error) { toast(String(error), true); }
  finally { message.memoryEditing = false; session.revision++; if (aiCurrentSession() === session) renderAiConversation(); }
}
function onAiFileProgress({planId, index, status}) {
  const owner = [...aiSessions.values()].find(session => session.running);
  const message = owner?.messages.find(m => m.planState === 'running' && m.plan?.id === planId);
  if (!message || !Number.isInteger(index) || !message.plan.actions[index]) return;
  if (!['running', 'success', 'failed'].includes(status)) return;
  const previous = message.fileProgress;
  if (previous && (previous.index > index || (previous.index === index && previous.status !== 'running'))) return;
  message.fileProgress = {index, status};
  owner.revision++;
  if (aiCurrentSession() === owner) renderAiConversation();
}
function onAiTextDelta(payload) {
  if (!payload || typeof payload.text !== 'string' || !payload.text || !payload.requestId) return;
  const owner = [...aiSessions.values()].find(session => session.requestId === payload.requestId);
  if (!owner || owner.projectTools || payload.sequence !== (owner.streamSequence || 0) + 1) return;
  owner.streamSequence = payload.sequence;
  owner.streamText = (owner.streamText || '') + payload.text;
  if (aiCurrentSession() !== owner) return;
  const body = $('aiStreamingBody');
  if (body?.dataset?.request !== payload.requestId) {
    owner.revision++;
    renderAiConversation();
    return;
  }
  const messages = $('aiMessages'), follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
  body.append(document.createTextNode(payload.text));
  if (follow) messages.scrollTop = messages.scrollHeight;
}

function retainPartialReply(session) {
  if (!session.streamText) return false;
  const prefix = locale === 'zh' ? '［未完成的回复］' : '[Incomplete reply]';
  const partial = session.streamText;
  session.streamText = '';
  // Archives limit each message to 32,000 characters, including the marker.
  const text = aiChars(prefix + '\n\n' + partial, 31996);
  addAiMessage(session, 'assistant', text + (text.length < prefix.length + 2 + partial.length ? '…' : ''), {omitHistory:true, modelRoute:session.requestModel, roleLabel:session.requestRoleLabel});
  return true;
}

function renderAiConversation() {
  if (!aiPanel) return;
  const session = aiCurrentSession(), remote = curTab()?.connection === 'ssh', identity = [aiCurrentKey, remote, locale, session?.revision, session?.requestId, session?.running, aiAnyExecution()].join('|');
  if (identity === aiPaintIdentity) return;
  aiPaintIdentity = identity;
  const messages = $('aiMessages'), nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
  messages.innerHTML = session?.messages.length ? session.messages.map(aiMessageMarkup).join('') : `<div class="ai-chat-empty"><span class="ai-empty-mark">✦</span><h3>${esc(aiText(session ? 'welcome' : remote ? 'remoteFolder' : 'noFolder'))}</h3><p>${esc(aiText(session ? 'welcomeHint' : remote ? 'remoteHint' : 'noFolderHint'))}</p>${session ? `<div class="ai-suggestions">${['example1', 'example2', 'example3'].map((key) => `<button data-ai-action="example" data-example="${key}">${esc(aiText(key))}</button>`).join('')}</div>` : ''}${!remote && (!aiSettings.endpoint || !aiSettings.model) ? `<button class="ai-link" data-ai-action="settings">${esc(aiText('configure'))}</button>` : ''}</div>`;
  if (session?.requestId && session.streamText) {
    messages.insertAdjacentHTML('beforeend', `<article class="ai-message assistant"><div class="ai-message-label">${esc(aiText('assistant'))}${aiModelAttribution(session.requestModel, session.requestRoleLabel)}</div><div id="aiStreamingBody" class="ai-message-body" data-request="${esc(session.requestId)}" aria-live="off">${esc(session.streamText)}</div></article>`);
  } else if (session?.requestId) messages.innerHTML += `<div class="ai-thinking" role="status">✦ ${esc(session.activity || aiText('sending'))}${aiModelAttribution(session.requestModel, session.requestRoleLabel)}</div>`;
  if (nearBottom || session?.messages[session.messages.length - 1]?.role === 'user') messages.scrollTop = messages.scrollHeight;
}

async function sendAiMessage() {
  const session = aiCurrentSession();
  if (!session || !aiTabIsActive(session) || session.requestId || session.running || session.restoring) return;
  syncPinnedAuto(session);
  const prompt = $('aiPrompt').value.trim();
  if (!prompt) return;
  if (!aiSettings.endpoint || !aiSettings.model) { toggleAiSettings(true); $('aiSettingsStatus').textContent = aiText('missing'); return; }
  const model = aiPublicSettings(aiSettings), route = {...model, apiKey: aiSessionKey};
  const submittedRole = session.agentRole, useRoleSkills = !!session.useRoleSkills, roleGeneration = session.roleGeneration || 0;
  const roleLabel = {zh: submittedRole?.nameZh || '通用助手', en: submittedRole?.nameEn || 'General'};
  const generalChat = !session.projectTools, streamChat = generalChat && aiStreamReplies;
  discardSessionPlans(session);
  const previousMessages = session.messages.slice(), selection = session.projectTools ? aiSelectedPaths(session) : [];
  session.subfolderSelection = null;
  renderAiSelection();
  addAiMessage(session, 'user', prompt);
  session.toolSteps = [];
  session.draft = ''; $('aiPrompt').value = '';
  const requestId = crypto.randomUUID(), permissionMode = session.permissionMode, activation = session.activation; session.requestId = requestId; session.requestModel = model; session.activity = ''; session.streamText = ''; session.streamSequence = 0;
  session.requestRoleLabel = roleLabel;
  renderAiConversation(); updateAiComposer();
  try {
    const context = typeof getAgentRequestContext === 'function' ? await getAgentRequestContext(session.root) : {};
    if (session.requestId !== requestId || aiSessions.get(session.key) !== session) return;
    if (typeof prepareAiMemory === 'function') {
      try { await prepareAiMemory(session, requestId, previousMessages, false, route); }
      catch (error) { if (session.requestId === requestId) { session.memoryWarning = String(error); addAiMessage(session, 'notice', aiText('contextPartial') + ': ' + String(error), { omitHistory: true, error: true }); } }
    }
    if (session.requestId !== requestId || aiSessions.get(session.key) !== session) return;
    const history = aiHistory({ ...session, messages: previousMessages });
    const plan = await invoke('ai_plan', { request: { requestId, ...route, generalChat, streamChat, root: session.root, prompt, history, selection, ...(session.conversationSummary ? { conversationSummary: session.conversationSummary } : {}),
      skillIds: context.skillIds || [], roleId: submittedRole?.id || 'general', useRoleSkills,
      ...(context.copyRevisions ? {copyRevisions:context.copyRevisions} : {}),
      useMemory: !!context.useMemory, learnMemory: !!context.learnMemory, permissionMode,
    } });
    if (session.requestId !== requestId || aiSessions.get(session.key) !== session) { invoke('ai_discard', { id: plan.id }).catch(() => {}); return; }
    if (aiKey(plan.root) !== aiKey(session.root) || plan.permissionMode !== permissionMode || ((generalChat || permissionMode === 'read-only') && plan.actions.length)) { invoke('ai_discard', { id: plan.id }).catch(() => {}); throw new Error(aiText('invalidScope')); }
    if (!plan.steps && plan.inspected?.length) addAiMessage(session, 'notice', plan.inspected.join('\n'));
    session.streamText = '';
    syncPinnedAuto(session);
    const foregroundChanged = permissionMode === 'auto' && (activation !== session.activation ||
      !aiTabIsActive(session) || !session.autoTab || session.autoTab !== aiAutoTab(session));
    const roleChanged = roleGeneration !== (session.roleGeneration || 0);
    if (roleChanged && plan.actions.length) invoke('ai_discard', { id: plan.id }).catch(() => {});
    const message = addAiMessage(session, 'assistant', plan.summary, { plan: plan.actions.length ? plan : null, planState: plan.actions.length ? (roleChanged ? 'superseded' : 'pending') : null, contextCount: generalChat ? null : plan.contextCount, contextTruncated: plan.contextTruncated,
      roleLabel, roleChanged,
      foregroundChanged, modelRoute:model,
      appliedSkills: plan.appliedSkills || [], memoryCount: plan.memoryCount || 0, agentContextTruncated: !!plan.agentContextTruncated,
      steps: plan.steps || session.toolSteps.filter(Boolean),
      memorySuggestions: (context.learnMemory ? plan.memorySuggestions || [] : []).filter((value) => typeof value === 'string' && value.trim()).slice(0, 3).map((content) => ({ content: aiChars(content, 600), status: 'pending' })),
    });
    if (message.planState === 'pending') watchAiPlanExpiry(session, message);
    if (message.planState === 'pending' && permissionMode === 'auto' && session.permissionMode === permissionMode && !foregroundChanged && !plan.actions.some(a => a.kind === 'edit_text')) {
      session.requestId = null;
      await executeAiPlan(message.id, true);
    }
  } catch (error) {
    if (session.requestId === requestId && aiSessions.get(session.key) === session) {
      retainPartialReply(session);
      addAiMessage(session, 'notice', String(error), { error: true, omitHistory: true, modelRoute:model, roleLabel, steps: session.toolSteps.filter(Boolean) });
    }
  } finally {
    if (session.requestId === requestId) session.requestId = null;
    if (session.requestModel === model) { session.requestModel = null; session.requestRoleLabel = null; }
    if (aiCurrentSession() === session) { renderAiConversation(); updateAiComposer(); }
  }
}
function cancelAiRequest(session = aiCurrentSession(), notify = true) {
  const requestId = session?.requestId;
  if (!requestId) return;
  session.requestId = null; invoke('ai_cancel', { requestId }).catch(() => {});
  const partial = retainPartialReply(session);
  session.requestModel = null;
  session.requestRoleLabel = null;
  session.compacting = false;
  const steps = session.toolSteps?.filter(Boolean) || [];
  if ((notify && !partial) || steps.length) addAiMessage(session, 'notice', aiText('cancelled'), { omitHistory: true, steps });
  if (aiCurrentSession() === session) { renderAiConversation(); updateAiComposer(); }
}
async function executeAiPlan(messageId, automatic = false, reviewed = false) {
  const session = aiCurrentSession(), message = session?.messages.find((m) => m.id === messageId);
  syncPinnedAuto(session);
  if (!session || !aiTabIsActive(session) || session.permissionMode === 'read-only' || !message?.plan || message.planState !== 'pending' || session.requestId || aiAnyExecution()) return;
  if (expireAiPlan(session, message)) return;
  if (message.plan.actions.some(a => a.kind === 'edit_text') && !reviewed) return;
  if (!reviewed && (automatic ? session.permissionMode !== 'auto' : !aiPanel.querySelector(`[data-ai-confirm="${messageId}"]`)?.checked)) return;
  if (automatic && (message.foregroundChanged || !session.autoTab || session.autoTab !== aiAutoTab(session))) return;
  if (automatic && typeof desktopExitPending !== 'undefined' && desktopExitPending) return;
  if (aiKey(message.plan.root) !== aiKey(session.root) || !aiPlanModeMatches(session, message.plan, !automatic)) return;
  clearAiPlanTimer(message);
  const plan = message.plan; message.planState = 'running'; session.running = true; session.revision++;
  renderAiConversation(); updateAiComposer();
  try {
    const result = await invoke('ai_execute', { id: plan.id, approved: !automatic, permissionMode: session.permissionMode });
    message.planState = result.completed ? 'done' : 'discarded';
    message.journalId = result.journalId;
    const bounded = (value, n) => Array.from(String(value || '').replace(/[\x00-\x1f\x7f-\x9f]/g, '')).slice(0,n).join('');
    const writes = result.results.map(r => ({
      kind: r.kind, path: bounded(r.source ? r.source + ' → ' + r.target : r.target, 1024),
      status: r.status, elapsedMs: r.elapsedMs ?? null, detail: r.status === 'success' ? '' : bounded(r.message,600),
    }));
    message.steps = [...(message.steps || []), ...writes];
    const editFailure = result.results.find(r => r.kind === 'edit_text' && r.status === 'failed');
    const outcome = result.stopped ? (locale === 'zh' ? '已停止后续步骤。' : 'Remaining steps stopped.') : editFailure?.message || aiText(result.completed ? 'done' : 'partial');
    const warning = result.journalWarning ? (locale === 'zh' ? '磁盘记录未完整写入，请核对文件。' : 'The on-disk record is incomplete. Check the files.') + ' ' + result.journalWarning : '';
    addAiMessage(session, 'notice', [outcome, warning].filter(Boolean).join('\n'), { results: result.results, error: !result.completed || !!warning });
    if (!isTermTab(curTab()) && aiTabIsActive(session)) await refresh(true);
  } catch (error) {
    message.planState = 'discarded'; addAiMessage(session, 'notice', String(error), { error: true, omitHistory: true });
  } finally {
    session.running = false; session.revision++;
    if (typeof scheduleAiArchive === 'function') scheduleAiArchive(session);
    if (session.closed) aiSessions.delete(session.key);
    renderAiConversation(); updateAiComposer();
  }
}
async function stopAiFilePlan(messageId) {
  const session = aiCurrentSession(), message = session?.messages.find(m => m.id === messageId);
  if (message?.planState !== 'running' || !message.plan || message.stopRequested) return;
  message.stopRequested = true; session.revision++; renderAiConversation();
  try {
    if (!await invoke('ai_stop_file_execution', {id:message.plan.id})) message.stopRequested = false;
  } catch (error) {
    message.stopRequested = false; addAiMessage(session, 'notice', String(error), {error:true, omitHistory:true});
  } finally { session.revision++; if (aiCurrentSession() === session) renderAiConversation(); }
}

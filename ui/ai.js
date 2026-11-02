/* Each tab owns its conversation and permissions; memories live in its current folder. */
const AI_TEXT = {
  zh: {
    title: 'Agent 助手', caption: '技能 · 记忆 · 文件工作', close: '收起对话', settings: '接口设置', newChat: '新对话',
    float: '浮动对话', dock: '停靠到最右侧', remember: '存入记忆', memoryReview: '建议记住 · 待你确认', memorySave: '编辑并保存', memoryIgnore: '忽略', memorySaved: '已保存到记忆', memorySaving: '正在编辑…', memoryUsed: '已使用 {n} 条记忆', skillsUsed: '技能', contextPartial: '部分技能或记忆超出上下文上限',
    apiFormat: 'API 格式', formatHint: '选择服务实际支持的格式；可填基础地址或对应的完整请求地址。Anthropic 使用服务默认思考设置。', formatInvalid: 'API 格式无效，或完整地址与格式不匹配。', testApi: '测试 API', testRunning: '正在测试…', testCancel: '取消测试', testHint: '用当前表单发送一条简短测试消息，可能产生少量费用；不会发送文件、目录或聊天记录，也不会保存配置。', testSuccess: '测试成功 · 已收到有效文本回复', testFailed: '测试失败',
    endpoint: 'API 地址', model: '模型名称', key: 'API Key', save: '保存并返回', back: '返回对话',
    dialect: '推理参数协议', generic: '通用兼容（不发送推理参数）', reasoning: '思考强度', reasoningDefault: '服务默认', reasoningNone: '关闭思考', reasoningMinimal: '极低', reasoningLow: '低', reasoningMedium: '中', reasoningHigh: '高', reasoningXhigh: '极高', reasoningMax: '最高', reasoningHint: '强度越高可能耗时更长、消耗更多 Token。可用等级由具体模型决定；报不支持时请选择服务默认或通用兼容。', reasoningInvalid: '此接口模式不支持所选思考强度。', preset: '切换已保存模型', currentModel: '当前模型', modelSettings: '配置其他模型…', modelBusy: '文件操作执行期间不能切换模型。',
    settingsShort: '设置', settingsDescription: '配置你使用的模型服务，对所有文件夹生效。', connection: '连接模型', credentials: '访问凭据',
    optional: '可选', cancelSettings: '取消', savedState: '当前设置已保存', unsaved: '有未保存的更改', initialSettings: '填写接口地址和模型名称后保存',
    endpointRequired: '请输入 API 地址。', endpointInvalid: '请输入完整的网址，例如 https://api.example.com/v1。',
    endpointSecure: '远程接口需使用 HTTPS；HTTP 仅支持 localhost、127.0.0.1 或 ::1。', endpointParts: '地址不能包含用户名、密码、查询参数或 # 片段。',
    endpointLong: '接口地址过长，请使用 2048 字节以内的地址。', modelRequired: '请输入服务商提供的模型名称。', modelLong: '模型名称需在 256 字节以内。', keyInvalid: '密钥不能包含换行，且需在 4096 字节以内。',
    modelHint: '使用服务商列出的模型 ID，或本地已安装的模型名称。', keyOptionalHint: '服务需要认证时填写；本地免认证服务可以留空。',
    requestAddress: '请求将发送到', showKey: '显示密钥', hideKey: '隐藏密钥', sharing: '发送内容与操作范围', settingsFooter: '取消或按 Esc 不会保存修改。', invalidSettings: '请修正标出的设置后保存。',
    keyHint: '密钥仅保留在本次应用会话，不写入磁盘。', endpointHint: '远程使用 HTTPS，本机可使用 HTTP；下方显示实际请求地址。',
    privacy: '发送时会提供你的消息、最近对话、工作目录及最多 200 条目录元数据、最多 20 个选中项，以及本轮选择的技能说明和启用的相关记忆。不自动发送普通文件正文。',
    support: '支持问答、新建文件夹、移动、重命名、复制文件；不执行删除、文件夹复制或终端命令。',
    following: '当前标签页目录', terminal: '当前终端启动目录', permissions: '本标签页权限', readOnly: '只读', confirmMode: '确认后执行', autoMode: '自动执行（当前目录）',
    readOnlyHint: 'AI 仅分析和回答，不执行文件操作。', confirmHint: '每份文件操作计划经你核对确认后执行。', autoHint: '发送后可自动新建、移动、重命名和复制；仅限此目录，不覆盖、不删除。', modeChanged: '权限已更新，之前的待执行计划已失效。', memoryLocation: '目录记忆文件',
    noFolder: '先打开一个文件夹', noFolderHint: '在左侧选择本地文件夹，这里会成为它的对话空间。', remoteFolder: '远程 SSH 终端', remoteHint: '此连接通过终端管理远程主机。AI 文件助手仅用于本地文件标签，不会将本地记忆或文件操作用于远程会话。',
    welcome: '这个文件夹，有什么需要帮忙？', welcomeHint: '了解目录内容，讨论整理方式，或一起完成文件操作。',
    example1: '帮我概括这个文件夹的内容', example2: '给这个文件夹一些整理建议', example3: '帮我整理选中的文件',
    prompt: '询问这个文件夹，或描述你想做的事…', send: '发送', sending: '正在思考…', cancel: '停止',
    hint: 'Enter 发送 · Shift+Enter 换行', memory: '对话保留在本次运行中', selection: '本轮选中项', ignore: '忽略选择', include: '加入选择',
    you: '你', assistant: '文件夹助手', notice: '工作记录', configure: '先配置模型接口', missing: '请填写接口地址和模型名称。',
    configured: '接口设置已保存。', noModel: '未配置模型', cancelled: '本轮已停止；迟到回复不会成为可执行计划。',
    review: '待确认操作', confirmation: '我已核对源路径和目标路径', execute: '确认执行', discard: '放弃计划',
    executing: '正在执行…', done: '操作已完成', partial: '部分操作失败，后续步骤已停止；已完成步骤不会自动回滚。',
    superseded: '旧计划已失效，请查看最新回复。', discarded: '此计划未执行或未全部完成。',
    source: '源路径', target: '目标路径', mkdir: '新建文件夹', move: '移动', rename: '重命名', copy: '复制文件',
    success: '已完成', failed: '失败', skipped: '未执行', context: '基于 {n} 条目录信息', truncated: '目录信息超过上限，仅包含部分项目。',
    invalidScope: '回复的工作目录与当前会话不符，已丢弃此计划。', resize: '调整对话面板宽度',
  },
  en: {
    title: 'Agent assistant', caption: 'Skills · Memory · Files', close: 'Hide chat', settings: 'API settings', newChat: 'New chat',
    float: 'Float chat', dock: 'Dock on the right', remember: 'Save to memory', memoryReview: 'Suggested memory · Review first', memorySave: 'Edit and save', memoryIgnore: 'Dismiss', memorySaved: 'Saved to memory', memorySaving: 'Editing…', memoryUsed: '{n} memories used', skillsUsed: 'Skills', contextPartial: 'Some skills or memories exceeded the context limit',
    apiFormat: 'API format', formatHint: 'Match the service protocol. Enter a base URL or a complete request URL. Anthropic uses service-default reasoning.', formatInvalid: 'Invalid API format or mismatched endpoint.', testApi: 'Test API', testRunning: 'Testing…', testCancel: 'Cancel test', testHint: 'Send a short message using this form; a small charge may apply. No files, folders or chat history are sent, and settings are not saved.', testSuccess: 'Test passed · Received a valid text reply', testFailed: 'Test failed',
    endpoint: 'API endpoint', model: 'Model', key: 'API key', save: 'Save and return', back: 'Back to chat',
    dialect: 'Reasoning protocol', generic: 'Generic (omit reasoning parameters)', reasoning: 'Thinking effort', reasoningDefault: 'Service default', reasoningNone: 'Off', reasoningMinimal: 'Minimal', reasoningLow: 'Low', reasoningMedium: 'Medium', reasoningHigh: 'High', reasoningXhigh: 'Extra high', reasoningMax: 'Maximum', reasoningHint: 'Higher effort may take longer and use more tokens. Supported levels depend on the model; use Service default or Generic if your service rejects a level.', reasoningInvalid: 'This protocol does not support the selected effort.', preset: 'Switch saved model', currentModel: 'Current model', modelSettings: 'Configure another model…', modelBusy: 'Wait for the running file operation before switching models.',
    settingsShort: 'Settings', settingsDescription: 'Configure your model service. These settings apply to every folder.', connection: 'Model connection', credentials: 'Credentials',
    optional: 'Optional', cancelSettings: 'Cancel', savedState: 'Current settings are saved', unsaved: 'Unsaved changes', initialSettings: 'Enter an endpoint and model, then save',
    endpointRequired: 'Enter an API endpoint.', endpointInvalid: 'Enter a full URL, such as https://api.example.com/v1.',
    endpointSecure: 'Remote endpoints require HTTPS. HTTP is allowed only for localhost, 127.0.0.1 or ::1.', endpointParts: 'Do not include credentials, query parameters or a # fragment in the URL.',
    endpointLong: 'Keep the endpoint within 2048 bytes.', modelRequired: 'Enter the model name supplied by your service.', modelLong: 'Keep the model name within 256 bytes.', keyInvalid: 'The key must have no line breaks and be at most 4096 bytes.',
    modelHint: 'Use the model ID listed by your provider, or the name of an installed local model.', keyOptionalHint: 'Required when your service uses authentication; leave blank for a local service without authentication.',
    requestAddress: 'Requests will be sent to', showKey: 'Show key', hideKey: 'Hide key', sharing: 'Shared context and available actions', settingsFooter: 'Cancel or press Esc to discard changes.', invalidSettings: 'Correct the highlighted settings before saving.',
    keyHint: 'The key stays in this app session and is never written to disk.', endpointHint: 'HTTPS required except for localhost. The resolved request URL appears below.',
    privacy: 'Sending shares your message, recent conversation, working folder, up to 200 directory entries, up to 20 selected items, selected skill instructions and relevant enabled memories. Ordinary file contents are not uploaded automatically.',
    support: 'Ask questions, create folders, move, rename or copy files. No deletion, folder copying or terminal commands.',
    following: 'Current tab folder', terminal: 'Current terminal starting folder', permissions: 'Permissions for this tab', readOnly: 'Read-only', confirmMode: 'Ask before changes', autoMode: 'Auto in this folder',
    readOnlyHint: 'The AI can analyze and answer, but cannot run file operations.', confirmHint: 'Review and confirm each file operation plan before it runs.', autoHint: 'Sending may create, move, rename or copy within this folder. No overwrite or deletion.', modeChanged: 'Permissions updated. Previous pending plans have expired.', memoryLocation: 'Folder memory file',
    noFolder: 'Open a folder to begin', noFolderHint: 'Choose a local folder on the left to start its conversation.', remoteFolder: 'Remote SSH terminal', remoteHint: 'Manage this remote host in the terminal. The file assistant is for local folders; local memories and file operations are not applied to SSH sessions.',
    welcome: 'What can we do with this folder?', welcomeHint: 'Explore its contents, discuss organization, or complete file operations together.',
    example1: 'Summarize this folder', example2: 'Suggest ways to organize this folder', example3: 'Help organize the selected files',
    prompt: 'Ask about this folder, or describe a task…', send: 'Send', sending: 'Thinking…', cancel: 'Stop',
    hint: 'Enter to send · Shift+Enter for a new line', memory: 'Chats stay in this app session', selection: 'Selected for this message', ignore: 'Ignore selection', include: 'Include selection',
    you: 'You', assistant: 'Folder assistant', notice: 'Activity', configure: 'Configure a model first', missing: 'Enter an API endpoint and model.',
    configured: 'API settings saved.', noModel: 'No model configured', cancelled: 'Stopped. A late response cannot become an executable plan.',
    review: 'Review operations', confirmation: 'I checked the source and target paths', execute: 'Confirm and run', discard: 'Discard plan',
    executing: 'Running…', done: 'Operations completed', partial: 'An action failed. Later actions stopped; completed steps were not rolled back.',
    superseded: 'This plan expired. Review the latest reply.', discarded: 'This plan was not fully executed.',
    source: 'Source', target: 'Target', mkdir: 'Create folder', move: 'Move', rename: 'Rename', copy: 'Copy file',
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
function aiFormatOf(value) { return value.apiFormat || 'openai-completions'; }
function aiFormatSuffix(format) { return { 'openai-completions': '/chat/completions', 'openai-responses': '/responses', 'anthropic-messages': '/messages' }[format]; }
function aiDialectAllowed(format, dialect) { return format === 'anthropic-messages' ? !dialect || dialect === 'generic' : format === 'openai-responses' ? dialect !== 'deepseek' : true; }
let aiSettingsOpen = false, aiSettingsValidated = false, aiPaintIdentity = '', aiResize = null;
const aiKey = (path) => (path || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const aiChars = (text, max) => Array.from(String(text)).slice(0, max).join('');
function aiCurrentSession() { return aiSessions.get(aiCurrentKey) || null; }
function aiTabId(tab = curTab()) { return tab ? (tab.aiSessionId ||= crypto.randomUUID()) : ''; }
function aiSessionKeyFor(root, tab = curTab()) { return root ? aiTabId(tab) + '::' + aiKey(root) : ''; }
function aiTabIsActive(session) { return !!session && session.tab === curTab() && aiKey(aiBrowsingFolder()) === aiKey(session.root); }
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
function applyAiRuntimeSettings(settings, key = aiSessionKey, remember = false) {
  if (aiAnyExecution()) { toast(aiText('modelBusy'), true); return false; }
  const next = aiPublicSettings(settings);
  const changed = JSON.stringify(next) !== JSON.stringify(aiPublicSettings(aiSettings)) || key !== aiSessionKey;
  aiSettings = next; aiSessionKey = key; store.set('aiSettings', next);
  if (remember) {
    aiModelPresets = [next, ...aiModelPresets.filter((p) => p && !(p.endpoint === next.endpoint && aiFormatOf(p) === aiFormatOf(next) && p.model === next.model)).map(aiPublicSettings)].slice(0, 12);
    store.set('aiModelPresets', aiModelPresets);
  }
  if (changed) for (const session of aiSessions.values()) { cancelAiRequest(session); discardSessionPlans(session); }
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
  // Only models at the current endpoint share its session credential.
  if (!preset || (preset.endpoint !== aiSettings.endpoint || aiFormatOf(preset) !== aiFormatOf(aiSettings))) return false;
  return applyAiRuntimeSettings(preset);
}
function aiBrowsingFolder() {
  if (curTab()?.connection === 'ssh' || curTab()?.kind === 'browser') return null;
  const path = isTermTab(curTab()) ? curTab().cwd : state.path;
  return path && /^[a-z]:[\\/]/i.test(path) ? path : null;
}
function aiSessionFor(root) {
  if (!root) return null;
  const key = aiSessionKeyFor(root);
  let session = aiSessions.get(key);
  if (!session) {
    session = { key, root, tab: curTab(), permissionMode: 'confirm', activation: 0, messages: [], draft: '', requestId: null, running: false, revision: 0, includeSelection: true };
    aiSessions.set(key, session);
  } else { aiSessions.delete(key); aiSessions.set(key, session); }
  while (aiSessions.size > 24) {
    const victim = [...aiSessions.values()].find((s) => s !== session && !s.running && !s.requestId);
    if (!victim) break;
    discardSessionPlans(victim); aiSessions.delete(victim.key);
  }
  return session;
}
function disposeAiTab(tab) {
  for (const session of aiSessions.values()) {
    if (session.tab !== tab) continue;
    session.closed = true; session.activation++;
    cancelAiRequest(session, false); discardSessionPlans(session);
    if (!session.running) aiSessions.delete(session.key);
  }
}
function setAiPermissionMode(mode) {
  const session = aiCurrentSession();
  if (!session || session.running || !['read-only', 'confirm', 'auto'].includes(mode) || session.permissionMode === mode) return;
  cancelAiRequest(session, false); discardSessionPlans(session);
  session.permissionMode = mode; session.activation++; session.revision++;
  renderAiConversation(); updateAiComposer();
  if (typeof toast === 'function') toast(aiText('modeChanged'));
}
function addAiMessage(session, role, text, extra = {}) {
  const message = { id: crypto.randomUUID(), role, text, ...extra };
  session.messages.push(message);
  if (session.messages.length > 60) session.messages.splice(0, session.messages.length - 60);
  if (session.summarizedIds) { const ids = new Set(session.messages.map((item) => item.id)); session.summarizedIds = new Set([...session.summarizedIds].filter((id) => ids.has(id))); }
  session.revision++;
  return message;
}
function discardSessionPlans(session, status = 'superseded') {
  for (const message of session.messages) {
    if (message.plan && message.planState === 'pending') {
      invoke('ai_discard', { id: message.plan.id }).catch(() => {});
      message.planState = status; session.revision++;
    }
  }
}
function aiHistory(session) {
  if (typeof aiMemoryHistory === 'function') return aiMemoryHistory(session);
  const history = [];
  let length = 0;
  for (const message of [...session.messages].reverse()) {
    if (message.omitHistory || !message.text) continue;
    let content = message.text;
    if (message.plan) content += '\n[Plan status: ' + message.planState + '; a proposed plan is not proof of execution.]\n' + JSON.stringify(message.plan.actions);
    if (message.results) content += '\n[Local execution results]\n' + JSON.stringify(message.results);
    const item = { role: message.role === 'assistant' ? 'assistant' : 'user', content: aiChars(content, Math.min(8000, 24000 - length)) };
    if (!item.content) break;
    history.unshift(item); length += Array.from(item.content).length;
    if (history.length >= 16 || length >= 24000) break;
  }
  return history;
}
function aiSelectedPaths(session) {
  if (!session || !aiTabIsActive(session) || isTermTab(curTab()) || !state.path || state.loading) return [];
  const current = aiKey(state.path), root = aiKey(session.root);
  if (current !== root && !current.startsWith(root + '\\')) return [];
  const base = state.path.replace(/\//g, '\\').replace(/\\+$/, '');
  const prefix = current === root ? '' : base.slice(root.length + 1) + '\\';
  return (state.entries || []).filter((entry) => state.selection.has(entry.name) && !entry.isReparse).slice(0, 20).map((entry) => prefix + entry.name);
}

function initAiAssistant() {
  if (aiPanel) return;
  aiPanel = document.createElement('aside'); aiPanel.id = 'aiPanel';
  aiPanel.setAttribute('aria-label', aiText('title'));
  aiPanel.innerHTML = `<div class="ai-resize-handle" tabindex="0" role="separator" aria-orientation="vertical" data-ai-resize></div>
    <header class="ai-chat-header"><div class="ai-chat-brand"><span class="ai-mark">✦</span><div><strong data-ai-text="title"></strong><small id="aiPanelStatus" data-ai-text="caption"></small></div></div><div class="ai-header-actions"><button class="ibtn" data-ai-action="new" data-ai-title="newChat">${IC.plus}</button><button class="ibtn ai-settings-entry" data-ai-action="settings" data-ai-title="settings" aria-haspopup="dialog" aria-controls="aiSettingsPanel"><span aria-hidden="true">⚙</span><span data-ai-text="settingsShort"></span></button><button class="ibtn" data-ai-action="float" data-ai-title="float" aria-pressed="false">⤢</button><button class="ibtn" data-ai-action="close" data-ai-title="close">${IC.x}</button></div></header>
    <section class="ai-folder-context">${IC.folderS}<div class="ai-folder-copy"><span id="aiScopeMode"></span><strong id="aiFolderName"></strong><small id="aiFolderPath"></small><small id="aiMemoryPath"></small></div></section>
    <section id="aiAgentContext" class="ai-agent-context" aria-live="polite"></section>
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
          </section>
          <section class="ai-settings-group"><h3><span>02</span><span data-ai-text="credentials"></span></h3><label for="aiKey"><span data-ai-text="key"></span><span class="ai-optional" data-ai-text="optional"></span></label><div class="ai-key-field"><input id="aiKey" type="password" autocomplete="off" spellcheck="false" aria-describedby="aiKeyHint aiKeyError"><button type="button" class="ai-link" data-ai-action="show-key" aria-pressed="false" data-ai-text="showKey"></button></div><small data-ai-text="keyOptionalHint"></small><small id="aiKeyHint" class="ai-key-hint" data-ai-text="keyHint"></small><p id="aiKeyError" class="ai-field-error" hidden></p></section>
          <section class="ai-settings-group ai-api-test"><button type="button" class="ai-secondary" data-ai-action="test-api" data-ai-text="testApi"></button><button type="button" class="ai-link" data-ai-action="cancel-test" data-ai-text="testCancel" hidden></button><small data-ai-text="testHint"></small><p id="aiApiTestStatus" role="status" aria-live="polite"></p></section>
          <details class="ai-settings-details"><summary data-ai-text="sharing"></summary><p data-ai-text="privacy"></p><p data-ai-text="support"></p></details>
        </div>
        <footer class="ai-settings-footer"><div><div id="aiSettingsStatus" role="status" aria-live="polite"></div><small data-ai-text="settingsFooter"></small></div><div class="ai-settings-actions"><button type="button" class="ai-secondary" data-ai-action="cancel-settings" data-ai-text="cancelSettings"></button><button type="submit" class="ai-primary" data-ai-action="save-settings" data-ai-text="save"></button></div></footer>
      </form>
    </dialog>
    <div id="aiMessages" class="ai-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
    <footer class="ai-composer"><div id="aiContextMeter" class="ai-context-meter"></div><div id="aiSelectionContext" class="ai-selection-context"></div><textarea id="aiPrompt" maxlength="4000" rows="2"></textarea><div class="ai-permissions"><label for="aiPermissionMode" data-ai-text="permissions"></label><select id="aiPermissionMode" aria-describedby="aiPermissionHint"><option value="read-only" data-ai-text="readOnly"></option><option value="confirm" data-ai-text="confirmMode"></option><option value="auto" data-ai-text="autoMode"></option></select><small id="aiPermissionHint"></small></div><div class="ai-composer-toolbar"><span id="aiModelLabel"></span><button class="ai-secondary hidden" data-ai-action="cancel" data-ai-text="cancel"></button><button class="ai-primary" data-ai-action="send" data-ai-text="send"></button></div><small class="ai-composer-note" id="aiComposerNote"></small></footer>`;
  $('agentDock').appendChild(aiPanel);
  const runtimeControls = document.createElement('div'); runtimeControls.className = 'ai-runtime-controls';
  runtimeControls.innerHTML = '<select id="aiModelPreset"></select><select id="aiQuickEffort"></select>';
  aiPanel.querySelector('.ai-composer-toolbar').before(runtimeControls);
  $('aiApiFormat').addEventListener('change', () => { refreshAiEffortField(); updateAiSettingsForm(); });
  $('aiApiDialect').addEventListener('change', () => { refreshAiEffortField(); updateAiSettingsForm(); });
  $('aiReasoningEffort').addEventListener('change', updateAiSettingsForm);
  $('aiQuickEffort').addEventListener('change', (event) => changeAiQuickEffort(event.target.value));
  $('aiModelPreset').addEventListener('change', (event) => changeAiModelPreset(event.target.value));
  if (typeof initAgentLayout === 'function') initAgentLayout(aiPanel);
  if (typeof initAgentProfile === 'function') initAgentProfile();
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
    else if (action === 'execute') executeAiPlan(button.dataset.message);
    else if (action === 'discard') { const session = aiCurrentSession(); if (session) { discardSessionPlans(session, 'discarded'); renderAiConversation(); } }
    else if (action === 'selection') { const session = aiCurrentSession(); if (session) { session.includeSelection = !session.includeSelection; renderAiSelection(); } }
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
  const root = aiBrowsingFolder(), key = aiSessionKeyFor(root), previous = aiCurrentSession();
  if (key !== aiCurrentKey) {
    if (previous) { previous.draft = $('aiPrompt').value; previous.activation++; }
    aiCurrentKey = key;
    const session = root ? aiSessionFor(root) : null;
    $('aiPrompt').value = session?.draft || ''; aiPaintIdentity = '';
  }
  aiPanel.classList.toggle('hidden', !aiPanelOpen); document.body.classList.toggle('ai-panel-open', aiPanelOpen);
  aiPanel.querySelectorAll('[data-ai-text]').forEach((el) => { el.textContent = aiText(el.dataset.aiText); });
  aiPanel.querySelectorAll('[data-ai-title]').forEach((el) => { el.title = aiText(el.dataset.aiTitle); el.setAttribute('aria-label', el.title); });
  aiPanel.querySelector('[data-ai-resize]').setAttribute('aria-label', aiText('resize'));
  const remote = curTab()?.connection === 'ssh';
  $('aiPrompt').placeholder = aiText(root ? 'prompt' : remote ? 'remoteFolder' : 'noFolder'); $('aiPrompt').setAttribute('aria-label', aiText('prompt'));
  $('aiFolderName').textContent = root ? basename(root) || root : aiText(remote ? 'remoteFolder' : 'noFolder');
  $('aiFolderPath').textContent = root || aiText(remote ? 'remoteHint' : 'noFolderHint'); $('aiFolderPath').title = root || '';
  $('aiScopeMode').textContent = remote ? 'SSH' : aiText(isTermTab(curTab()) ? 'terminal' : 'following');
  $('aiAgentContext')?.classList.toggle('hidden', remote);
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
  const dirty = JSON.stringify(aiPublicSettings(value)) !== JSON.stringify(aiPublicSettings(aiSettings)) || value.key !== aiSessionKey;
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
  aiPanel.querySelector('[data-ai-action="save-settings"]').disabled = aiAnyExecution() || (!dirty && !!aiSettings.endpoint && !!aiSettings.model);
  aiPanel.querySelector('[data-ai-action="show-key"]').textContent = aiText($('aiKey').type === 'password' ? 'showKey' : 'hideKey');
  return validation;
}
function toggleAiSettings(open = !aiSettingsOpen) {
  if (open === aiSettingsOpen) return;
  resetAiConnectionTest();
  aiSettingsOpen = open; aiSettingsValidated = false;
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
  if (!applyAiRuntimeSettings(value, value.key, true)) return false;
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
  if (!session || session.running) return;
  cancelAiRequest(session, false); discardSessionPlans(session);
  aiSessions.delete(session.key); aiSessionFor(session.root).permissionMode = session.permissionMode;
  $('aiPrompt').value = ''; aiPaintIdentity = ''; renderAiConversation(); updateAiComposer();
}
function renderAiSelection() {
  if (!aiPanel) return;
  const session = aiCurrentSession(), selected = aiSelectedPaths(session);
  const html = selected.length ? `<span>${esc(aiText('selection'))} · ${selected.length}${state.selection.size > 20 ? '+' : ''}</span><button class="ai-link" data-ai-action="selection">${esc(aiText(session.includeSelection ? 'ignore' : 'include'))}</button><div class="ai-selection-chips${session.includeSelection ? '' : ' ignored'}">${selected.slice(0, 3).map((name) => `<span title="${esc(name)}">${esc(name)}</span>`).join('')}${selected.length > 3 ? `<span>+${selected.length - 3}</span>` : ''}</div>` : '';
  if ($('aiSelectionContext').innerHTML !== html) $('aiSelectionContext').innerHTML = html;
}
function updateAiComposer() {
  if (!aiPanel) return;
  const session = aiCurrentSession(), busy = !!(session?.requestId || session?.running);
  $('aiPrompt').disabled = !session || session.running;
  const send = aiPanel.querySelector('[data-ai-action="send"]'); send.disabled = !session || busy; send.textContent = aiText(session?.running ? 'executing' : 'send');
  aiPanel.querySelector('[data-ai-action="cancel"]').classList.toggle('hidden', !session?.requestId);
  aiPanel.querySelector('[data-ai-action="new"]').disabled = !session || session.running;
  $('aiModelLabel').textContent = aiSettings.model || aiText('noModel'); $('aiModelLabel').title = aiSettings.endpoint || aiText('configure');
  const effort = $('aiQuickEffort'), preset = $('aiModelPreset');
  effort.innerHTML = aiEffortOptions(aiSettings.apiDialect); effort.value = aiSettings.reasoningEffort || 'default'; effort.disabled = aiAnyExecution() || !aiSettings.apiDialect || aiSettings.apiDialect === 'generic'; effort.setAttribute('aria-label', aiText('reasoning')); effort.title = aiText('reasoningHint');
  preset.innerHTML = `<option value="current">${esc(aiSettings.model || aiText('noModel'))}</option>` + aiModelPresets.map((p, index) => p.endpoint === aiSettings.endpoint && aiFormatOf(p) === aiFormatOf(aiSettings) && p.model !== aiSettings.model ? `<option value="${index}">${esc(p.model)}</option>` : '').join('') + `<option value="settings">${esc(aiText('modelSettings'))}</option>`;
  preset.value = 'current'; preset.disabled = aiAnyExecution(); preset.setAttribute('aria-label', aiText('preset'));
  if (typeof renderAiContextMeter === 'function') renderAiContextMeter();
  $('aiComposerNote').textContent = aiText('hint') + ' · ' + aiText('memory');
  $('aiPermissionMode').value = session?.permissionMode || 'confirm';
  $('aiPermissionMode').disabled = !session || session.running;
  $('aiPermissionHint').textContent = aiText(session?.permissionMode === 'auto' ? 'autoHint' : session?.permissionMode === 'read-only' ? 'readOnlyHint' : 'confirmHint');
  $('aiPermissionHint').classList.toggle('is-auto', session?.permissionMode === 'auto');
  aiPanel.querySelector('.ai-permissions')?.classList.toggle('hidden', curTab()?.connection === 'ssh');
}
function aiActionMarkup(action, result) {
  return `<div class="ai-action"><div class="ai-action-title"><strong>${esc(aiText(action.kind))}</strong>${result ? `<span class="ai-result ${esc(result.status)}">${esc(aiText(result.status))}</span>` : ''}</div>${action.source ? `<div class="ai-path"><span>${aiText('source')}</span><code>${esc(action.source)}</code></div>` : ''}<div class="ai-path"><span>${aiText('target')}</span><code>${esc(action.target)}</code></div>${result?.message ? `<small class="ai-action-message">${esc(result.message)}</small>` : ''}</div>`;
}
function aiMessageMarkup(message) {
  let card = '';
  if (message.plan?.actions.length) {
    const pending = message.planState === 'pending';
    card = `<details class="ai-plan-card" data-ai-plan-details="${message.id}" ${message.expanded ? 'open' : ''}><summary>${esc(aiText(pending ? 'review' : message.planState === 'running' ? 'executing' : message.planState === 'done' ? 'done' : message.planState === 'discarded' ? 'discarded' : 'superseded'))} · ${message.plan.actions.length}</summary><div class="ai-plan-actions">${message.plan.actions.map((action) => aiActionMarkup(action)).join('')}</div>${pending ? `<div class="ai-confirmation"><label><input type="checkbox" data-ai-confirm="${message.id}"><span>${esc(aiText('confirmation'))}</span></label><div><button class="ai-primary" data-ai-action="execute" data-message="${message.id}" disabled>${esc(aiText('execute'))}</button><button class="ai-secondary" data-ai-action="discard">${esc(aiText('discard'))}</button></div></div>` : ''}</details>`;
  }
  if (message.results) card += `<details class="ai-plan-card"><summary>${esc(aiText('notice'))} · ${message.results.length}</summary>${message.results.map((result) => aiActionMarkup(result, result)).join('')}</details>`;
  const suggestions = (message.memorySuggestions || []).map((suggestion, index) => suggestion.status === 'dismissed' ? '' : `<div class="ai-memory-suggestion"><small>${esc(aiText(suggestion.status === 'saved' ? 'memorySaved' : 'memoryReview'))}</small><p>${esc(suggestion.content)}</p>${suggestion.status !== 'saved' ? `<div><button type="button" class="ai-link" data-ai-action="memory-save" data-message="${message.id}" data-index="${index}" ${message.memoryEditing ? 'disabled' : ''}>${esc(aiText(message.memoryEditing ? 'memorySaving' : 'memorySave'))}</button><button type="button" class="ai-link" data-ai-action="memory-ignore" data-message="${message.id}" data-index="${index}" ${message.memoryEditing ? 'disabled' : ''}>${esc(aiText('memoryIgnore'))}</button></div>` : ''}</div>`).join('');
  const used = [message.appliedSkills?.length ? aiText('skillsUsed') + ' · ' + message.appliedSkills.map((skill) => skill.name).join(' / ') : '', message.memoryCount ? aiText('memoryUsed').replace('{n}', message.memoryCount) : '', message.agentContextTruncated ? aiText('contextPartial') : ''].filter(Boolean).join(' · ');
  const remember = !message.error && ['user', 'assistant'].includes(message.role) && typeof saveAgentSuggestedMemory === 'function' ? `<button type="button" class="ai-link ai-message-remember" data-ai-action="remember" data-message="${message.id}" ${message.memoryEditing ? 'disabled' : ''}>${esc(aiText('remember'))}</button>` : '';
  return `<article class="ai-message ${message.role}${message.error ? ' is-error' : ''}" data-ai-message="${message.id}"><div class="ai-message-label">${esc(aiText(message.role === 'user' ? 'you' : message.role === 'assistant' ? 'assistant' : 'notice'))}</div><div class="ai-message-body">${esc(message.text)}</div>${card}${suggestions}${message.contextCount != null ? `<small class="ai-message-meta">${esc(aiText('context').replace('{n}', message.contextCount))}${message.contextTruncated ? ' · ' + esc(aiText('truncated')) : ''}</small>` : ''}${used ? `<small class="ai-message-meta ai-context-used">${esc(used)}</small>` : ''}${remember}</article>`;
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
function renderAiConversation() {
  if (!aiPanel) return;
  const session = aiCurrentSession(), remote = curTab()?.connection === 'ssh', identity = [aiCurrentKey, remote, locale, session?.revision, session?.requestId, session?.running, aiAnyExecution()].join('|');
  if (identity === aiPaintIdentity) return;
  aiPaintIdentity = identity;
  const messages = $('aiMessages'), nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
  messages.innerHTML = session?.messages.length ? session.messages.map(aiMessageMarkup).join('') : `<div class="ai-chat-empty"><span class="ai-empty-mark">✦</span><h3>${esc(aiText(session ? 'welcome' : remote ? 'remoteFolder' : 'noFolder'))}</h3><p>${esc(aiText(session ? 'welcomeHint' : remote ? 'remoteHint' : 'noFolderHint'))}</p>${session ? `<div class="ai-suggestions">${['example1', 'example2', 'example3'].map((key) => `<button data-ai-action="example" data-example="${key}">${esc(aiText(key))}</button>`).join('')}</div>` : ''}${!remote && (!aiSettings.endpoint || !aiSettings.model) ? `<button class="ai-link" data-ai-action="settings">${esc(aiText('configure'))}</button>` : ''}</div>`;
  if (session?.requestId) messages.innerHTML += `<div class="ai-thinking" role="status">✦ ${esc(aiText('sending'))}</div>`;
  if (nearBottom || session?.messages.at(-1)?.role === 'user') messages.scrollTop = messages.scrollHeight;
}

async function sendAiMessage() {
  const session = aiCurrentSession();
  if (!session || !aiTabIsActive(session) || session.requestId || session.running) return;
  const prompt = $('aiPrompt').value.trim();
  if (!prompt) return;
  if (!aiSettings.endpoint || !aiSettings.model) { toggleAiSettings(true); $('aiSettingsStatus').textContent = aiText('missing'); return; }
  discardSessionPlans(session);
  const previousMessages = session.messages.slice(), selection = session.includeSelection ? aiSelectedPaths(session) : [];
  addAiMessage(session, 'user', prompt);
  session.draft = ''; $('aiPrompt').value = '';
  const requestId = crypto.randomUUID(), permissionMode = session.permissionMode, activation = session.activation; session.requestId = requestId;
  renderAiConversation(); updateAiComposer();
  try {
    const context = typeof getAgentRequestContext === 'function' ? await getAgentRequestContext(session.root) : {};
    if (session.requestId !== requestId || aiSessions.get(session.key) !== session) return;
    if (typeof prepareAiMemory === 'function') {
      try { await prepareAiMemory(session, requestId, previousMessages); }
      catch (error) { if (session.requestId === requestId) { session.memoryWarning = String(error); addAiMessage(session, 'notice', aiText('contextPartial') + ': ' + String(error), { omitHistory: true, error: true }); } }
    }
    if (session.requestId !== requestId || aiSessions.get(session.key) !== session) return;
    const history = aiHistory({ ...session, messages: previousMessages });
    const plan = await invoke('ai_plan', { request: { requestId, ...aiSettings, apiKey: aiSessionKey, root: session.root, prompt, history, selection, ...(session.conversationSummary ? { conversationSummary: session.conversationSummary } : {}),
      skillIds: context.skillIds || [], useMemory: !!context.useMemory, learnMemory: !!context.learnMemory, permissionMode,
    } });
    if (session.requestId !== requestId || aiSessions.get(session.key) !== session) { invoke('ai_discard', { id: plan.id }).catch(() => {}); return; }
    if (aiKey(plan.root) !== aiKey(session.root) || plan.permissionMode !== permissionMode || (permissionMode === 'read-only' && plan.actions.length)) { invoke('ai_discard', { id: plan.id }).catch(() => {}); throw new Error(aiText('invalidScope')); }
    const message = addAiMessage(session, 'assistant', plan.summary, { plan: plan.actions.length ? plan : null, planState: plan.actions.length ? 'pending' : null, contextCount: plan.contextCount, contextTruncated: plan.contextTruncated,
      appliedSkills: plan.appliedSkills || [], memoryCount: plan.memoryCount || 0, agentContextTruncated: !!plan.agentContextTruncated,
      memorySuggestions: (context.learnMemory ? plan.memorySuggestions || [] : []).filter((value) => typeof value === 'string' && value.trim()).slice(0, 3).map((content) => ({ content: aiChars(content, 600), status: 'pending' })),
    });
    if (permissionMode === 'auto' && session.permissionMode === permissionMode && activation === session.activation && aiTabIsActive(session) && plan.actions.length) {
      session.requestId = null;
      await executeAiPlan(message.id, true);
    }
  } catch (error) {
    if (session.requestId === requestId && aiSessions.get(session.key) === session) addAiMessage(session, 'notice', String(error), { error: true, omitHistory: true });
  } finally {
    if (session.requestId === requestId) session.requestId = null;
    if (aiCurrentSession() === session) { renderAiConversation(); updateAiComposer(); }
  }
}
function cancelAiRequest(session = aiCurrentSession(), notify = true) {
  const requestId = session?.requestId;
  if (!requestId) return;
  session.requestId = null; invoke('ai_cancel', { requestId }).catch(() => {});
  if (notify) addAiMessage(session, 'notice', aiText('cancelled'), { omitHistory: true });
  if (aiCurrentSession() === session) { renderAiConversation(); updateAiComposer(); }
}
async function executeAiPlan(messageId, automatic = false) {
  const session = aiCurrentSession(), message = session?.messages.find((m) => m.id === messageId);
  if (!session || !aiTabIsActive(session) || session.permissionMode === 'read-only' || !message?.plan || message.planState !== 'pending' || session.requestId || aiAnyExecution()) return;
  if (automatic ? session.permissionMode !== 'auto' : !aiPanel.querySelector(`[data-ai-confirm="${messageId}"]`)?.checked) return;
  if (aiKey(message.plan.root) !== aiKey(session.root) || message.plan.permissionMode !== session.permissionMode) return;
  const plan = message.plan; message.planState = 'running'; session.running = true; session.revision++;
  renderAiConversation(); updateAiComposer();
  try {
    const result = await invoke('ai_execute', { id: plan.id, approved: !automatic, permissionMode: session.permissionMode });
    message.planState = result.completed ? 'done' : 'discarded';
    addAiMessage(session, 'notice', aiText(result.completed ? 'done' : 'partial'), { results: result.results, error: !result.completed });
    if (!isTermTab(curTab()) && aiTabIsActive(session)) await refresh(true);
  } catch (error) {
    message.planState = 'discarded'; addAiMessage(session, 'notice', String(error), { error: true, omitHistory: true });
  } finally {
    session.running = false; session.revision++;
    if (session.closed) aiSessions.delete(session.key);
    renderAiConversation(); updateAiComposer();
  }
}

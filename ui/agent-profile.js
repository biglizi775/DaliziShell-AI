/* Skills are shared locally; reviewed memories belong to the active folder's file. */
const AGENT_PROFILE_TEXT = {
  zh: { title: '智能体工作方式', intro: '管理可复用技能、长期偏好和学习建议。', skills: '技能', memories: '记忆', learning: '学习模式', close: '完成', loading: '正在读取本地配置…', failed: '读取配置失败', retry: '重试', noFolder: '未选择工作目录', scope: '当前管理目录', skillHint: '导入本地 SKILL.md 或包含它的文件夹。启用的技能会随下一条消息发送给模型，最多同时启用 4 个。', skillPath: 'SKILL.md 文件或技能文件夹路径', choose: '选择文件', import: '导入技能', importEmpty: '请先选择技能文件或填写路径。', skillEmpty: '还没有技能', skillEmptyHint: '可以导入自己的整理规范、命名规则或重复工作流程。', enabled: '已启用', enable: '用于对话', remove: '移除', view: '查看说明', hide: '收起说明', skillLimit: '最多同时启用 4 个技能，请先关闭一个。', skillScope: '导入保存本地副本；只使用说明，不运行附带脚本。同一路径重新导入可更新。', memoryHint: '已保存的偏好会用于后续对话。当前目录记忆只在这个目录生效，全局记忆适用于所有目录。', memoryEmpty: '还没有已保存的记忆', memoryEmptyHint: '记录你的命名习惯、整理规则或项目约定，也可从对话中存入。', add: '添加记忆', edit: '编辑', delete: '删除', global: '所有目录', folder: '仅当前目录', disabled: '已停用', memoryUse: '在对话中使用记忆', memoryUseHint: '关闭后保留已保存内容，下一轮不附加记忆。', learn: '从对话中提出记忆建议', learnHint: '模型可以提炼你的偏好。建议只出现在对话中，经过你编辑并保存后才成为长期记忆。', learnScope: '这是可管理的上下文记忆，不会训练或修改模型参数。', local: '技能与记忆保存在本机，重启后继续可用。发送消息时会将启用的内容发给你配置的模型服务。API Key 和完整对话不写入此配置。', storage: '本地存储位置', saved: '已保存', imported: '技能已导入，可勾选用于对话。', removed: '已移除', updated: '配置已更新', content: '记忆内容', memoryTitle: '保存记忆', memoryEdit: '编辑记忆', memoryLabel: '生效范围', memoryRoot: '绑定工作目录', memoryPlaceholder: '例如：整理项目文件时，日期统一使用 YYYY-MM-DD。', memoryEmptyError: '请输入需要记住的内容。', memoryLong: '记忆最多 2000 个字符，请精简后保存。', folderRequired: '请先打开一个本地文件夹，或选择“所有目录”。', memoryFooter: '保存后用于未来对话，可随时在记忆中修改或删除。', cancel: '取消', save: '保存记忆', pending: '正在保存…', perFolder: '目录', globalShort: '全局', activeSkills: '技能', activeMemories: '记忆', learningOn: '学习已开启', memoryOff: '记忆已关闭', profileError: '配置不可用', refreshed: '已重新读取', emptyActive: '未启用技能', useMemory: '启用此记忆', duplicate: '记忆已保存', readOnlyWarning: '本地配置需要处理，请先查看提示。' },
  en: { title: 'Agent workspace', intro: 'Manage reusable skills, lasting preferences and learning suggestions.', skills: 'Skills', memories: 'Memory', learning: 'Learning', close: 'Done', loading: 'Loading local configuration…', failed: 'Unable to load configuration', retry: 'Retry', noFolder: 'No working folder', scope: 'Managing folder', skillHint: 'Import a local SKILL.md or its folder. Enabled instructions are sent with your next message. Enable up to 4 skills at a time.', skillPath: 'Path to SKILL.md or a skill folder', choose: 'Browse', import: 'Import skill', importEmpty: 'Choose a skill file or enter its path first.', skillEmpty: 'No skills yet', skillEmptyHint: 'Import your organization rules, naming conventions or reusable workflows.', enabled: 'Enabled', enable: 'Use in chat', remove: 'Remove', view: 'Read instructions', hide: 'Hide instructions', skillLimit: 'Enable up to 4 skills. Turn one off first.', skillScope: 'Imports save a local copy of the instructions. Attached scripts are not run. Import the same path again to update it.', memoryHint: 'Saved preferences guide future chats. Folder memories apply only to this folder; global memories apply everywhere.', memoryEmpty: 'No saved memories yet', memoryEmptyHint: 'Save naming habits, organization rules or project conventions. You can also save a message from chat.', add: 'Add memory', edit: 'Edit', delete: 'Delete', global: 'All folders', folder: 'This folder only', disabled: 'Disabled', memoryUse: 'Use memories in chat', memoryUseHint: 'Turning this off preserves saved memories and omits them from future requests.', learn: 'Suggest memories from conversations', learnHint: 'The model can suggest lasting preferences. Suggestions appear in chat and become memories only after you review and save them.', learnScope: 'This is editable context memory. It does not train or change model parameters.', local: 'Skills and memories are stored locally and survive restarts. Enabled content is shared with your configured model when you send a message. API keys and full conversations are not stored here.', storage: 'Local storage', saved: 'Saved', imported: 'Skill imported. Enable it to use in chat.', removed: 'Removed', updated: 'Configuration updated', content: 'Memory content', memoryTitle: 'Save memory', memoryEdit: 'Edit memory', memoryLabel: 'Applies to', memoryRoot: 'Bound working folder', memoryPlaceholder: 'For example: Use YYYY-MM-DD dates when organizing project files.', memoryEmptyError: 'Enter what you want to remember.', memoryLong: 'Keep each memory within 2000 characters.', folderRequired: 'Open a local folder first, or choose All folders.', memoryFooter: 'Saved memories guide future chats. You can edit or delete them at any time.', cancel: 'Cancel', save: 'Save memory', pending: 'Saving…', perFolder: 'Folder', globalShort: 'Global', activeSkills: 'Skills', activeMemories: 'Memories', learningOn: 'Learning on', memoryOff: 'Memory off', profileError: 'Configuration unavailable', refreshed: 'Reloaded', emptyActive: 'No active skills', useMemory: 'Enable this memory', duplicate: 'Memory saved', readOnlyWarning: 'Review the local configuration warning before continuing.' },
};
const agentProfileText = (key) => AGENT_PROFILE_TEXT[locale === 'en' ? 'en' : 'zh'][key] || key;
AGENT_PROFILE_TEXT.zh.refresh = '刷新'; AGENT_PROFILE_TEXT.en.refresh = 'Refresh';
Object.assign(AGENT_PROFILE_TEXT.zh, {
  memoryHint: '记忆写入当前标签页目录下的 .dalizi/agent-memory.json，仅在这个目录使用。打开目录或查看设置不会创建文件。',
  memoryFooter: '点击保存才会写入下方目录的记忆文件，可随时修改或删除。',
  folderRequired: '请先在标签页中打开一个本地文件夹。', memoryStorage: '此目录的记忆文件', skillStorage: '全局技能与开关配置',
  memoryUseHint: '关闭后保留各目录的记忆文件，下一轮不附加记忆。此开关对所有标签页生效。',
  learnHint: '模型可以从对话中提炼偏好。建议经你核对并保存后，写入本次对话所属目录的记忆文件。',
  local: '记忆随目录保存在 .dalizi/agent-memory.json；技能和通用开关单独保存。发送消息时会将启用内容发给你配置的模型服务，API Key 和完整对话不写入记忆文件。',
  legacyTitle: '旧版记忆', legacyHint: '旧记忆不会自动用于当前对话。选择要复制的内容，再点击“复制所选到此目录”；原有数据会保留。',
  selectAll: '全选可复制项', selectNone: '取消全选', migrate: '复制所选到此目录', migrated: '旧记忆已复制到当前目录，原数据保留。', legacyCopied: '已在此目录', selectLegacy: '请先选择要复制的旧记忆。',
  noMemoryFile: '打开本地文件夹后显示记忆文件位置', folderFixed: '固定为本次对话所属目录',
  memoryUnavailable: '目录记忆读取失败', memoryErrorHint: '原文件保留。修复文件后点击刷新，或关闭“在对话中使用记忆”继续使用技能和普通对话。',
});
Object.assign(AGENT_PROFILE_TEXT.en, {
  memoryHint: 'Memories are stored in .dalizi/agent-memory.json inside this tab’s folder and used only there. Opening a folder or these settings does not create files.',
  memoryFooter: 'Save writes to the memory file in the folder shown below. You can edit or delete it later.',
  folderRequired: 'Open a local folder in a tab first.', memoryStorage: 'Memory file in this folder', skillStorage: 'Global skills and preference settings',
  memoryUseHint: 'Turning this off preserves each folder’s memory file and omits memories from future requests. This switch applies to all tabs.',
  learnHint: 'The model can suggest lasting preferences. After review and save, they are written to the memory file in the conversation’s folder.',
  local: 'Memories stay with their folder in .dalizi/agent-memory.json. Skills and common preferences are stored separately. Enabled content is shared with your configured model when you send a message; API keys and full chats are not written to memory files.',
  legacyTitle: 'Legacy memories', legacyHint: 'Legacy memories are not used automatically. Select entries and choose Copy selected to this folder. The original data will be preserved.',
  selectAll: 'Select available', selectNone: 'Deselect all', migrate: 'Copy selected to this folder', migrated: 'Legacy memories copied to this folder. Originals preserved.', legacyCopied: 'Already in this folder', selectLegacy: 'Select legacy memories to copy first.',
  noMemoryFile: 'Open a local folder to see its memory file', folderFixed: 'Bound to the folder of this conversation',
  memoryUnavailable: 'Folder memory unavailable', memoryErrorHint: 'The original file is preserved. Fix it and refresh, or turn off Use memories in chat to continue using skills and ordinary chat.',
});
const agentProfileKey = (root) => (root || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
Object.assign(AGENT_PROFILE_TEXT.zh, {
  exportMemory: '导出记忆', importMemory: '导入记忆', portableMemory: '移动整个文件夹（包括 .dalizi）可携带记忆；也可导出 JSON，在另一目录核对后导入。导出只包含记忆文字，不含路径绑定、技能、密钥或完整对话。',
  importReview: '核对要导入的记忆', importReviewHint: '勾选要保存的条目。相同内容自动跳过；新记忆导入后默认停用，可回到记忆列表逐条启用。', importSelect: '选择全部新条目', importSelected: '导入所选', importInvalid: '不是支持的记忆备份，请使用此软件导出的 JSON 文件。', importLimit: '文件最多 1 MB、100 条记忆，每条最多 2000 字符。', importMemoryEmpty: '请选择至少一条新记忆。', importDone: '已导入 {n} 条记忆，默认停用。', importDuplicate: '已有相同内容', exportDone: '已生成记忆备份，请在下载窗口选择保存位置。',
});
Object.assign(AGENT_PROFILE_TEXT.en, {
  exportMemory: 'Export memories', importMemory: 'Import memories', portableMemory: 'Move the whole folder, including .dalizi, to carry its memories. Or export JSON and review it before importing into another folder. Exports contain memory text only, without folder bindings, skills, keys or full conversations.',
  importReview: 'Review memories to import', importReviewHint: 'Select entries to save. Identical content is skipped. New imports are disabled until you enable them in the memory list.', importSelect: 'Select all new entries', importSelected: 'Import selected', importInvalid: 'Unsupported memory backup. Choose a JSON file exported by this app.', importLimit: 'Maximum 1 MB, 100 memories and 2000 characters per entry.', importMemoryEmpty: 'Select at least one new memory.', importDone: 'Imported {n} memories, disabled by default.', importDuplicate: 'Already saved', exportDone: 'Memory backup generated. Choose a location in the download dialog.',
});
Object.assign(AGENT_PROFILE_TEXT.zh, {
  skillHint: '选择内置技能，或导入自己的 SKILL.md。启用的说明随下一条消息发送给模型；内置与我的技能合计最多启用 4 个。',
  builtinSkills: '内置技能', userSkills: '我的技能', builtinSource: '内置', userSource: '我的导入', importOwnSkill: '导入我的技能',
  builtinHint: '随应用提供，首次使用默认停用。可启停和查看说明，内容随应用更新。', userSkillHint: '你导入的本地说明副本；可移除，原始文件保留。',
  skillEnabledCount: '对话已启用 {n} / 4', skillCapabilityHint: '技能不增加执行工具，也不改变当前权限。建议类技能在只读模式下也可使用。',
  skillFileActions: '支持文件整理', skillAdvice: '分析与建议（未接入执行工具）', skillCurrentTools: '按当前对话工具与权限使用说明',
  skillFileActionsHint: '可提出已有文件操作工具支持的整理计划；执行仍遵循当前对话权限。',
  skillAdviceHint: '根据你提供的材料分析，不会自动读取项目、运行命令或操控电脑与浏览器。',
  builtinEmpty: '暂无内置技能', builtinRemoveDenied: '内置技能随应用提供，不能移除；可以关闭“用于对话”。',
});
Object.assign(AGENT_PROFILE_TEXT.en, {
  skillHint: 'Choose built-in skills or import your own SKILL.md. Enabled instructions are sent with your next message. Enable up to 4 across both groups.',
  builtinSkills: 'Built-in skills', userSkills: 'My skills', builtinSource: 'Built-in', userSource: 'Imported', importOwnSkill: 'Import my skill',
  builtinHint: 'Included with the app and disabled by default on first use. Enable or read them here; app updates provide their content.', userSkillHint: 'Local copies of your imported instructions. Removing a skill keeps its original file.',
  skillEnabledCount: '{n} / 4 enabled for chat', skillCapabilityHint: 'Skills add no execution tools and do not change permissions. Advisory skills also work in read-only mode.',
  skillFileActions: 'File organization supported', skillAdvice: 'Analysis and advice (execution tools not connected)', skillCurrentTools: 'Uses the current chat tools and permissions',
  skillFileActionsHint: 'Can propose organization plans supported by existing file tools. Execution follows the current chat permissions.',
  skillAdviceHint: 'Analyzes material you provide. Does not automatically read projects, run commands, or control your computer or browser.',
  builtinEmpty: 'No built-in skills available', builtinRemoveDenied: 'Built-in skills ship with the app and cannot be removed. Turn off Use in chat instead.',
});
const AGENT_BUILTIN_SKILL_EN = {
  'file-organize': ['File organization', 'Review folder and selection metadata, then propose file organization and naming plans you can check.'],
  'task-planning': ['Task planning', 'Break a goal into scope, dependencies, steps and acceptance criteria for development or file workflows.'],
  'product-design': ['Product and interaction design', 'Turn product goals and usage scenarios into information structure, interaction flows, feedback and acceptance criteria.'],
  'ui-design-review': ['Interface design review', 'Review provided interface descriptions, layouts or code for hierarchy, spacing, states, keyboard access and narrow windows.'],
  'software-development': ['Software development advice', 'Analyze provided requirements, code or errors and suggest implementation changes. Does not read or edit projects or run commands.'],
  'debug-and-test': ['Debugging and testing advice', 'Use provided logs, errors and code to separate facts from hypotheses and propose reproduction, diagnosis and verification steps.'],
  'code-review': ['Code review advice', 'Review provided code or diffs for concrete correctness, data integrity and recovery issues, with evidence and validation suggestions.'],
  'documentation': ['Documentation', 'Draft README files, development plans, guides and change notes from provided facts, distinguishing current features from plans.'],
  'terminal-diagnostics': ['Terminal and SSH diagnostics', 'Analyze provided PowerShell or SSH errors and suggest recovery steps for authentication, disconnections and terminal input problems.'],
};
function agentSkillIsBuiltin(skill) { return skill?.source === 'builtin'; }
function agentSkillPresentation(skill) {
  const translated = locale === 'en' && agentSkillIsBuiltin(skill) ? AGENT_BUILTIN_SKILL_EN[String(skill.id).replace(/^builtin\./, '')] : null;
  return { name: translated?.[0] || skill.name || '', description: translated?.[1] || skill.description || '' };
}
let agentMemoryTransfer = null;
const agentProfileCache = new Map();
let agentProfileRoot = null, agentManagerRoot = null, agentManagerTab = 'skills';
let agentManager = null, agentProfileBusy = false, agentProfileStatus = '', agentProfileError = false, agentExpandedSkill = null;
let agentMemoryEditor = null;
let agentLegacySelection = new Set();
function agentMemoryPath(root, profile = currentAgentProfile(root)) {
  return profile?.memoryStoragePath || (root ? root.replace(/[\\/]+$/, '') + '\\.dalizi\\agent-memory.json' : null);
}

function loadAgentProfile(root, force = false) {
  const key = agentProfileKey(root);
  if (!force && agentProfileCache.has(key)) return agentProfileCache.get(key).promise;
  const entry = { value: null, error: null, promise: null };
  entry.promise = invoke('agent_profile', { root: root || null }).then((value) => {
    if (!value || !Array.isArray(value.skills) || !Array.isArray(value.memories)) throw new Error(agentProfileText('failed'));
    entry.value = value;
    return value;
  }).catch((error) => { entry.error = String(error); throw error; });
  agentProfileCache.set(key, entry);
  // Only the current and a small number of recent folders need UI snapshots.
  while (agentProfileCache.size > 32) {
    const victim = [...agentProfileCache.keys()].find((item) => item !== key && item !== agentProfileKey(agentProfileRoot) && item !== agentProfileKey(agentManagerRoot));
    if (victim === undefined) break;
    agentProfileCache.delete(victim);
  }
  return entry.promise;
}
function currentAgentProfile(root = agentProfileRoot) { return agentProfileCache.get(agentProfileKey(root))?.value || null; }
function syncAgentProfile(root) {
  agentProfileRoot = root || null;
  const expected = agentProfileKey(agentProfileRoot);
  renderAgentContext();
  loadAgentProfile(agentProfileRoot).then(() => { if (expected === agentProfileKey(agentProfileRoot)) renderAgentContext(); }).catch(() => { if (expected === agentProfileKey(agentProfileRoot)) renderAgentContext(); });
}
async function getAgentRequestContext(root) {
  // A request must observe edits made by another tab or an external editor.
  let profile = await loadAgentProfile(root, true);
  if (typeof aiMemoryPreferences === 'function' && aiMemoryPreferences().autoDeduplicate && profile.memoryEnabled && !profile.memoryError && profile.memoryStatistics?.duplicates > 0) {
    await invoke('agent_memory_maintain', { root });
    profile = await loadAgentProfile(root, true);
  }
  if (agentProfileKey(root) === agentProfileKey(agentProfileRoot)) renderAgentContext();
  const selected = profile.skills.filter((skill) => skill.enabled);
  if (selected.length > 4) throw new Error(agentProfileText('skillLimit'));
  if (profile.memoryEnabled && profile.memoryError) throw new Error(String(profile.memoryError) + '\n' + agentProfileText('memoryErrorHint'));
  return { skillIds: selected.map((skill) => skill.id), useMemory: !!profile.memoryEnabled, learnMemory: !!profile.learningEnabled };
}
function renderAgentContext() {
  const target = $('aiAgentContext');
  if (!target) return;
  const entry = agentProfileCache.get(agentProfileKey(agentProfileRoot)), profile = entry?.value;
  const skills = profile?.skills.filter((skill) => skill.enabled) || [];
  const memoryCount = profile?.memoryError ? '!' : profile?.memoryEnabled ? profile.memories.filter((memory) => memory.enabled).length : 0;
  const html = `<button type="button" data-agent-open="skills" title="${esc(skills.map((skill) => agentSkillPresentation(skill).name).join(' · ') || agentProfileText('emptyActive'))}"><span aria-hidden="true">◇</span>${esc(agentProfileText('activeSkills'))}<b>${skills.length}</b></button><button type="button" data-agent-open="memories" title="${esc(agentProfileText(profile?.memoryEnabled ? 'memoryUse' : 'memoryOff'))}"><span aria-hidden="true">◈</span>${esc(agentProfileText('activeMemories'))}<b>${memoryCount}</b></button>${profile?.learningEnabled ? `<button type="button" class="agent-learning-pill" data-agent-open="learning">${esc(agentProfileText('learningOn'))}</button>` : ''}${entry?.error ? `<button type="button" class="agent-profile-error" data-agent-open="skills">${esc(agentProfileText('profileError'))}</button>` : ''}${skills.length ? `<div class="agent-active-skills">${skills.map((skill) => { const display = agentSkillPresentation(skill); return `<span title="${esc(display.description)}">${esc(display.name)}</span>`; }).join('')}</div>` : ''}`;
  const memoryError = profile?.memoryError ? `<button type="button" class="agent-profile-error" data-agent-open="memories" title="${esc(profile.memoryError)}">${esc(agentProfileText('memoryUnavailable'))}</button>` : '';
  if (target.innerHTML !== html + memoryError) target.innerHTML = html + memoryError;
}
function initAgentProfile() {
  if (agentManager) return;
  agentManager = document.createElement('dialog'); agentManager.id = 'agentProfileDialog'; agentManager.className = 'agent-profile-dialog';
  agentManager.setAttribute('aria-labelledby', 'agentProfileTitle');
  agentManager.innerHTML = `<header class="agent-profile-heading"><div><span class="agent-profile-eyebrow">AGENT WORKSPACE</span><h2 id="agentProfileTitle"></h2><p id="agentProfileIntro"></p></div><button type="button" data-agent-action="close" class="agent-profile-close" aria-label="${esc(agentProfileText('close'))}">×</button></header><div id="agentProfileScope" class="agent-profile-scope"></div><nav class="agent-profile-tabs" aria-label="${esc(agentProfileText('title'))}"></nav><div id="agentProfileBody" class="agent-profile-body"></div><footer class="agent-profile-footer"><span id="agentProfileStatus" role="status" aria-live="polite"></span><button type="button" data-agent-action="refresh" class="agent-profile-secondary">${esc(agentProfileText('retry'))}</button><button type="button" data-agent-action="close" class="agent-profile-primary">${esc(agentProfileText('close'))}</button></footer>`;
  document.body.appendChild(agentManager);
  $('aiAgentContext')?.addEventListener('click', (event) => { const button = event.target.closest('[data-agent-open]'); if (button) openAgentProfile(button.dataset.agentOpen); });
  agentManager.addEventListener('keydown', (event) => event.stopPropagation());
  agentManager.addEventListener('cancel', (event) => { if (agentProfileBusy) event.preventDefault(); });
  agentManager.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-agent-tab]');
    if (tab && !agentProfileBusy) { agentManagerTab = tab.dataset.agentTab; agentProfileStatus = ''; renderAgentManager(); return; }
    const button = event.target.closest('[data-agent-action]');
    if (!button || agentProfileBusy) return;
    const action = button.dataset.agentAction;
    if (action === 'close') agentManager.close();
    else if (action === 'refresh') refreshAgentManager();
    else if (action === 'browse') pickAgentSkill();
    else if (action === 'import') importAgentSkill();
    else if (action === 'view-skill') { agentExpandedSkill = agentExpandedSkill === button.dataset.id ? null : button.dataset.id; renderAgentManager(); }
    else if (action === 'remove-skill') removeAgentSkill(button.dataset.id);
    else if (action === 'add-memory') openAgentMemoryEditor(agentManagerRoot, '', null);
    else if (action === 'maintain-memory') maintainAgentMemory();
    else if (action === 'export-memory') exportAgentMemories();
    else if (action === 'import-memory') pickAgentMemoryBackup();
    else if (action === 'edit-memory') {
      const memory = currentAgentProfile(agentManagerRoot)?.memories.find((item) => item.id === button.dataset.id);
      if (memory) openAgentMemoryEditor(agentManagerRoot, memory.content, memory);
    } else if (action === 'delete-memory') deleteAgentMemory(button.dataset.id);
    else if (action === 'select-legacy') {
      const available = availableAgentLegacyMemories(currentAgentProfile(agentManagerRoot));
      agentLegacySelection = agentLegacySelection.size === available.length ? new Set() : new Set(available.map((memory) => memory.id));
      renderAgentManager();
    } else if (action === 'migrate-memories') migrateAgentMemories();
  });
  agentManager.addEventListener('change', (event) => {
    const input = event.target, profile = currentAgentProfile(agentManagerRoot);
    if (!profile || agentProfileBusy) return;
    if (input.dataset.memoryPref) {
      try { saveAiMemoryPreference(input.dataset.memoryPref, input.checked); } catch (error) { setAgentProfileStatus(String(error), true); }
    } else if (input.matches('[data-agent-skill]')) {
      if (input.checked && profile.skills.filter((skill) => skill.enabled).length >= 4) { input.checked = false; setAgentProfileStatus(agentProfileText('skillLimit'), true); return; }
      mutateAgentProfile('agent_skill_set', { id: input.dataset.agentSkill, enabled: input.checked }, 'updated');
    } else if (input.matches('[data-agent-memory]')) {
      const memory = profile.memories.find((item) => item.id === input.dataset.agentMemory);
      if (memory) mutateAgentProfile('agent_memory_save', { memory: { id: memory.id, scope: 'folder', root: agentManagerRoot, content: memory.content, enabled: input.checked } }, 'updated');
    } else if (input.matches('[data-agent-legacy]')) {
      if (input.checked) agentLegacySelection.add(input.dataset.agentLegacy); else agentLegacySelection.delete(input.dataset.agentLegacy);
      updateAgentLegacyControls();
    } else if (input.id === 'agentUseMemories' || input.id === 'agentLearnMemories') {
      mutateAgentProfile('agent_preferences_set', { memoryEnabled: input.id === 'agentUseMemories' ? input.checked : !!profile.memoryEnabled, learningEnabled: input.id === 'agentLearnMemories' ? input.checked : !!profile.learningEnabled }, 'updated');
    }
  });
}
async function openAgentProfile(tab = 'skills') {
  initAgentProfile();
  if (!agentManager.open) { agentManagerRoot = agentProfileRoot; agentExpandedSkill = null; agentLegacySelection = new Set(); }
  agentManagerTab = ['skills', 'memories', 'learning'].includes(tab) ? tab : 'skills';
  agentProfileStatus = ''; agentProfileError = false; renderAgentManager();
  if (!agentManager.open) agentManager.showModal();
  const scope = agentManagerRoot;
  setAgentProfileBusy(true);
  try { await loadAgentProfile(scope, true); if (agentManager.open && agentProfileKey(scope) === agentProfileKey(agentManagerRoot)) renderAgentManager(); renderAgentContext(); }
  catch (error) { if (agentManager.open && agentProfileKey(scope) === agentProfileKey(agentManagerRoot)) { setAgentProfileStatus(String(error), true); renderAgentManager(); } }
  finally { setAgentProfileBusy(false); }
}
function setAgentProfileStatus(message, error = false) {
  agentProfileStatus = message; agentProfileError = error;
  if ($('agentProfileStatus')) { $('agentProfileStatus').textContent = message; $('agentProfileStatus').classList.toggle('is-error', error); }
  const refreshButton = agentManager?.querySelector('[data-agent-action="refresh"]');
  if (refreshButton) refreshButton.textContent = agentProfileText(error ? 'retry' : 'refresh');
}
function renderAgentManager() {
  if (!agentManager) return;
  $('agentProfileTitle').textContent = agentProfileText('title'); $('agentProfileIntro').textContent = agentProfileText('intro');
  $('agentProfileScope').innerHTML = `<span>${esc(agentProfileText('scope'))}</span><code>${esc(agentManagerRoot || agentProfileText('noFolder'))}</code>`;
  agentManager.querySelector('.agent-profile-tabs').innerHTML = ['skills', 'memories', 'learning'].map((tab) => `<button type="button" data-agent-tab="${tab}" aria-pressed="${agentManagerTab === tab}" class="${agentManagerTab === tab ? 'active' : ''}">${esc(agentProfileText(tab))}</button>`).join('');
  const profile = currentAgentProfile(agentManagerRoot), body = $('agentProfileBody');
  if (!profile) { body.innerHTML = `<div class="agent-profile-empty">${esc(agentProfileCache.get(agentProfileKey(agentManagerRoot))?.error || agentProfileText('loading'))}</div>`; }
  else if (agentManagerTab === 'skills') {
    body.innerHTML = renderAgentSkills(profile);
  } else if (agentManagerTab === 'memories') {
    body.innerHTML = renderAgentMemories(profile);
  } else {
    body.innerHTML = `<label class="agent-preference"><input id="agentLearnMemories" type="checkbox"${profile.learningEnabled ? ' checked' : ''}><span><strong>${esc(agentProfileText('learn'))}</strong><small>${esc(agentProfileText('learnHint'))}</small></span></label><div class="agent-learning-flow"><span>${esc(locale === 'en' ? 'Chat' : '对话')}</span><b>→</b><span>${esc(locale === 'en' ? 'Suggested memory' : '记忆建议')}</span><b>→</b><span>${esc(locale === 'en' ? 'Review & save' : '核对并保存')}</span></div><p class="agent-profile-description">${esc(agentProfileText('learnScope'))}</p><div class="agent-storage-note"><p>${esc(agentProfileText('local'))}</p><span>${esc(agentProfileText('memoryStorage'))}</span><code>${esc(agentMemoryPath(agentManagerRoot, profile) || agentProfileText('noMemoryFile'))}</code><span>${esc(agentProfileText('skillStorage'))}</span><code>${esc(profile.storagePath || '—')}</code></div>`;
  }
  if (profile?.warning) { const note = document.createElement('p'); note.className = 'agent-profile-warning'; note.textContent = profile.warning; body.prepend(note); }
  if (profile?.memoryError && agentManagerTab !== 'memories') body.innerHTML = agentMemoryErrorMarkup(profile) + body.innerHTML;
  agentManager.querySelectorAll('[data-agent-action="close"]').forEach((button) => { if (!button.classList.contains('agent-profile-close')) button.textContent = agentProfileText('close'); button.setAttribute('aria-label', agentProfileText('close')); });
  agentManager.querySelector('[data-agent-action="refresh"]').textContent = agentProfileText(agentProfileError ? 'retry' : 'refresh');
  setAgentProfileStatus(agentProfileStatus, agentProfileError);
  setAgentProfileBusy(agentProfileBusy);
}
function renderAgentSkillCard(skill) {
  const builtin = agentSkillIsBuiltin(skill), display = agentSkillPresentation(skill);
  const fileActions = skill.availability === 'file-actions';
  const availability = fileActions ? 'file-actions' : 'advice';
  const capability = builtin ? `<span class="agent-skill-badge agent-skill-capability" data-agent-skill-availability="${availability}" title="${esc(agentProfileText(fileActions ? 'skillFileActionsHint' : 'skillAdviceHint'))}">${esc(agentProfileText(fileActions ? 'skillFileActions' : 'skillAdvice'))}</span>` : `<span class="agent-skill-badge agent-skill-scope">${esc(agentProfileText('skillCurrentTools'))}</span>`;
  return `<article class="agent-skill-card" data-agent-skill-id="${esc(skill.id)}" data-agent-skill-source="${builtin ? 'builtin' : 'user'}"><div class="agent-profile-card-heading"><div><strong>${esc(display.name)}</strong><p>${esc(display.description)}</p></div><label class="agent-use-switch"><input type="checkbox" data-agent-skill="${esc(skill.id)}" aria-label="${esc(agentProfileText('enable') + ': ' + display.name)}"${skill.enabled ? ' checked' : ''}><span>${esc(agentProfileText('enable'))}</span></label></div><div class="agent-skill-badges"><span class="agent-skill-badge${builtin ? ' is-builtin' : ''}">${esc(agentProfileText(builtin ? 'builtinSource' : 'userSource'))}</span>${skill.version ? `<span class="agent-skill-badge agent-skill-version">v${esc(skill.version)}</span>` : ''}${capability}</div>${!builtin && skill.path ? `<code class="agent-profile-path" title="${esc(skill.path)}">${esc(skill.path)}</code>` : ''}<div class="agent-profile-card-actions"><button type="button" data-agent-action="view-skill" data-id="${esc(skill.id)}" aria-expanded="${agentExpandedSkill === skill.id}">${esc(agentProfileText(agentExpandedSkill === skill.id ? 'hide' : 'view'))}</button>${!builtin ? `<button type="button" data-agent-action="remove-skill" data-id="${esc(skill.id)}">${esc(agentProfileText('remove'))}</button>` : ''}</div>${agentExpandedSkill === skill.id ? `<pre class="agent-skill-source">${esc(skill.body || '')}</pre>` : ''}</article>`;
}
function renderAgentSkills(profile) {
  const importPath = $('agentSkillPath')?.value || '';
  const enabled = profile.skills.filter((skill) => skill.enabled).length;
  const groups = ['builtin', 'user'].map((source) => {
    const builtin = source === 'builtin', skills = profile.skills.filter((skill) => agentSkillIsBuiltin(skill) === builtin);
    const empty = `<div class="agent-profile-empty"><strong>${esc(agentProfileText(builtin ? 'builtinEmpty' : 'skillEmpty'))}</strong>${builtin ? '' : `<p>${esc(agentProfileText('skillEmptyHint'))}</p>`}</div>`;
    return `<section class="agent-skill-group" data-agent-skill-group="${source}" aria-labelledby="agentSkillGroup-${source}"><div class="agent-skill-group-heading"><h3 id="agentSkillGroup-${source}">${esc(agentProfileText(builtin ? 'builtinSkills' : 'userSkills'))}</h3><span>${skills.length}</span></div><p class="agent-profile-note">${esc(agentProfileText(builtin ? 'builtinHint' : 'userSkillHint'))}</p><div class="agent-profile-list">${skills.length ? skills.map(renderAgentSkillCard).join('') : empty}</div></section>`;
  }).join('');
  return `<p class="agent-profile-description">${esc(agentProfileText('skillHint'))}</p><div class="agent-skill-summary"><strong id="agentSkillEnabledCount">${esc(agentProfileText('skillEnabledCount').replace('{n}', enabled))}</strong><p>${esc(agentProfileText('skillCapabilityHint'))}</p></div><section class="agent-skill-import" aria-labelledby="agentSkillImportTitle"><h3 id="agentSkillImportTitle">${esc(agentProfileText('importOwnSkill'))}</h3><div class="agent-import"><label class="agent-visually-hidden" for="agentSkillPath">${esc(agentProfileText('skillPath'))}</label><input id="agentSkillPath" autocomplete="off" spellcheck="false" placeholder="C:\\Skills\\organize\\SKILL.md" value="${esc(importPath)}"><button type="button" data-agent-action="browse" class="agent-profile-secondary">${esc(agentProfileText('choose'))}</button><button type="button" data-agent-action="import" class="agent-profile-primary">${esc(agentProfileText('import'))}</button></div><p class="agent-profile-note">${esc(agentProfileText('skillScope'))}</p></section>${groups}`;
}
async function removeAgentSkill(id) {
  const skill = currentAgentProfile(agentManagerRoot)?.skills.find((item) => item.id === id);
  if (agentSkillIsBuiltin(skill)) { setAgentProfileStatus(agentProfileText('builtinRemoveDenied'), true); return false; }
  return mutateAgentProfile('agent_skill_remove', { id }, 'removed');
}
function setAgentProfileBusy(busy) {
  agentProfileBusy = busy;
  agentManager?.querySelectorAll('button,input,select,textarea').forEach((element) => { element.disabled = busy || !!element.dataset?.agentFixedDisabled || (!!element.dataset?.agentRequiresRoot && !agentManagerRoot); });
  updateAgentLegacyControls();
}
function availableAgentLegacyMemories(profile) {
  if (profile?.memoryError) return [];
  return (profile?.legacyMemories || []).filter((memory) => !profile.memories.some((local) => local.content.trim() === memory.content.trim()));
}
function agentMemoryErrorMarkup(profile) {
  return profile.memoryError ? `<div class="agent-profile-warning agent-memory-read-error" role="alert"><strong>${esc(agentProfileText('memoryUnavailable'))}</strong><p>${esc(profile.memoryError)}</p><p>${esc(agentProfileText('memoryErrorHint'))}</p></div>` : '';
}
function renderAgentMemories(profile) {
  const location = agentMemoryPath(agentManagerRoot, profile);
  const localCards = profile.memories.map((memory) => `<article class="agent-memory-card${memory.enabled ? '' : ' is-disabled'}"><div class="agent-profile-card-heading"><span class="agent-scope-tag">${esc(agentProfileText('perFolder'))}</span><label class="agent-use-switch"><input type="checkbox" data-agent-memory="${esc(memory.id)}" data-agent-requires-root="true"${memory.enabled ? ' checked' : ''}><span>${esc(agentProfileText('useMemory'))}</span></label></div><p class="agent-memory-content">${esc(memory.content)}</p><div class="agent-profile-card-actions"><small>${esc(new Date(memory.updatedAt || 0).toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN'))}</small><button type="button" data-agent-action="edit-memory" data-agent-requires-root="true" data-id="${esc(memory.id)}">${esc(agentProfileText('edit'))}</button><button type="button" data-agent-action="delete-memory" data-agent-requires-root="true" data-id="${esc(memory.id)}">${esc(agentProfileText('delete'))}</button></div></article>`).join('');
  const available = availableAgentLegacyMemories(profile), availableIds = new Set(available.map((memory) => memory.id));
  agentLegacySelection = new Set([...agentLegacySelection].filter((id) => availableIds.has(id)));
  const legacy = !profile.memoryError && (profile.legacyMemories || []).length ? `<section class="agent-legacy-memories"><div class="agent-legacy-heading"><h3>${esc(agentProfileText('legacyTitle'))} <span>${profile.legacyMemories.length}</span></h3><button type="button" data-agent-action="select-legacy" data-agent-requires-root="true"${!available.length ? ' data-agent-fixed-disabled="true" disabled' : ''}>${esc(agentProfileText(agentLegacySelection.size && agentLegacySelection.size === available.length ? 'selectNone' : 'selectAll'))}</button></div><p class="agent-profile-note">${esc(agentProfileText('legacyHint'))}</p><div class="agent-legacy-list">${profile.legacyMemories.map((memory) => `<label class="agent-legacy-item"><input type="checkbox" data-agent-legacy="${esc(memory.id)}" data-agent-requires-root="true"${!availableIds.has(memory.id) ? ' data-agent-fixed-disabled="true" disabled' : ''}${agentLegacySelection.has(memory.id) ? ' checked' : ''}><span><small>${esc(availableIds.has(memory.id) ? memory.scope === 'global' ? agentProfileText('globalShort') : memory.root || agentProfileText('perFolder') : agentProfileText('legacyCopied'))}</small><span>${esc(memory.content)}</span></span></label>`).join('')}</div><button type="button" data-agent-action="migrate-memories" class="agent-profile-secondary">${esc(agentProfileText('migrate'))}<span id="agentLegacySelectedCount"></span></button></section>` : '';
  const contents = agentMemoryTransferMarkup(profile) + (profile.memoryError ? agentMemoryErrorMarkup(profile) : localCards || `<div class="agent-profile-empty"><strong>${esc(agentProfileText('memoryEmpty'))}</strong><p>${esc(agentProfileText(agentManagerRoot ? 'memoryEmptyHint' : 'folderRequired'))}</p></div>`);
  return `<div class="agent-memory-intro"><p class="agent-profile-description">${esc(agentProfileText('memoryHint'))}</p><button type="button" data-agent-action="add-memory" data-agent-requires-root="true"${profile.memoryError ? ' data-agent-fixed-disabled="true" disabled' : ''} class="agent-profile-primary">＋ ${esc(agentProfileText('add'))}</button></div><div class="agent-memory-file"><span>${esc(agentProfileText('memoryStorage'))}</span><code id="agentMemoryStoragePath">${esc(location || agentProfileText('noMemoryFile'))}</code></div><label class="agent-preference compact"><input id="agentUseMemories" type="checkbox"${profile.memoryEnabled ? ' checked' : ''}><span><strong>${esc(agentProfileText('memoryUse'))}</strong><small>${esc(agentProfileText('memoryUseHint'))}</small></span></label>${typeof renderMemoryMaintenance === 'function' ? renderMemoryMaintenance(profile) : ''}<div class="agent-profile-list">${contents}</div>${legacy}`;
}
function updateAgentLegacyControls() {
  if (!agentManager) return;
  const count = agentLegacySelection.size;
  const button = agentManager.querySelector('[data-agent-action="migrate-memories"]');
  if (button) button.disabled = agentProfileBusy || !agentManagerRoot || count === 0;
  const label = $('agentLegacySelectedCount'); if (label) label.textContent = count ? ` · ${count}` : '';
  const toggle = agentManager.querySelector('[data-agent-action="select-legacy"]');
  if (toggle) { const available = availableAgentLegacyMemories(currentAgentProfile(agentManagerRoot)); toggle.textContent = agentProfileText(count && count === available.length ? 'selectNone' : 'selectAll'); }
}
async function deleteAgentMemory(id) {
  if (!agentManagerRoot) { setAgentProfileStatus(agentProfileText('folderRequired'), true); return false; }
  return mutateAgentProfile('agent_memory_delete', { id, root: agentManagerRoot }, 'removed');
}
async function migrateAgentMemories() {
  const root = agentManagerRoot;
  if (!root) { setAgentProfileStatus(agentProfileText('folderRequired'), true); return false; }
  const available = new Set(availableAgentLegacyMemories(currentAgentProfile(root)).map((memory) => memory.id));
  const ids = [...agentLegacySelection].filter((id) => available.has(id));
  if (!ids.length) { setAgentProfileStatus(agentProfileText('selectLegacy'), true); return false; }
  const saved = await mutateAgentProfile('agent_memory_migrate', { root, ids }, 'migrated');
  if (saved) { agentLegacySelection.clear(); renderAgentManager(); }
  return saved;
}
async function refreshAgentProfiles() {
  agentProfileCache.clear();
  const roots = [...new Map([agentProfileRoot, agentManagerRoot].map((root) => [agentProfileKey(root), root])).values()];
  const results = await Promise.allSettled(roots.map((root) => loadAgentProfile(root)));
  renderAgentContext(); renderAgentManager();
  const error = results.find((result) => result.status === 'rejected');
  if (error) throw error.reason;
}
async function mutateAgentProfile(command, args, status = 'updated') {
  if (agentProfileBusy) return false;
  setAgentProfileBusy(true); setAgentProfileStatus(agentProfileText('pending'));
  try {
    await invoke(command, args); await refreshAgentProfiles();
    setAgentProfileStatus(agentProfileText(status));
    return true;
  } catch (error) { setAgentProfileStatus(String(error), true); renderAgentManager(); return false; }
  finally { setAgentProfileBusy(false); }
}
async function refreshAgentManager() {
  if (agentProfileBusy) return;
  setAgentProfileBusy(true);
  try { await refreshAgentProfiles(); setAgentProfileStatus(agentProfileText('refreshed')); }
  catch (error) { setAgentProfileStatus(String(error), true); }
  finally { setAgentProfileBusy(false); }
}
async function pickAgentSkill() {
  if (agentProfileBusy) return;
  setAgentProfileBusy(true);
  try { const path = await invoke('agent_pick_skill', {}); if (path && $('agentSkillPath')) $('agentSkillPath').value = path; }
  catch (error) { setAgentProfileStatus(String(error), true); }
  finally { setAgentProfileBusy(false); }
}
async function importAgentSkill() {
  const path = $('agentSkillPath')?.value.trim();
  if (!path) { setAgentProfileStatus(agentProfileText('importEmpty'), true); $('agentSkillPath')?.focus(); return; }
  const imported = await mutateAgentProfile('agent_skill_import', { path }, 'imported');
  if (imported && $('agentSkillPath')) $('agentSkillPath').value = '';
}
function validateAgentMemory(value, root) {
  if (!root) return agentProfileText('folderRequired');
  if (!value.content.trim()) return agentProfileText('memoryEmptyError');
  if (Array.from(value.content.trim()).length > 2000) return agentProfileText('memoryLong');
  return '';
}
function saveAgentSuggestedMemory(root, content) { return openAgentMemoryEditor(root, content, null); }
function agentMemoryTransferMarkup(profile) {
  const disabled = profile.memoryError ? ' data-agent-fixed-disabled="true" disabled' : '';
  return `<section class="agent-memory-transfer"><p class="agent-profile-note">${esc(agentProfileText('portableMemory'))}</p><div><button type="button" class="agent-profile-secondary" data-agent-action="export-memory" data-agent-requires-root="true"${disabled}>${esc(agentProfileText('exportMemory'))}</button><button type="button" class="agent-profile-secondary" data-agent-action="import-memory" data-agent-requires-root="true"${disabled}>${esc(agentProfileText('importMemory'))}</button></div></section>`;
}
function parseAgentMemoryBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 1024 * 1024) throw new Error(agentProfileText('importLimit'));
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(agentProfileText('importInvalid')); }
  // Automatic maintenance backups keep IDs and enable states for a full local
  // snapshot. The reviewed import deliberately imports only their contents.
  if (value && value.version === 1 && !Object.hasOwn(value, 'format') && Array.isArray(value.memories) &&
      Object.keys(value).every((key) => ['version', 'memories'].includes(key))) {
    if (value.memories.length > 100) throw new Error(agentProfileText('importLimit'));
    const ids = new Set();
    for (const item of value.memories) {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id) || typeof item.enabled !== 'boolean' ||
          !Number.isSafeInteger(item.updatedAt) || item.updatedAt < 0 || Object.keys(item).some((key) => !['id', 'content', 'enabled', 'updatedAt'].includes(key))) throw new Error(agentProfileText('importInvalid'));
      ids.add(item.id);
    }
    value = { format: 'dalizi-folder-memories', version: 1, memories: value.memories.map(({ content }) => ({ content })) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'dalizi-folder-memories' || value.version !== 1 || !Array.isArray(value.memories) || Object.keys(value).some((key) => !['format', 'version', 'memories'].includes(key))) throw new Error(agentProfileText('importInvalid'));
  if (value.memories.length > 100) throw new Error(agentProfileText('importLimit'));
  const contents = value.memories.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 1 || typeof item.content !== 'string' || !item.content.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(item.content)) throw new Error(agentProfileText('importInvalid'));
    if (Array.from(item.content.trim()).length > 2000) throw new Error(agentProfileText('importLimit'));
    return item.content.trim();
  });
  return [...new Set(contents)];
}
function serializeAgentMemories(profile) {
  if (profile.memoryError) throw new Error(String(profile.memoryError));
  const text = JSON.stringify({ format: 'dalizi-folder-memories', version: 1, memories: profile.memories.map((item) => ({ content: item.content })) }, null, 2);
  parseAgentMemoryBackup(text);
  return text;
}
async function exportAgentMemories() {
  const root = agentManagerRoot;
  if (!root || agentProfileBusy) return;
  setAgentProfileBusy(true);
  try {
    const text = serializeAgentMemories(await loadAgentProfile(root, true));
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'dalizi-memories.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setAgentProfileStatus(agentProfileText('exportDone'));
  } catch (error) { setAgentProfileStatus(String(error), true); }
  finally { setAgentProfileBusy(false); }
}
function pickAgentMemoryBackup() {
  const root = agentManagerRoot;
  if (!root || agentProfileBusy || agentMemoryTransfer) return;
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error(agentProfileText('importLimit'));
      const contents = parseAgentMemoryBackup(await file.text());
      let profile = await loadAgentProfile(root, true);
  if (typeof aiMemoryPreferences === 'function' && aiMemoryPreferences().autoDeduplicate && profile.memoryEnabled && !profile.memoryError && profile.memoryStatistics?.duplicates > 0) {
    await invoke('agent_memory_maintain', { root });
    profile = await loadAgentProfile(root, true);
  }
      if (profile.memoryError) throw new Error(String(profile.memoryError));
      openAgentMemoryImport(root, contents, profile);
    } catch (error) { setAgentProfileStatus(String(error), true); }
  }, { once: true });
  input.click();
}
function openAgentMemoryImport(root, contents, profile) {
  if (!root) throw new Error(agentProfileText('folderRequired'));
  if (agentMemoryTransfer) { agentMemoryTransfer.dialog.focus(); return; }
  const dialog = document.createElement('dialog'); dialog.id = 'agentMemoryImportDialog'; dialog.className = 'agent-profile-dialog agent-memory-import-dialog';
  dialog.setAttribute('aria-labelledby', 'agentMemoryImportTitle');
  const existing = new Set(profile.memories.map((item) => item.content.trim()));
  const session = { root, contents, dialog, busy: false, selected: new Set(), available: new Set(contents.map((text, index) => existing.has(text) ? -1 : index).filter((index) => index >= 0)) };
  agentMemoryTransfer = session;
  dialog.innerHTML = `<header class="agent-profile-heading"><div><h2 id="agentMemoryImportTitle">${esc(agentProfileText('importReview'))}</h2><p>${esc(agentProfileText('importReviewHint'))}</p></div><button type="button" class="agent-profile-close" data-memory-import-cancel aria-label="${esc(agentProfileText('cancel'))}">×</button></header><div class="agent-profile-body"><div class="agent-memory-file agent-memory-fixed-scope"><span>${esc(agentProfileText('memoryStorage'))}</span><code>${esc(agentMemoryPath(root))}</code></div><button type="button" class="agent-profile-secondary" data-memory-import-all>${esc(agentProfileText('importSelect'))}</button><div class="agent-profile-list">${contents.map((content, index) => `<label class="agent-legacy-item"><input type="checkbox" data-memory-import-index="${index}"${existing.has(content) ? ' disabled' : ''}><span>${existing.has(content) ? `<small>${esc(agentProfileText('importDuplicate'))}</small>` : ''}<span>${esc(content)}</span></span></label>`).join('')}</div><p id="agentMemoryImportError" class="agent-profile-error" role="status"></p></div><footer class="agent-profile-footer"><span id="agentMemoryImportCount" aria-live="polite">0 / ${session.available.size}</span><button type="button" class="agent-profile-secondary" data-memory-import-cancel>${esc(agentProfileText('cancel'))}</button><button type="button" class="agent-profile-primary" id="agentMemoryImportSave" disabled>${esc(agentProfileText('importSelected'))}</button></footer>`;
  document.body.appendChild(dialog);
  const paint = () => {
    dialog.querySelectorAll('[data-memory-import-index]').forEach((input) => { input.checked = session.selected.has(Number(input.dataset.memoryImportIndex)); });
    $('agentMemoryImportCount').textContent = `${session.selected.size} / ${session.available.size}`;
    $('agentMemoryImportSave').disabled = session.busy || !session.selected.size;
  };
  dialog.addEventListener('change', (event) => {
    const index = Number(event.target.dataset.memoryImportIndex);
    if (session.busy || !session.available.has(index)) return;
    if (event.target.checked) session.selected.add(index); else session.selected.delete(index);
    paint();
  });
  dialog.addEventListener('click', (event) => {
    if (session.busy) return;
    if (event.target.closest('[data-memory-import-cancel]')) dialog.close();
    else if (event.target.closest('[data-memory-import-all]')) {
      session.selected = session.selected.size === session.available.size ? new Set() : new Set(session.available); paint();
    } else if (event.target.closest('#agentMemoryImportSave')) confirmAgentMemoryImport(session);
  });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('cancel', (event) => { if (session.busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (agentMemoryTransfer === session) agentMemoryTransfer = null; dialog.remove(); }, { once: true });
  dialog.showModal();
}
async function confirmAgentMemoryImport(session = agentMemoryTransfer) {
  if (!session || session.busy) return false;
  const contents = [...session.selected].filter((index) => session.available.has(index)).map((index) => session.contents[index]);
  if (!contents.length) { $('agentMemoryImportError').textContent = agentProfileText('importMemoryEmpty'); return false; }
  session.busy = true;
  session.dialog.querySelectorAll('button,input').forEach((input) => { input.disabled = true; });
  $('agentMemoryImportError').textContent = agentProfileText('pending');
  try {
    const imported = await invoke('agent_memory_import', { root: session.root, contents });
    session.dialog.close();
    try { await refreshAgentProfiles(); } catch (error) { if (typeof toast === 'function') toast(String(error), true); }
    setAgentProfileStatus(agentProfileText('importDone').replace('{n}', String(imported)));
    return true;
  } catch (error) {
    $('agentMemoryImportError').textContent = String(error);
    session.dialog.querySelectorAll('button,input').forEach((input) => { input.disabled = input.dataset.memoryImportIndex !== undefined && !session.available.has(Number(input.dataset.memoryImportIndex)); });
    return false;
  } finally { session.busy = false; }
}
function openAgentMemoryEditor(root, content, memory) {
  if (agentMemoryEditor) { agentMemoryEditor.dialog.focus(); return Promise.resolve(false); }
  const dialog = document.createElement('dialog'); dialog.id = 'agentMemoryDialog'; dialog.className = 'agent-profile-dialog agent-memory-dialog'; dialog.setAttribute('aria-labelledby', 'agentMemoryTitle');
  const session = { root: root || null, memory, dialog, busy: false, saved: false, resolve: null };
  const promise = new Promise((resolve) => { session.resolve = resolve; });
  agentMemoryEditor = session;
  dialog.innerHTML = `<header class="agent-profile-heading"><div><h2 id="agentMemoryTitle">${esc(agentProfileText(memory ? 'memoryEdit' : 'memoryTitle'))}</h2><p>${esc(agentProfileText('memoryFooter'))}</p></div><button type="button" data-agent-memory-cancel class="agent-profile-close" aria-label="${esc(agentProfileText('cancel'))}">×</button></header><form id="agentMemoryForm"><div class="agent-profile-body"><div class="agent-memory-file agent-memory-fixed-scope"><span>${esc(agentProfileText('memoryRoot'))}</span><code id="agentMemoryRoot">${esc(session.root || agentProfileText('noFolder'))}</code><small>${esc(agentProfileText('folderFixed'))}</small><span>${esc(agentProfileText('memoryStorage'))}</span><code id="agentMemoryFile">${esc(agentMemoryPath(session.root) || agentProfileText('noMemoryFile'))}</code></div><label for="agentMemoryContent" class="agent-field-label">${esc(agentProfileText('content'))}</label><textarea id="agentMemoryContent" rows="7" placeholder="${esc(agentProfileText('memoryPlaceholder'))}"></textarea><div class="agent-memory-edit-meta"><label><input id="agentMemoryEnabled" type="checkbox" checked> ${esc(agentProfileText('useMemory'))}</label><span id="agentMemoryCount"></span></div><p id="agentMemoryError" class="agent-profile-error" role="status" aria-live="polite"></p></div><footer class="agent-profile-footer"><button type="button" data-agent-memory-cancel class="agent-profile-secondary">${esc(agentProfileText('cancel'))}</button><button id="agentMemorySave" type="submit" class="agent-profile-primary"${!session.root ? ' disabled' : ''}>${esc(agentProfileText('save'))}</button></footer></form>`;
  document.body.appendChild(dialog);
  $('agentMemoryContent').value = String(content || ''); $('agentMemoryEnabled').checked = memory?.enabled !== false;
  $('agentMemorySave').disabled = !session.root;
  if (!session.root) $('agentMemoryError').textContent = agentProfileText('folderRequired');
  const update = () => {
    $('agentMemoryCount').textContent = `${Array.from($('agentMemoryContent').value).length} / 2000`;
  };
  dialog.addEventListener('input', update); dialog.addEventListener('change', update); update();
  dialog.querySelectorAll('[data-agent-memory-cancel]').forEach((button) => button.addEventListener('click', () => { if (!session.busy) dialog.close(); }));
  dialog.addEventListener('cancel', (event) => { if (session.busy) event.preventDefault(); });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => { if (agentMemoryEditor === session) agentMemoryEditor = null; dialog.remove(); session.resolve(session.saved); }, { once: true });
  $('agentMemoryForm').addEventListener('submit', async (event) => {
    event.preventDefault(); if (session.busy) return;
    const value = { id: memory?.id || null, scope: 'folder', content: $('agentMemoryContent').value.trim(), enabled: $('agentMemoryEnabled').checked };
    const error = validateAgentMemory(value, session.root);
    if (error) { $('agentMemoryError').textContent = error; $('agentMemoryContent').focus(); return; }
    session.busy = true;
    dialog.querySelectorAll('button,input,select,textarea').forEach((element) => { element.disabled = true; });
    $('agentMemoryError').textContent = agentProfileText('pending');
    try {
      await invoke('agent_memory_save', { memory: { ...value, root: session.root } });
      session.saved = true;
      try { await refreshAgentProfiles(); } catch (refreshError) { if (typeof toast === 'function') toast(String(refreshError), true); }
      dialog.close(); if (typeof toast === 'function') toast(agentProfileText('saved'));
    } catch (saveError) {
      $('agentMemoryError').textContent = String(saveError);
      dialog.querySelectorAll('button,input,select,textarea').forEach((element) => { element.disabled = false; });
      session.busy = false;
    }
  });
  dialog.showModal(); $('agentMemoryContent').focus();
  return promise;
}

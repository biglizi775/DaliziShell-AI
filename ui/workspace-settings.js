/* A single home for workspace preferences and occasional tools. */
const settingsText = (zh, en) => locale === 'zh' ? zh : en;
function initWorkspaceSettings() { $('btnSettings').addEventListener('click', openWorkspaceSettings); }
function openWorkspaceSettings() {
  closeMenu(); if (typeof closeQuickSearch === 'function') closeQuickSearch();
  let dialog = $('workspaceSettings');
  if (dialog?.open) { dialog.focus(); return; }
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'workspaceSettings'; dialog.className = 'file-settings-dialog workspace-settings'; document.body.appendChild(dialog); }
  const card = (action, icon, title, detail, shortcut = '') => `<button type="button" class="settings-tool" data-settings-tool="${action}"><span class="settings-tool-icon">${icon}</span><span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span>${shortcut ? `<kbd>${esc(shortcut)}</kbd>` : '<span class="settings-arrow">›</span>'}</button>`;
  dialog.setAttribute('aria-labelledby', 'workspaceSettingsTitle');
  dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">DALIZI / WORKSPACE</span><h2 id="workspaceSettingsTitle">${settingsText('设置', 'Settings')}</h2></div><button type="button" data-settings-close aria-label="${settingsText('关闭设置', 'Close settings')}">×</button></header><div class="file-settings-body"><section class="workspace-settings-section"><h3>${settingsText('界面与浏览', 'Appearance & browsing')}</h3><p>${settingsText('下面的偏好即时生效并自动保存。', 'These preferences apply immediately and are saved automatically.')}</p><label class="settings-preference"><span><strong>${settingsText('外观主题', 'Appearance')}</strong><small>${settingsText('为整个工作空间选择明暗配色', 'Choose a color scheme for the workspace')}</small></span><select id="workspaceTheme"><option value="light">${settingsText('浅色', 'Light')}</option><option value="dark">${settingsText('深色', 'Dark')}</option></select></label><label class="settings-preference"><span><strong>${settingsText('文件预览面板', 'File preview pane')}</strong><small>${settingsText('独立显示图片、PDF、Word 和文件属性', 'Preview images, PDF, Word and file properties independently')}</small></span><input id="workspacePreview" type="checkbox" role="switch"></label>${card('columns', IC.list || IC.fileS, settingsText('显示列', 'Visible columns'), settingsText('选择文件列表中的属性和信息', 'Choose properties shown in the file list'))}</section><section class="workspace-settings-section"><h3>${settingsText('智能体', 'Agent')}</h3>${card('api', IC.tconsole, settingsText('模型接口', 'Model connection'), settingsText('配置服务地址、模型名称与 API Key', 'Configure endpoint, model and API key'))}${card('skills', IC.fileS, settingsText('本地技能', 'Local skills'), settingsText('导入 SKILL.md 并选择本轮使用的技能', 'Import SKILL.md and choose skills for a message'))}${card('memories', IC.folderS, settingsText('记忆与学习', 'Memory & learning'), settingsText('管理长期偏好与当前目录的记忆', 'Manage saved preferences and folder memories'))}</section><section class="workspace-settings-section"><h3>${settingsText('终端与工具', 'Terminals & tools')}</h3>${card('browser', IC.globe, settingsText('浏览器设置', 'Browser settings'), settingsText('主页、搜索、外观、隐私、下载与扩展', 'Home, search, appearance, privacy, downloads and extensions'))}${card('places', IC.folderS, settingsText('收藏与启动', 'Favorites & startup'), settingsText('收藏文件夹和网页，恢复上次的标签', 'Bookmark folders and websites; restore previous tabs'))}${card('history', IC.folderS, settingsText('访问历史', 'Visit history'), settingsText('重新打开文件夹路径和网页地址', 'Reopen folders and web addresses'))}${card('ssh', IC.globe, settingsText('SSH 连接', 'SSH connections'), settingsText('连接远程主机，管理常用连接与认证方式', 'Connect to remote hosts and manage connection profiles'))}${card('commands', IC.search, settingsText('快捷操作', 'Quick actions'), settingsText('查找常用操作、目录和打开的标签页', 'Find actions, folders and open tabs'), 'Ctrl K')}${card('search', IC.search, settingsText('搜索全部位置', 'Search everywhere'), settingsText('使用顶栏搜索框查询本地文件名索引', 'Use the top search field to query the local filename index'), 'Ctrl ⇧ F')}</section></div><footer class="file-settings-footer"><span id="workspaceSettingsStatus" class="settings-status" role="status">${settingsText('偏好保存在这台电脑上', 'Preferences stay on this computer')}</span><span class="file-settings-spacer"></span><button type="button" class="file-settings-primary" data-settings-close>${settingsText('完成', 'Done')}</button></footer>`;
  dialog.querySelectorAll('[data-settings-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.querySelector('#workspaceTheme').addEventListener('change', (event) => { document.documentElement.dataset.theme = event.target.value; store.set('theme', event.target.value); renderWorkspace(); $('workspaceSettingsStatus').textContent = settingsText('外观已保存', 'Appearance saved'); });
  dialog.querySelector('#workspacePreview').addEventListener('change', () => { togglePreview(); $('workspaceSettingsStatus').textContent = settingsText('预览偏好已保存', 'Preview preference saved'); });
  dialog.querySelectorAll('[data-settings-tool]').forEach((button) => button.addEventListener('click', () => {
    dialog.close();
    const action = button.dataset.settingsTool;
    if (action === 'browser') openBrowserSettings();
    else if (action === 'places') openPlacesSettings();
    else if (action === 'history') showBrowserHistory();
    else if (action === 'ssh') openSshConnect();
    else if (action === 'commands') openCommands();
    else if (action === 'search') openQuickSearch();
    else if (action === 'columns') openColumnPicker();
    else if (action === 'api') { openAiAssistant(); toggleAiSettings(true); }
    else { openAiAssistant(); openAgentProfile(action); }
  }));
  syncWorkspaceSettings(); dialog.showModal();
}
function syncWorkspaceSettings() {
  if (!$('workspaceTheme')) return;
  $('workspaceTheme').value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  $('workspacePreview').checked = previewOpen;
}

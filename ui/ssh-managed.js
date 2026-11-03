/* Native SSH/SFTP. Only non-secret connection metadata enters localStorage. */
const ms = (zh, en) => locale === 'en' ? en : zh;
let managedSshEvents = null;
function mountManagedSshForm(value = {}) {
  const form = $('sshConnectForm'); if (!form) return;
  if (!$('sshManagedFields')) {
    const section = document.createElement('section'); section.id = 'sshManagedFields'; section.className = 'ssh-managed-fields';
    section.innerHTML = `<label class="ssh-remember"><input id="sshManagedMode" type="checkbox">${esc(ms('内置 SSH · 凭据记忆与 SFTP', 'Built-in SSH · Credentials and SFTP'))}</label><p class="preview-note">${esc(ms('内置模式连接后自动显示远程目录，可上传/下载文件。关闭后为 OpenSSH 兼容模式，仅提供终端；多因素认证请使用兼容模式。', 'Built-in mode opens remote folders after login, with upload/download. Turn off for the terminal-only OpenSSH compatibility mode, including MFA.'))}</p><div id="sshManagedAuth"><label for="sshPassword">${esc(ms('密码 / 私钥口令', 'Password / key passphrase'))}</label><input id="sshPassword" type="password" autocomplete="new-password" maxlength="2048" placeholder="${esc(ms('留空使用已保存凭据；不回填密码', 'Leave blank for saved credentials; passwords are never displayed'))}"><label class="ssh-remember"><input id="sshRememberSecret" type="checkbox" checked>${esc(ms('连接成功后记住密码或口令', 'Remember password or passphrase after successful login'))}</label><small>${esc(ms('保存到当前 Windows 用户的凭据管理器，不写入连接列表；主机指纹变化后不会复用旧密码。', 'Stored in Windows Credential Manager for this user, never in the connection list. A changed host key cannot reuse the previous password.'))}</small><button type="button" id="sshForgetSecret" class="ssh-link">${esc(ms('忘记此连接的已保存密码', 'Forget saved credentials for this connection'))}</button></div>`;
    form.querySelector('.ssh-form-body').prepend(section);
    $('sshManagedMode').addEventListener('change', syncManagedSshForm);
    $('sshForgetSecret').addEventListener('click', async () => {
      const { config, errors } = validateSshConfig(readSshForm());
      if (Object.keys(errors).length) { showSshValidation(errors); return; }
      try { await invoke('ssh_forget_credential', { config: nativeSshConfig(config) }); setSshDialogStatus(ms('已忘记保存的密码；连接配置保留。', 'Saved credentials removed; connection settings retained.')); }
      catch (error) { setSshDialogStatus(String(error), true); }
    });
    const windows = document.createElement('option'); windows.value = 'windows'; windows.textContent = ms('Windows · 自动获取系统信息', 'Windows · Collect system information'); $('sshMode').append(windows);
  }
  // Old profiles without an engine choice now use the integrated file workspace.
  // Preserve only an explicit opt-out for MFA/agent-based OpenSSH workflows.
  $('sshManagedMode').checked = value.managed !== false;
  $('sshPassword').value = ''; $('sshRememberSecret').checked = true;
  if (value.infoMode) $('sshMode').value = value.infoMode;
  syncManagedSshForm();
}
function syncManagedSshForm() {
  const managed = $('sshManagedMode'); if (!managed) return;
  $('sshManagedAuth').hidden = !managed.checked;
  if ($('sshConnect')) $('sshConnect').disabled = sshDialogBusy || (!managed.checked && !sshClient?.available);
  if ($('sshClientStatus')) $('sshClientStatus').hidden = managed.checked;
  const security = sshDialog?.querySelector('.ssh-security-note'); if (security) security.hidden = managed.checked;
  const hint = $('sshIdentity')?.parentElement?.querySelector('small:not(.ssh-field-error)');
  if (hint) hint.textContent = managed.checked ? ms('可选：指定 OpenSSH 格式私钥，密码框填写私钥口令；其他密钥格式可尝试兼容模式。留空使用密码认证。', 'Optional OpenSSH-format private key; enter its passphrase above. Try compatibility mode for other key formats. Leave blank for password authentication.') : sshText('identityHint');
  if ($('sshModeHint')) $('sshModeHint').textContent = managed.checked ? ms('按服务器系统选择 Linux/macOS 或 Windows。网络设备请选择普通终端，不自动运行资源查询。', 'Select Linux/macOS or Windows. Use plain terminal for network devices to disable resource commands.') : sshText('modeHint');
}
function nativeSshConfig(config) { return { host: config.host, port: config.port, user: config.user, identityFile: config.identityFile || null, infoMode: config.infoMode || 'posix' }; }
function confirmManagedHost(config, probe) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'ssh-host-confirm';
    dialog.innerHTML = `<h2>${esc(probe.previous ? ms('主机指纹发生变化', 'Host fingerprint changed') : ms('首次连接：核对主机指纹', 'First connection: verify host fingerprint'))}</h2><p>${esc(sshAddress(config))}</p><p>${esc(ms('请通过服务器管理员或可信渠道核对以下指纹。确认前不会发送密码。', 'Verify this fingerprint with the administrator or a trusted channel. No password is sent before confirmation.'))}</p>${probe.previous ? `<p>${esc(ms('原指纹', 'Previous fingerprint'))}</p><code>${esc(probe.previous)}</code>` : ''}<p>${esc(ms('当前指纹', 'Current fingerprint'))}</p><code>${esc(probe.fingerprint)}</code><label><input type="checkbox">${esc(ms('我已核对并信任此主机', 'I have verified and trust this host'))}</label><footer><button type="button" data-cancel>${esc(ms('取消', 'Cancel'))}</button><button type="button" data-trust disabled>${esc(ms('信任并连接', 'Trust and connect'))}</button></footer>`;
    let settled = false; const finish = answer => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(answer); };
    dialog.querySelector('input').onchange = event => { dialog.querySelector('[data-trust]').disabled = !event.target.checked; };
    dialog.querySelector('[data-cancel]').onclick = () => finish(false);
    dialog.querySelector('[data-trust]').onclick = () => { if (dialog.querySelector('input').checked) finish(true); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    document.body.append(dialog); dialog.showModal(); dialog.querySelector('[data-cancel]').focus();
  });
}
async function submitManagedSsh(config, connect) {
  config = { ...config, managed: true };
  if (!connect) { saveSshProfile(config); renderSshSaved(); setSshDialogStatus(ms('连接已保存；密码仅在认证成功后保存。', 'Connection saved; passwords are saved only after successful authentication.')); return true; }
  const rememberProfile = $('sshRemember').checked, profileId = sshSelectedProfile;
  const auth = { secret: $('sshPassword').value || null, remember: $('sshRememberSecret').checked, useSaved: true };
  $('sshPassword').value = '';
  setSshDialogBusy(true); setSshDialogStatus(ms('正在核对主机身份…', 'Checking host identity…'));
  try {
    const probe = await invoke('ssh_probe_host', { config: nativeSshConfig(config) });
    if (!probe.trusted) {
      if (!await confirmManagedHost(config, probe)) { setSshDialogStatus(ms('连接已取消，未发送密码。', 'Cancelled before sending a password.')); return false; }
      await invoke('ssh_trust_host', { token: probe.token });
    }
    if (!auth.secret && !config.identityFile && !probe.hasCredential) { setSshDialogStatus(ms('请输入密码。此主机身份与用户尚无已保存凭据。', 'Enter a password. No saved credentials match this host identity and user.'), true); return false; }
    await ensureManagedSshEvents();
    sshDialog.close();
    const tab = await newSshTab(config, auth);
    if (tab?.termId != null && !tab.exited && rememberProfile) { saveSshProfile(config, profileId); renderSshSaved(); }
    return tab?.termId != null && !tab.exited;
  } catch (error) { if (sshDialog.open) setSshDialogStatus(String(error), true); else toast(String(error), true); return false; }
  finally { auth.secret = null; setSshDialogBusy(false); }
}
function ensureManagedSshEvents() {
  if (!managedSshEvents) managedSshEvents = (async () => {
    const unlisten = [];
    try {
      unlisten.push(await listen('ssh-managed-state', onManagedSshState));
      unlisten.push(await listen('ssh-managed-stats', onManagedSshStats));
      unlisten.push(await listen('ssh-transfer', onSshTransfer));
    } catch (error) { for (const stop of unlisten) stop(); managedSshEvents = null; throw error; }
  })();
  return managedSshEvents;
}
function managedEventTab(payload) {
  if (!payload || !Number.isInteger(payload.id) || typeof payload.key !== 'string') return null;
  return state.tabs.find(tb => isSshTab(tb) && tb.sshConfig?.managed && !tb.disposed && tb.key === payload.key && (tb.termId === payload.id || (tb.termId == null && tb.starting))) || null;
}
function onManagedSshState(event) {
  const payload = event?.payload, tb = managedEventTab(payload);
  if (!tb || tb.exited || tb.sshDisconnectRequested) return;
  tb.termId = payload.id; tb.sshAuthenticated = payload.authenticated === true;
  const terminalOrder = { starting: 0, ready: 1, unavailable: 2, closed: 2 };
  if (Object.hasOwn(terminalOrder, payload.terminalState) && terminalOrder[payload.terminalState] >= (terminalOrder[tb.sshTerminalState] ?? -1)) {
    tb.sshTerminalState = payload.terminalState;
    tb.sshTerminalMessage = typeof payload.terminalMessage === 'string' ? payload.terminalMessage : '';
    if (['unavailable', 'closed'].includes(payload.terminalState)) { tb.input = ''; tb.sshTerminalVisible = false; }
  }
  if (payload.warning) tb.sshActionMessage = String(payload.warning);
  syncSshInfo(tb); renderTabs();
  ensureSshFilePanel(tb);
  syncManagedTerminalUi(tb);
}
async function refreshManagedTerminalState(tb) {
  if (!tb.sshConfig?.managed || tb.termId == null || tb.exited || tb.disposed) return;
  const key = tb.key, id = tb.termId;
  try { const payload = await invoke('ssh_managed_status', { id }); if (tb.key === key && tb.termId === id && payload) onManagedSshState({ payload }); }
  catch { /* Connection teardown is reported by the existing connection event. */ }
}
function syncManagedTerminalUi(tb) {
  if (!tb.sshConfig?.managed || !tb.el) return;
  tb.el.classList.toggle('ssh-files-primary', true);
  tb.el.classList.toggle('ssh-terminal-collapsed', !tb.sshTerminalVisible);
  if (typeof mountSshWorkspace === 'function') mountSshWorkspace(tb);
  const terminal = tb.sshBar?.querySelector('[data-ssh-terminal]');
  if (terminal) {
    terminal.textContent = tb.sshTerminalVisible ? ms('收起终端', 'Hide terminal') : ms('显示终端', 'Show terminal');
    terminal.setAttribute('aria-expanded', String(!!tb.sshTerminalVisible));
  }
  const notice = tb.sshFilesPanel?.querySelector('[data-terminal-note]');
  const close = tb.sshFilesPanel?.querySelector('[data-close]');
  if (close) close.disabled = !tb.exited && !!tb.sshTerminalState && tb.sshTerminalState !== 'ready';
  if (notice) {
    notice.hidden = !['unavailable', 'closed'].includes(tb.sshTerminalState);
    notice.textContent = tb.sshTerminalMessage || ms('交互终端不可用，远程文件与传输仍可使用。', 'Interactive terminal unavailable. Remote files and transfers remain available.');
  }
  fitTerm(tb);
}
async function toggleManagedTerminal(tb) {
  await refreshManagedTerminalState(tb);
  if (tb.sshTerminalState !== 'ready' || tb.disposed || tb.exited) return;
  tb.sshTerminalVisible = !tb.sshTerminalVisible;
  if (!tb.sshTerminalVisible && tb.sshFilesPanel?.hidden) toggleSshFiles(tb);
  syncSshInfo(tb); syncManagedTerminalUi(tb);
  if (tb.sshTerminalVisible && curTab() === tb) tb.term?.focus();
}
function cleanSshStats(info) {
  const result = {};
  for (const key of ['hostname', 'os', 'kernel', 'arch', 'user', 'uptime', 'serverIp', 'memoryTotalKiB', 'memoryAvailableKiB', 'diskTotalKiB', 'diskUsedKiB', 'diskAvailableKiB', 'loadAverage']) {
    if (typeof info?.[key] === 'string') result[key] = info[key].replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 512);
  }
  return result;
}
function onManagedSshStats(event) {
  const payload = event?.payload, tb = managedEventTab(payload);
  if (!tb || tb.exited || tb.sshDisconnectRequested) return;
  tb.sshResources = cleanSshStats(payload.info); tb.sshInfo = tb.sshResources; tb.sshResourcesTime = Date.now(); syncSshInfo(tb);
}
async function refreshManagedStats(tb) {
  if (!tb.sshAuthenticated || tb.exited || tb.sshStatsBusy) return;
  const key = tb.key, id = tb.termId; tb.sshStatsBusy = true; syncSshInfo(tb);
  try {
    const info = await invoke('ssh_managed_stats', { id });
    if (tb.key === key && !tb.disposed && !tb.exited) { tb.sshInfo = tb.sshResources = cleanSshStats(info); tb.sshResourcesTime = Date.now(); tb.sshActionMessage = ''; }
  } catch (error) { if (tb.key === key && !tb.disposed) { tb.sshActionMessage = String(error); toast(String(error), true); } }
  finally { if (tb.key === key) { tb.sshStatsBusy = false; syncSshInfo(tb); } }
}
function sshSize(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return '—';
  const n = Number(value); if (n < 1024) return n + ' B';
  const unit = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** unit).toFixed(unit > 1 ? 1 : 0) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit];
}
function openSshFileManager(tb) {
  if (!isSshTab(tb) || tb.disposed) return;
  if (tb.sshConfig?.managed) { toggleSshFiles(tb); return; }
  // Open a reviewed, separate connection; never restart the existing shell or replay its input.
  openSshConnect({ ...sshSafeConfig(tb.sshConfig), managed: true });
  setSshDialogStatus(ms('当前连接是 OpenSSH 兼容终端。确认登录后将在新标签打开内置 SSH 与文件管理，原终端保持连接。', 'This is an OpenSSH terminal. Connect to open built-in SSH and file management in a new tab; the existing terminal stays connected.'));
}
function ensureSshFilePanel(tb) {
  if (!tb.sshConfig?.managed || !tb.sshAuthenticated || tb.termId == null || tb.exited || tb.disposed || tb.sshDisconnectRequested || !tb.el || !tb.termViewport || tb.sshFilesAutoKey === tb.key) return;
  tb.sshFilesAutoKey = tb.key;
  if (!tb.sshFilesPanel) toggleSshFiles(tb);
}
function syncSshFileButton(tb) {
  const button = tb.el?.querySelector('[data-ssh-files]');
  if (button && tb.sshConfig?.managed) button.setAttribute('aria-expanded', String(!!tb.sshFilesPanel && !tb.sshFilesPanel.hidden));
}
function renderManagedSshInfo(tb) {
  if (!tb.sshBar) return;
  const actions = tb.sshBar.querySelector('.ssh-info-actions'); if (!actions) return;
  const managed = tb.sshConfig?.managed, stopped = !tb.sshAuthenticated || tb.exited || tb.sshDisconnectRequested;
  const files = document.createElement('button'); files.type = 'button'; files.className = 'ssh-files-toggle'; files.dataset.sshFiles = '';
  files.textContent = ms('文件管理 / 传输', 'Files / Transfer'); files.disabled = !!tb.disposed || (managed && stopped);
  files.title = managed ? ms('浏览远程目录、上传和下载', 'Browse remote folders, upload and download') : ms('当前为 OpenSSH 兼容终端；点击新建内置 SFTP 连接', 'OpenSSH terminal; click to connect with built-in SFTP');
  files.onclick = () => openSshFileManager(tb);
  if (!managed || typeof mountSshWorkspace !== 'function') actions.before(files);
  syncSshFileButton(tb);
  const engine = document.createElement('p'); engine.className = 'ssh-engine-note';
  engine.textContent = managed ? ms('内置 SSH · SFTP 文件管理', 'Built-in SSH · SFTP file management') : ms('OpenSSH 兼容模式 · 仅终端，文件传输请点击「文件管理 / 传输」', 'OpenSSH compatibility mode · Terminal only. Use Files / Transfer to open an SFTP connection.');
  tb.sshBar.querySelector('.ssh-info-top').after(engine);
  if (tb.sshFilesPanel) updateSshTransferControls(tb);
  if (!managed) return;
  const button = (text, fn, disabled = false) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.disabled = disabled; b.onclick = fn; actions.append(b); };
  const terminal = document.createElement('button'); terminal.type = 'button'; terminal.dataset.sshTerminal = '';
  terminal.textContent = tb.sshTerminalVisible ? ms('收起终端', 'Hide terminal') : ms('显示终端', 'Show terminal');
  terminal.disabled = stopped || (tb.sshTerminalState && tb.sshTerminalState !== 'ready');
  terminal.setAttribute('aria-expanded', String(!!tb.sshTerminalVisible)); terminal.onclick = () => toggleManagedTerminal(tb);
  if (typeof mountSshWorkspace !== 'function') actions.prepend(terminal);
  const interrupt = actions.querySelector('[data-ssh-action="interrupt"]'); if (interrupt && tb.sshTerminalState && tb.sshTerminalState !== 'ready') interrupt.disabled = true;
  syncManagedTerminalUi(tb);
  if (tb.sshConfig.infoMode !== 'shell') button(ms('刷新资源', 'Refresh resources'), () => refreshManagedStats(tb), stopped || tb.sshStatsBusy);
  const info = tb.sshResources || {};
  const total = Number(info.memoryTotalKiB), available = Number(info.memoryAvailableKiB);
  const memory = Number.isFinite(total) && total > 0 ? sshSize(total * 1024) : '—';
  const free = Number.isFinite(available) && available >= 0 ? sshSize(available * 1024) : '—';
  const resources = document.createElement('div'); resources.className = 'ssh-resource-grid';
  resources.innerHTML = `<div><small>${esc(ms('内存 · 总量 / 可用', 'Memory · Total / available'))}</small><strong>${esc(memory)} / ${esc(free)}</strong></div><div><small>${esc(ms('系统磁盘 · 总量 / 可用', 'System disk · Total / available'))}</small><strong>${esc(sshSize(info.diskTotalKiB == null ? null : Number(info.diskTotalKiB) * 1024))} / ${esc(sshSize(info.diskAvailableKiB == null ? null : Number(info.diskAvailableKiB) * 1024))}</strong></div><div><small>${esc(info.loadAverage ? ms('平均负载 · 1 / 5 / 15 分钟', 'Load average · 1 / 5 / 15 min') : ms('采集时间', 'Collected at'))}</small><strong>${esc(info.loadAverage || (tb.sshResourcesTime ? new Date(tb.sshResourcesTime).toLocaleTimeString() : '—'))}</strong></div>`;
  tb.sshBar.append(resources);
  if (typeof fitTerm === 'function') fitTerm(tb);
}
function resetSshFiles(tb) {
  if (typeof disconnectSshQueue === 'function') disconnectSshQueue(tb);
  if (tb.sshFiles) tb.sshFiles.generation++;
  tb.sshFilesPanel?.remove(); tb.sshFilesPanel = null; tb.sshFiles = null; tb.sshTransfer = null;
  tb.sshFilesAutoKey = null;
  tb.sshTerminalState = 'starting'; tb.sshTerminalMessage = ''; tb.sshTerminalVisible = true;
  tb.sshStatsBusy = false; tb.el?.classList.remove('ssh-files-open');
}
function toggleSshFiles(tb) {
  if (!tb.sshConfig?.managed || tb.disposed) return;
  if (tb.sshFilesPanel) {
    if (!tb.sshFilesPanel.hidden && tb.sshTerminalState && tb.sshTerminalState !== 'ready' && !tb.exited) return;
    tb.sshFilesPanel.hidden = !tb.sshFilesPanel.hidden;
    if (tb.sshFilesPanel.hidden && tb.sshTerminalState === 'ready') tb.sshTerminalVisible = true;
    tb.el.classList.toggle('ssh-files-open', !tb.sshFilesPanel.hidden); syncSshFileButton(tb); syncManagedTerminalUi(tb); return;
  }
  if (!tb.sshAuthenticated || tb.termId == null || tb.exited || tb.sshDisconnectRequested) return;
  const panel = document.createElement('section'); panel.className = 'ssh-files';
  panel.setAttribute('aria-label', ms('远程文件管理', 'Remote file manager'));
  panel.innerHTML = `<div class="ssh-files-heading"><strong>${esc(ms('远程文件', 'Remote files'))} <small>SFTP</small></strong><button type="button" data-tasks>${esc(ms('传输任务', 'Transfers'))}</button><button type="button" data-close aria-label="${esc(ms('收起文件面板', 'Hide file panel'))}">×</button></div><div class="ssh-files-toolbar"><button type="button" data-up aria-label="${esc(ms('上一级', 'Parent folder'))}">↑</button><input data-path aria-label="${esc(ms('远程目录路径', 'Remote directory path'))}" spellcheck="false"><button type="button" data-go>${esc(ms('前往', 'Go'))}</button><button type="button" data-refresh>${esc(ms('刷新', 'Refresh'))}</button></div><div class="ssh-files-actions"><button type="button" data-upload>${esc(ms('上传文件', 'Upload files'))}</button><button type="button" data-download disabled>${esc(ms('下载', 'Download'))}</button></div><p class="ssh-files-status" role="status"></p><div class="ssh-files-list" role="listbox" aria-label="${esc(ms('远程文件', 'Remote files'))}"></div><div class="ssh-transfer-status" role="status"></div>`;
  tb.sshFilesPanel = panel; tb.sshFiles = { path: '.', entries: [], selected: -1, generation: 0, busy: false, ready: false };
  const notice = document.createElement('p'); notice.dataset.terminalNote = ''; notice.className = 'ssh-terminal-notice'; notice.hidden = true;
  panel.querySelector('.ssh-files-status').before(notice);
  tb.el.insertBefore(panel, tb.termViewport); tb.el.classList.add('ssh-files-open');
  panel.addEventListener('keydown', event => event.stopPropagation());
  panel.querySelector('[data-path]').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); loadSshFiles(tb, event.target.value); } };
  panel.querySelector('[data-go]').onclick = () => loadSshFiles(tb, panel.querySelector('[data-path]').value);
  panel.querySelector('[data-refresh]').onclick = () => loadSshFiles(tb, tb.sshFiles.path);
  panel.querySelector('[data-up]').onclick = () => loadSshFiles(tb, tb.sshFiles.path.replace(/\/?[^/]+\/?$/, '') || '/');
  panel.querySelector('[data-close]').onclick = () => toggleSshFiles(tb);
  panel.querySelector('[data-tasks]').onclick = () => openSshTaskCenter();
  panel.querySelector('[data-upload]').onclick = () => typeof beginSshBatch === 'function' ? beginSshBatch(tb, 'upload') : startSshFileTransfer(tb, 'upload');
  const uploadFolder = document.createElement('button'); uploadFolder.textContent = ms('上传文件夹', 'Upload folder'); uploadFolder.dataset.uploadFolder = ''; panel.querySelector('[data-upload]').after(uploadFolder); uploadFolder.onclick = () => beginSshBatch(tb, 'upload', true);
  panel.querySelector('[data-download]').onclick = () => typeof beginSshBatch === 'function' ? beginSshBatch(tb, 'download') : startSshFileTransfer(tb, 'download');
  tb.sshFiles.selection = new Set(); tb.sshFiles.anchor = -1;
  const list = panel.querySelector('.ssh-files-list'); list.setAttribute('aria-multiselectable', 'true'); list.tabIndex = 0;
  const selectAll = document.createElement('button'); selectAll.type = 'button'; selectAll.dataset.selectFiles = ''; selectAll.textContent = ms('全选文件', 'Select files');
  panel.querySelector('[data-upload]').before(selectAll);
  selectAll.onclick = () => {
    const view = tb.sshFiles; if (!view || view.busy) return;
    const entries = typeof visibleSshEntries === 'function' ? visibleSshEntries(view) : view.entries.map((entry,index)=>({entry,index}));
    view.selection = new Set(entries.filter(({entry})=>!entry.isDir&&!entry.isLink).map(({index})=>index).slice(0,200));
    paintSshFileSelection(tb); if (view.entries.filter((e) => !e.isDir && !e.isLink).length > 200) toast(ms('已选择前 200 个文件。', 'Selected the first 200 files.'));
  };
  list.addEventListener('keydown', (event) => { if (event.ctrlKey && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll.click(); } });
  if (typeof mountSshDirectoryTools === 'function') mountSshDirectoryTools(tb);
  void loadSshFiles(tb, '.'); syncSshFileButton(tb); syncManagedTerminalUi(tb);
}
async function loadSshFiles(tb, path, { preserveSelection = false } = {}) {
  const view = tb.sshFiles; if (!view || !path || tb.exited || tb.disposed || tb.sshDisconnectRequested || !tb.sshAuthenticated) return;
  const selectedNames = preserveSelection && path === view.path ? new Set(view.entries.filter((_, index) => view.selection?.has(index)).map((entry) => entry.name)) : new Set();
  const generation = ++view.generation, key = tb.key, id = tb.termId;
  view.busy = true; view.ready = false; renderSshFiles(tb, ms('正在读取远程目录…', 'Loading remote directory…'));
  try {
    const result = await invoke('ssh_files_list', { id, path });
    if (tb.disposed || tb.exited || tb.sshDisconnectRequested || tb.key !== key || tb.sshFiles !== view || view.generation !== generation) return;
    if (view.path !== result.path) { view.filter = ''; const filter = tb.sshFilesPanel?.querySelector('[data-remote-filter]'); if(filter)filter.value=''; }
    view.home ||= result.path;
    view.path = result.path; view.entries = Array.isArray(result.entries) ? result.entries : []; view.selected = -1; view.busy = false; view.ready = true;
    view.selection = new Set(view.entries.map((entry, index) => selectedNames.has(entry.name) ? index : -1).filter((i) => i >= 0)); view.anchor = -1;
    renderSshFiles(tb, result.truncated ? ms('目录过大，仅显示前 5000 项或已达到文本上限。', 'Large directory: limited to 5000 entries or the text budget.') : `${view.entries.length} ${ms('项', 'items')}`);
  } catch (error) { if (!tb.disposed && !tb.exited && !tb.sshDisconnectRequested && tb.key === key && tb.sshFiles === view && view.generation === generation) { view.busy = false; renderSshFiles(tb, ms('无法读取远程目录。请确认服务器已启用 SFTP 或目录权限，点击刷新重试。', 'Unable to list this folder. Check server SFTP support and directory permissions, then refresh to retry.') + ' ' + String(error), true); } }
}
function renderSshFiles(tb, status, error = false) {
  const panel = tb.sshFilesPanel, view = tb.sshFiles; if (!panel || !view) return;
  view.lastStatus = status; view.lastError = error;
  panel.querySelector('[data-path]').value = view.path;
  const note = panel.querySelector('.ssh-files-status'); note.textContent = status; note.classList.toggle('is-error', error);
  const list = panel.querySelector('.ssh-files-list'); list.replaceChildren();
  list.setAttribute('aria-busy', String(view.busy));
  const visible = typeof visibleSshEntries === 'function' ? visibleSshEntries(view) : view.entries.map((entry,index)=>({entry,index}));
  if (!visible.length) {
    const empty = document.createElement('p'); empty.className = 'ssh-files-empty';
    empty.textContent = view.busy ? ms('正在加载目录…', 'Loading folder…') : error ? ms('目录尚未加载', 'Folder not loaded') : view.filter ? ms('没有匹配的文件', 'No matching files') : ms('此目录为空', 'This folder is empty'); list.append(empty);
  }
  visible.forEach(({entry, index}) => {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'ssh-file-row'; row.dataset.index = index; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(view.selection?.has(index) || false));
    row.innerHTML = `<span>${esc(entry.isDir ? '📁' : entry.isLink ? '↗' : '▤')}</span><span title="${esc(entry.name)}">${esc(entry.name)}</span><small>${esc(entry.isDir ? '—' : sshSize(entry.size))}</small><small>${esc(entry.modified ? new Date(entry.modified * 1000).toLocaleString() : '—')}</small>`;
    row.onclick = (event) => {
      if (view.busy || view.ready === false || tb.exited || tb.sshDisconnectRequested) return;
      const selection = view.selection ||= new Set();
      if (event.shiftKey && view.anchor >= 0) { if (!event.ctrlKey) selection.clear(); for (let i = Math.min(index, view.anchor); i <= Math.max(index, view.anchor); i++) selection.add(i); }
      else if (event.ctrlKey) { if (selection.has(index)) selection.delete(index); else selection.add(index); view.anchor = index; }
      else { selection.clear(); selection.add(index); view.anchor = index; }
      view.selected = index; paintSshFileSelection(tb);
    };
    row.ondblclick = () => { if (view.busy || view.ready === false || tb.exited || tb.sshDisconnectRequested) return; view.selected = index; if (entry.isDir || entry.isLink) loadSshFiles(tb, remoteChild(view.path, entry.name)); else { view.selection = new Set([index]); paintSshFileSelection(tb); if (typeof beginSshBatch === 'function') void beginSshBatch(tb, 'download'); else startSshFileTransfer(tb, 'download'); } };
    list.append(row);
  });
  updateSshTransferControls(tb);
}
function paintSshFileSelection(tb) {
  const view = tb.sshFiles; if (!view || !tb.sshFilesPanel) return;
  for (const row of tb.sshFilesPanel.querySelectorAll('.ssh-file-row')) row.setAttribute('aria-selected', String(view.selection.has(Number(row.dataset.index))));
  updateSshTransferControls(tb);
}
function remoteChild(parent, name) { return parent.replace(/\/+$/, '') + '/' + name; }
function transferActive(tb) { return ['starting', 'running', 'finalizing'].includes(tb.sshTransfer?.status); }
function updateSshTransferControls(tb) {
  const panel = tb.sshFilesPanel, view = tb.sshFiles; if (!panel || !view) return;
  const queue = typeof beginSshBatch === 'function';
  const disconnected = tb.exited || tb.disposed || tb.sshDisconnectRequested || !tb.sshAuthenticated;
  const busy = view.busy || view.ready === false || (queue ? tb.sshBatchPicking : transferActive(tb)) || disconnected;
  for (const control of panel.querySelectorAll('[data-up], [data-go], [data-refresh], [data-path], [data-root], [data-home], [data-remote-copy]')) control.disabled = view.busy || disconnected;
  const select = panel.querySelector('[data-select-files]'); if (select) select.disabled = view.busy || view.ready === false || disconnected;
  panel.querySelector('[data-upload]').disabled = busy;
  const folderButton = panel.querySelector('[data-upload-folder]'); if (folderButton) folderButton.disabled = busy;
  const selected = view.entries[view.selected];
  const count = queue ? selectedSshFiles(view).length : selected && !selected.isDir && !selected.isLink ? 1 : 0;
  panel.querySelector('[data-download]').disabled = busy || !count;
  panel.querySelector('[data-download]').textContent = ms('下载', 'Download') + (count ? ` (${count})` : '');
}
async function startSshFileTransfer(tb, direction) {
  const view = tb.sshFiles; if (!view || view.busy || view.ready === false || transferActive(tb) || tb.exited || tb.disposed || !tb.sshAuthenticated || tb.sshDisconnectRequested) return;
  const entry = view.entries[view.selected]; if (direction === 'download' && (!entry || entry.isDir || entry.isLink)) return;
  const key = tb.key, id = tb.termId, directory = view.path;
  tb.sshTransfer = { status: 'starting', name: entry?.name || '', bytes: 0, total: 0, direction }; renderSshTransfer(tb);
  try {
    const localPath = await invoke('ssh_pick_file', { save: direction === 'download', name: direction === 'download' ? entry.name : null });
    if (tb.disposed || tb.key !== key || tb.exited) return;
    if (!localPath) { tb.sshTransfer = null; renderSshTransfer(tb); return; }
    const token = await invoke('ssh_file_transfer', { id, direction, localPath, remote: direction === 'upload' ? directory : remoteChild(directory, entry.name) });
    if (tb.key === key && tb.sshTransfer && !tb.sshTransfer.transferId) tb.sshTransfer.transferId = token;
  } catch (error) { if (tb.key === key && !tb.disposed) { tb.sshTransfer = { ...tb.sshTransfer, status: 'failed', error: String(error) }; renderSshTransfer(tb); } }
}
function onSshTransfer(event) {
  if (typeof receiveSshQueuedTransfer === 'function' && receiveSshQueuedTransfer(event?.payload)) return;
  const payload = event?.payload, tb = managedEventTab(payload);
  if (!tb || typeof payload.transferId !== 'string' || !['running', 'finalizing', 'complete', 'cancelled', 'failed'].includes(payload.status)) return;
  if (tb.sshTransfer?.transferId && tb.sshTransfer.transferId !== payload.transferId) return;
  const previous = tb.sshTransfer;
  tb.sshTransfer = { ...payload, started: previous?.started || Date.now() }; renderSshTransfer(tb);
  if (payload.status === 'complete' && payload.direction === 'upload' && tb.sshFiles) void loadSshFiles(tb, tb.sshFiles.path);
}
function renderSshTransfer(tb) {
  if (typeof renderSshQueueSummary === 'function' && renderSshQueueSummary(tb)) return;
  const panel = tb.sshFilesPanel; if (!panel) return;
  const host = panel.querySelector('.ssh-transfer-status'), transfer = tb.sshTransfer; host.replaceChildren();
  if (transfer) {
    const labels = { starting: ms('选择本地文件…', 'Choose a local file…'), running: ms('传输中', 'Transferring'), finalizing: ms('正在完成保存', 'Finalizing'), complete: ms('传输完成', 'Complete'), cancelled: ms('已取消', 'Cancelled'), failed: ms('传输失败', 'Failed') };
    const elapsed = Math.max(1, (Date.now() - (transfer.started || Date.now())) / 1000);
    const label = document.createElement('span'); label.textContent = `${labels[transfer.status] || ''} · ${transfer.name || ''} · ${sshSize(transfer.bytes)} / ${sshSize(transfer.total)}${transfer.status === 'running' ? ' · ' + sshSize(transfer.bytes / elapsed) + '/s' : ''}`; host.append(label);
    const progress = document.createElement('progress'); progress.max = Math.max(1, Number(transfer.total) || 1); progress.value = Number(transfer.bytes) || 0; host.append(progress);
    if (transfer.error) { const error = document.createElement('p'); error.textContent = transfer.error; error.className = 'is-error'; host.append(error); }
    if (transfer.status === 'running' && transfer.transferId) {
      const cancel = document.createElement('button'); cancel.textContent = ms('取消传输', 'Cancel transfer'); cancel.onclick = async () => {
        cancel.disabled = true;
        try { await invoke('ssh_transfer_cancel', { id: tb.termId, transferId: transfer.transferId }); }
        catch (error) { toast(String(error), true); cancel.disabled = false; }
      }; host.append(cancel);
    }
  }
  updateSshTransferControls(tb);
}

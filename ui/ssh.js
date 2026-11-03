/* SSH uses the native OpenSSH client. Profiles contain connection metadata only. */
const SSH_TEXT = {
  zh: {
    title: '连接远程服务器', intro: '在独立标签页中使用 SSH，保留本地文件工作空间。', saved: '已保存的连接', new: '新建连接', empty: '还没有保存连接', emptyHint: '填写服务器信息后，可保存到这台电脑。',
    label: '连接名称', labelHint: '例如：开发服务器', host: '主机 / IP 地址', user: '用户名', port: '端口', identity: '私钥文件路径', optional: '可选', identityHint: '填写本机私钥的完整路径；留空使用 OpenSSH 默认密钥或在终端输入密码。',
    mode: '远程系统', posix: 'Linux / macOS · 自动获取系统信息', shell: 'Windows / 网络设备 · 普通终端', modeHint: '普通终端不运行系统信息采集。连接是否成功以终端输出为准。',
    security: '首次连接请在终端核对服务器指纹，再确认信任。密码和密钥口令只在终端中输入，不会保存到连接列表。', save: '保存连接', remember: '同时保存此连接', connect: '连接', cancel: '取消', remove: '删除连接', edit: '编辑连接',
    clientChecking: '正在检查 OpenSSH 客户端…', clientReady: 'OpenSSH 客户端可用', clientMissing: '未找到 OpenSSH 客户端', clientInstall: '请打开 Windows 设置 → 系统 → 可选功能 → 查看功能，安装“OpenSSH 客户端”，然后重新检查。', retry: '重新检查', clientFailed: '无法检查 SSH 客户端',
    hostRequired: '请输入主机名或 IP 地址。', hostInvalid: '请输入有效的主机名、IPv4 或 IPv6；不要包含协议、端口、用户名或命令。', userRequired: '请输入远程用户名。', userInvalid: '用户名最多 64 个字符，以字母、数字或下划线开头，可包含点和短横线。', portInvalid: '端口必须是 1 到 65535 之间的整数。', identityInvalid: '请输入带盘符的完整私钥路径，最多 4096 个字符，不含百分号、单双引号、额外冒号或控制字符。', labelInvalid: '连接名称最多 80 个字符，不能包含控制字符。', modeInvalid: '请选择远程系统类型。',
    savedNotice: '连接已保存；密码和私钥内容不会保存。', removed: '连接已删除', launching: '正在打开终端…', failed: '连接失败', connecting: '正在启动 SSH', authenticating: '等待终端认证 / 系统信息', connected: '已连接', sessionStarted: '会话已启动', disconnected: '已断开', disconnecting: '正在断开',
    reconnect: '重新登录', disconnect: '强制断开', interrupt: '发送 Ctrl+C', editSession: '修改连接', reconnecting: '正在重新登录', operationError: '操作异常', reloginSeparator: '重新登录 SSH · 保留上次输出', interruptQueued: '已排队中断，进程启动后发送 Ctrl+C。', interruptSending: '正在发送 Ctrl+C…', interruptSent: '已发送 Ctrl+C。', interruptFailedHint: '可重试中断，或使用强制断开后重新登录。', exitedInterrupt: '会话已退出，请重新登录。', cancelWaiting: '正在取消启动，等待进程清理完成。', selectionCopied: '已复制终端选区', copy: '复制地址', copied: '连接地址已复制', copyFailed: '无法复制地址', system: '系统', hostname: '主机名', serverIp: '服务器 IP', kernel: '内核', arch: '架构', remoteUser: '远程用户', uptime: '运行时长', unknown: '待获取',
    terminalHint: '请在下方终端完成主机指纹确认、密码或密钥口令输入。', shellHint: '普通终端模式不会自动采集远程信息；请查看终端输出确认连接状态。', disconnectedHint: '终端输出已保留。重新登录会在此标签开始新会话，不会重放之前的输入或远程命令。', connectionAddress: '连接地址', details: '系统信息',
  },
  en: {
    title: 'Connect to a server', intro: 'Open SSH in its own tab alongside your local file workspace.', saved: 'Saved connections', new: 'New connection', empty: 'No saved connections', emptyHint: 'Enter server details and save them on this computer.',
    label: 'Connection name', labelHint: 'For example: Development server', host: 'Host / IP address', user: 'Username', port: 'Port', identity: 'Private key file', optional: 'Optional', identityHint: 'Use the full path to a local key. Leave blank for default OpenSSH keys or a password prompt in the terminal.',
    mode: 'Remote system', posix: 'Linux / macOS · Collect system information', shell: 'Windows / network device · Plain terminal', modeHint: 'Plain terminal does not collect system information. Check terminal output to verify the connection.',
    security: 'On first connection, verify the server fingerprint in the terminal before trusting it. Passwords and key passphrases are entered only in the terminal and never saved in this list.', save: 'Save connection', remember: 'Also save this connection', connect: 'Connect', cancel: 'Cancel', remove: 'Delete connection', edit: 'Edit connection',
    clientChecking: 'Checking OpenSSH client…', clientReady: 'OpenSSH client available', clientMissing: 'OpenSSH client not found', clientInstall: 'Open Windows Settings → System → Optional features → View features, install OpenSSH Client, then check again.', retry: 'Check again', clientFailed: 'Unable to check the SSH client',
    hostRequired: 'Enter a hostname or IP address.', hostInvalid: 'Enter a hostname, IPv4 or IPv6 without a protocol, port, username or command.', userRequired: 'Enter the remote username.', userInvalid: 'Use up to 64 letters, numbers, dots, underscores or hyphens. Start with a letter, number or underscore.', portInvalid: 'Use a whole-number port from 1 to 65535.', identityInvalid: 'Use a full drive-letter path up to 4096 characters, without percent signs, single or double quotes, extra colons or control characters.', labelInvalid: 'Keep the name within 80 characters with no control characters.', modeInvalid: 'Choose a remote system type.',
    savedNotice: 'Connection saved. Passwords and key contents are never saved.', removed: 'Connection deleted', launching: 'Opening a terminal…', failed: 'Connection failed', connecting: 'Starting SSH', authenticating: 'Waiting for terminal authentication / system information', connected: 'Connected', sessionStarted: 'Session started', disconnected: 'Disconnected', disconnecting: 'Disconnecting',
    reconnect: 'Log in again', disconnect: 'Force disconnect', interrupt: 'Send Ctrl+C', editSession: 'Edit connection', reconnecting: 'Logging in again', operationError: 'Operation error', reloginSeparator: 'New SSH login · previous output retained', interruptQueued: 'Interrupt queued. Ctrl+C will be sent when the process starts.', interruptSending: 'Sending Ctrl+C…', interruptSent: 'Ctrl+C sent.', interruptFailedHint: 'Retry the interrupt, or force disconnect and log in again.', exitedInterrupt: 'Session exited. Log in again.', cancelWaiting: 'Cancelling startup; waiting for process cleanup.', selectionCopied: 'Terminal selection copied', copy: 'Copy address', copied: 'Connection address copied', copyFailed: 'Unable to copy the address', system: 'System', hostname: 'Hostname', serverIp: 'Server IP', kernel: 'Kernel', arch: 'Architecture', remoteUser: 'Remote user', uptime: 'Uptime', unknown: 'Pending',
    terminalHint: 'Complete host fingerprint verification, password or key passphrase prompts in the terminal below.', shellHint: 'Plain terminal does not collect remote information. Check terminal output to verify the connection.', disconnectedHint: 'Output is retained. Log in again in this tab without replaying previous input or remote commands.', connectionAddress: 'Connection address', details: 'System information',
  },
};
const sshText = (key) => SSH_TEXT[locale === 'en' ? 'en' : 'zh'][key] || key;
const isSshTab = (tb) => !!tb && tb.kind === 'term' && tb.connection === 'ssh';
let sshDialog = null, sshDialogBusy = false, sshSelectedProfile = null, sshClient = null, sshClientCheck = 0, sshEventsPromise = null;
let sshProfiles = [];
let sshValidatedFields = new Set();
const sshFieldIds = { host: 'sshHost', user: 'sshUser', port: 'sshPort', identity: 'sshIdentity', label: 'sshLabel', mode: 'sshMode' };
const sshProfileStoreKey = 'sshConnections';
function sshSafeConfig(value = {}) {
  return { label: String(value.label || '').trim(), host: String(value.host || '').trim().replace(/^\[([^\]]+)\]$/, '$1'), port: value.port == null || value.port === '' ? 22 : Number(value.port), user: String(value.user || '').trim(), identityFile: String(value.identityFile ?? value.keyPath ?? '').trim(), infoMode: value.infoMode || 'posix', ...(typeof value.managed === 'boolean' ? { managed: value.managed } : {}) };
}
function validateSshConfig(value) {
  const config = sshSafeConfig(value), errors = {};
  if (!config.host) errors.host = 'hostRequired';
  else if (config.host.length > 253 || /[^a-zA-Z0-9.:-]/.test(config.host) || config.host.startsWith('-')) errors.host = 'hostInvalid';
  else if (config.host.includes(':')) { try { new URL('http://[' + config.host + ']/'); } catch { errors.host = 'hostInvalid'; } }
  else if (!config.host.replace(/\.+$/, '').split('.').every((part) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(part))) errors.host = 'hostInvalid';
  if (!config.user) errors.user = 'userRequired';
  else if (config.user.length > 64 || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(config.user)) errors.user = 'userInvalid';
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) errors.port = 'portInvalid';
  if (config.identityFile && (config.identityFile.length > 4096 || /[\x00-\x1f\x7f%"']/.test(config.identityFile) || !/^[a-zA-Z]:[\\/]/.test(config.identityFile) || config.identityFile.slice(2).includes(':'))) errors.identity = 'identityInvalid';
  if (Array.from(config.label).length > 80 || /[\x00-\x1f\x7f]/.test(config.label)) errors.label = 'labelInvalid';
  if (!['posix', 'windows', 'shell'].includes(config.infoMode)) errors.mode = 'modeInvalid';
  return { config, errors };
}
function sshAddress(config) {
  const value = sshSafeConfig(config), host = value.host.includes(':') ? '[' + value.host + ']' : value.host;
  return value.user + '@' + host + ':' + value.port;
}
function sshTabTitle(tb) { return 'SSH · ' + (tb.sshConfig?.label || tb.sshConfig?.host || '') + (tb.exited ? ' ⏹' : tb.starting ? ' …' : ''); }
function readSshProfiles() {
  const values = store.get(sshProfileStoreKey, []);
  sshProfiles = (Array.isArray(values) ? values : []).slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { config, errors } = validateSshConfig(item);
    if (Object.keys(errors).length) return [];
    return [{ id: typeof item.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.id) ? item.id : crypto.randomUUID(), ...config }];
  });
  return sshProfiles;
}
function persistSshProfiles() {
  store.set(sshProfileStoreKey, sshProfiles.map(({ id, label, host, port, user, identityFile, infoMode, managed }) => ({ id, label, host, port, user, keyPath: identityFile, infoMode, ...(typeof managed === 'boolean' ? { managed } : {}) })));
}
function saveSshProfile(config, id = sshSelectedProfile) {
  const validated = validateSshConfig(config);
  if (Object.keys(validated.errors).length) throw new Error(sshText(Object.values(validated.errors)[0]));
  const existing = sshProfiles.find((profile) => profile.id === id);
  const profile = { id: existing?.id || crypto.randomUUID(), ...validated.config };
  if (existing) sshProfiles.splice(sshProfiles.indexOf(existing), 1, profile); else sshProfiles.unshift(profile);
  sshProfiles = sshProfiles.slice(0, 50); persistSshProfiles(); sshSelectedProfile = profile.id;
  return profile;
}
function readSshForm() { return { label: $('sshLabel').value, host: $('sshHost').value, port: $('sshPort').value, user: $('sshUser').value, identityFile: $('sshIdentity').value, infoMode: $('sshMode').value }; }
function fillSshForm(value = {}) {
  const config = sshSafeConfig(value);
  for (const [id, key] of [['sshLabel', 'label'], ['sshHost', 'host'], ['sshPort', 'port'], ['sshUser', 'user'], ['sshIdentity', 'identityFile'], ['sshMode', 'infoMode']]) $(id).value = config[key];
  $('sshRemember').checked = true;
  if (typeof mountManagedSshForm === 'function') mountManagedSshForm(value);
  showSshValidation({}); setSshDialogStatus(''); renderSshSaved();
}
function showSshValidation(errors) {
  sshValidatedFields = new Set(Object.keys(errors));
  for (const [key, id] of Object.entries(sshFieldIds)) {
    $(id).setAttribute('aria-invalid', String(!!errors[key])); $(id + 'Error').textContent = errors[key] ? sshText(errors[key]) : ''; $(id + 'Error').hidden = !errors[key];
  }
}
function refreshSshFieldValidation(event) {
  const entry = Object.entries(sshFieldIds).find(([, id]) => id === event.target.id);
  if (!entry || !sshValidatedFields.has(entry[0])) return;
  const [key, id] = entry, error = validateSshConfig(readSshForm()).errors[key];
  $(id).setAttribute('aria-invalid', String(!!error)); $(id + 'Error').textContent = error ? sshText(error) : ''; $(id + 'Error').hidden = !error;
}
function setSshDialogStatus(message, error = false) { if ($('sshDialogStatus')) { $('sshDialogStatus').textContent = message; $('sshDialogStatus').classList.toggle('is-error', error); } }
function renderSshSaved() {
  const list = $('sshSavedList'); if (!list) return;
  list.innerHTML = sshProfiles.length ? sshProfiles.map((profile) => `<div class="ssh-saved-item${profile.id === sshSelectedProfile ? ' selected' : ''}"><button type="button" data-ssh-profile="${esc(profile.id)}" aria-label="${esc(sshText('edit') + ': ' + (profile.label || profile.host))}"><strong>${esc(profile.label || profile.host)}</strong><span>${esc(sshAddress(profile))}</span></button><button type="button" class="ssh-saved-remove" data-ssh-remove="${esc(profile.id)}" title="${esc(sshText('remove'))}" aria-label="${esc(sshText('remove') + ': ' + (profile.label || profile.host))}">×</button></div>`).join('') : `<div class="ssh-empty"><span aria-hidden="true">⌁</span><strong>${esc(sshText('empty'))}</strong><p>${esc(sshText('emptyHint'))}</p></div>`;
  setSshDialogBusy(sshDialogBusy);
}
function setSshDialogBusy(busy) {
  sshDialogBusy = busy;
  sshDialog?.querySelectorAll('button,input,select').forEach((element) => { element.disabled = busy; });
  if ($('sshConnect')) $('sshConnect').disabled = busy || !sshClient?.available;
  if (typeof syncManagedSshForm === 'function') syncManagedSshForm();
}
function renderSshClient(error = '') {
  const target = $('sshClientStatus'); if (!target) return;
  const available = sshClient?.available;
  target.classList.toggle('is-error', !!error || sshClient?.available === false);
  target.innerHTML = `<span class="ssh-client-dot" aria-hidden="true"></span><div><strong>${esc(error ? sshText('clientFailed') : sshClient == null ? sshText('clientChecking') : sshText(available ? 'clientReady' : 'clientMissing'))}</strong>${error ? `<small>${esc(error)}</small>` : available ? `<small title="${esc(sshClient.path || '')}">${esc(sshClient.version || sshClient.path || '')}</small>` : sshClient ? `<small>${esc(sshText('clientInstall'))}</small>` : ''}</div>${error || sshClient?.available === false ? `<button type="button" data-ssh-dialog="check" class="ssh-link">${esc(sshText('retry'))}</button>` : ''}`;
  setSshDialogBusy(sshDialogBusy);
}
async function checkSshClient() {
  const check = ++sshClientCheck; sshClient = null; renderSshClient();
  try { const result = await invoke('ssh_check_client', {}); if (check !== sshClientCheck) return; sshClient = result; renderSshClient(); }
  catch (error) { if (check === sshClientCheck) { sshClient = { available: false }; renderSshClient(String(error)); } }
}
function openSshConnect(prefill) {
  if (sshDialog?.open) { if (prefill && !sshDialogBusy) { sshSelectedProfile = null; fillSshForm(prefill); } sshDialog.focus(); return; }
  if (!sshDialog) {
    sshDialog = document.createElement('dialog'); sshDialog.id = 'sshConnectDialog'; sshDialog.className = 'ssh-connect-dialog'; document.body.appendChild(sshDialog);
    sshDialog.addEventListener('keydown', (event) => event.stopPropagation());
    sshDialog.addEventListener('input', refreshSshFieldValidation);
    sshDialog.addEventListener('change', refreshSshFieldValidation);
    sshDialog.addEventListener('cancel', (event) => { if (sshDialogBusy) event.preventDefault(); });
    sshDialog.addEventListener('click', (event) => {
      if (sshDialogBusy) return;
      const saved = event.target.closest('[data-ssh-profile]'), remove = event.target.closest('[data-ssh-remove]'), action = event.target.closest('[data-ssh-dialog]')?.dataset.sshDialog;
      if (saved) { const profile = sshProfiles.find((value) => value.id === saved.dataset.sshProfile); if (profile) { sshSelectedProfile = profile.id; fillSshForm(profile); } }
      else if (remove) { sshProfiles = sshProfiles.filter((profile) => profile.id !== remove.dataset.sshRemove); if (sshSelectedProfile === remove.dataset.sshRemove) sshSelectedProfile = null; persistSshProfiles(); renderSshSaved(); setSshDialogStatus(sshText('removed')); }
      else if (action === 'close') sshDialog.close();
      else if (action === 'new') { sshSelectedProfile = null; fillSshForm(); $('sshHost').focus(); }
      else if (action === 'check') checkSshClient();
      else if (action === 'save') submitSshForm(false);
    });
    sshDialog.addEventListener('submit', (event) => { event.preventDefault(); submitSshForm(true); });
  }
  const field = (key, id, type, placeholder = '') => `<label for="${id}">${esc(sshText(key))}</label><input id="${id}" type="${type}" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" aria-describedby="${id}Error"><small id="${id}Error" class="ssh-field-error" hidden></small>`;
  sshDialog.setAttribute('aria-labelledby', 'sshConnectTitle'); sshDialog.setAttribute('aria-describedby', 'sshConnectIntro');
  sshDialog.innerHTML = `<header class="ssh-dialog-heading"><div><span>REMOTE WORKSPACE</span><h2 id="sshConnectTitle">${esc(sshText('title'))}</h2><p id="sshConnectIntro">${esc(sshText('intro'))}</p></div><button type="button" data-ssh-dialog="close" class="ssh-close" aria-label="${esc(sshText('cancel'))}">×</button></header><div class="ssh-dialog-main"><aside class="ssh-saved"><div class="ssh-saved-heading"><h3>${esc(sshText('saved'))}</h3><button type="button" data-ssh-dialog="new" title="${esc(sshText('new'))}" aria-label="${esc(sshText('new'))}">＋</button></div><div id="sshSavedList"></div></aside><form id="sshConnectForm" novalidate><div class="ssh-form-body"><div id="sshClientStatus" class="ssh-client-status" role="status"></div><div class="ssh-field">${field('label', 'sshLabel', 'text', sshText('labelHint'))}</div><div class="ssh-form-row host-row"><div class="ssh-field">${field('host', 'sshHost', 'text', '192.168.1.100')}</div><div class="ssh-field">${field('port', 'sshPort', 'number', '22')}</div></div><div class="ssh-field">${field('user', 'sshUser', 'text', 'ubuntu')}</div><div class="ssh-field">${field('identity', 'sshIdentity', 'text', 'C:\\Users\\me\\.ssh\\id_ed25519')}<small>${esc(sshText('identityHint'))}</small></div><div class="ssh-field"><label for="sshMode">${esc(sshText('mode'))}</label><select id="sshMode" aria-describedby="sshModeError sshModeHint"><option value="posix">${esc(sshText('posix'))}</option><option value="shell">${esc(sshText('shell'))}</option></select><small id="sshModeError" class="ssh-field-error" hidden></small><small id="sshModeHint">${esc(sshText('modeHint'))}</small></div><p class="ssh-security-note">${esc(sshText('security'))}</p><label class="ssh-remember"><input id="sshRemember" type="checkbox">${esc(sshText('remember'))}</label></div></form></div><footer class="ssh-dialog-footer"><span id="sshDialogStatus" role="status" aria-live="polite"></span><button type="button" data-ssh-dialog="save" class="ssh-secondary">${esc(sshText('save'))}</button><button type="submit" form="sshConnectForm" id="sshConnect" class="ssh-primary">${esc(sshText('connect'))}</button></footer>`;
  $('sshPort').min = '1'; $('sshPort').max = '65535'; $('sshPort').step = '1'; $('sshLabel').maxLength = 80;
  readSshProfiles(); sshSelectedProfile = null; sshDialogBusy = false; fillSshForm(prefill); sshDialog.showModal(); $('sshHost').focus(); checkSshClient();
}
async function submitSshForm(connect) {
  if (sshDialogBusy) return false;
  const { config, errors } = validateSshConfig(readSshForm()); showSshValidation(errors);
  if (Object.keys(errors).length) { const key = Object.keys(errors)[0]; $({ host: 'sshHost', user: 'sshUser', port: 'sshPort', identity: 'sshIdentity', label: 'sshLabel', mode: 'sshMode' }[key]).focus(); return false; }
  if (typeof submitManagedSsh === 'function' && $('sshManagedMode')?.checked) return submitManagedSsh(config, connect);
  config.managed = false;
  if (connect && !sshClient?.available) { setSshDialogStatus(sshText('clientMissing'), true); return false; }
  if (!connect || $('sshRemember').checked) { saveSshProfile(config); renderSshSaved(); }
  if (!connect) { setSshDialogStatus(sshText('savedNotice')); return true; }
  setSshDialogBusy(true); setSshDialogStatus(sshText('launching'));
  try { await ensureSshEvents(); sshDialog.close(); await newSshTab(config); return true; }
  catch (error) { if (sshDialog.open) setSshDialogStatus(String(error), true); else toast(String(error), true); return false; }
  finally { setSshDialogBusy(false); }
}
function ensureSshEvents() {
  if (!sshEventsPromise) sshEventsPromise = listen('ssh-info', onSshInfo).catch((error) => { sshEventsPromise = null; throw error; });
  return sshEventsPromise;
}
async function newSshTab(value, auth) {
  const { config, errors } = validateSshConfig(value);
  if (Object.keys(errors).length) throw new Error(sshText(Object.values(errors)[0]));
  await ensureSshEvents();
  if (config.managed && typeof ensureManagedSshEvents === 'function') await ensureManagedSshEvents();
  return newTermTab(null, auth ? { ...config, auth } : config);
}
function onSshInfo(event) {
  const payload = event?.payload; if (!payload || !Number.isInteger(payload.id) || payload.id < 0 || typeof payload.key !== 'string' || !payload.info) return;
  const tb = state.tabs.find((item) => isSshTab(item) && item.key === payload.key);
  if (!tb || tb.disposed || tb.exited || tb.sshDisconnectRequested || tb.sshInfo || tb.sshConfig?.infoMode === 'shell' || (tb.termId != null && tb.termId !== payload.id)) return;
  if (tb.termId == null && !tb.starting) return;
  const info = {};
  for (const field of ['hostname', 'os', 'kernel', 'arch', 'user', 'uptime', 'serverIp']) info[field] = typeof payload.info[field] === 'string' ? payload.info[field].replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 512) : '';
  tb.termId = payload.id; tb.sshInfo = info; tb.sshStatus = 'connected'; syncSshInfo(tb);
  if (typeof renderTabs === 'function') renderTabs();
}
function sshStatus(tb) {
  if (tb.sshDisconnecting) return 'disconnecting';
  if (tb.sshReconnecting) return 'reconnecting';
  if (tb.sshError && !tb.exited && (tb.termId != null || tb.starting)) return 'operationError';
  if (tb.sshError || (tb.exited && tb.exitCode != null && tb.exitCode !== 0 && !tb.sshDisconnectRequested)) return 'failed';
  if (tb.exited || tb.disposed || tb.sshDisconnectRequested) return 'disconnected';
  if (tb.sshAuthenticated) return 'connected';
  if (tb.sshInfo) return 'connected';
  if (tb.starting) return 'connecting';
  return tb.sshConfig?.infoMode === 'shell' ? 'sessionStarted' : 'authenticating';
}
function sshServerIp(tb) {
  const host = tb.sshConfig?.host || '';
  return tb.sshInfo?.serverIp || (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host : '—');
}
function mountSshInfo(tb) {
  if (!isSshTab(tb) || !tb.el || tb.sshBar) return;
  tb.el.classList.add('ssh-terminal-host');
  const bar = document.createElement('section'); bar.className = 'ssh-info-card'; bar.setAttribute('aria-label', sshText('details')); tb.sshBar = bar;
  tb.el.insertBefore(bar, tb.termViewport || tb.el.firstChild);
  bar.addEventListener('click', (event) => {
    const action = event.target.closest('[data-ssh-action]')?.dataset.sshAction;
    if (action === 'interrupt') interruptSshTab(tb);
    else if (action === 'edit') openSshConnect(sshSafeConfig(tb.sshConfig));
    else if (action === 'disconnect') disconnectSshTab(tb);
    else if (action === 'reconnect') reconnectSshTab(tb);
    else if (action === 'copy') copySshAddress(tb);
    else if (action === 'details') { tb.sshDetailsOpen = !tb.sshDetailsOpen; syncSshInfo(tb); }
  });
  syncSshInfo(tb);
}
function syncSshInfo(tb) {
  if (!isSshTab(tb) || !tb.sshBar) return;
  const status = sshStatus(tb), info = tb.sshInfo || {}, config = tb.sshConfig || {};
  const stopped = ['failed', 'disconnected'].includes(status);
  const title = config.label || config.host || 'SSH';
  const serverIp = sshServerIp(tb);
  const data = [['serverIp', serverIp], ['system', info.os], ['hostname', info.hostname], ['kernel', info.kernel], ['arch', info.arch], ['remoteUser', info.user], ['uptime', info.uptime]];
  const hint = tb.sshActionMessage || tb.sshError || (stopped ? sshText('disconnectedHint') : config.managed ? (tb.sshAuthenticated ? '' : locale === 'zh' ? '正在建立 SSH 连接…' : 'Connecting to SSH…') : config.infoMode === 'shell' ? sshText('shellHint') : !tb.sshInfo ? sshText('terminalHint') : '');
  tb.sshBar.innerHTML = `<div class="ssh-info-top"><span class="ssh-server-icon" aria-hidden="true">⌘</span><div class="ssh-info-title"><strong>${esc(title)}</strong><code title="${esc(sshText('connectionAddress'))}">${esc(sshAddress(config))}</code></div><span class="ssh-state ${status}" role="status"><i aria-hidden="true"></i>${esc(sshText(status))}</span><div class="ssh-info-actions"><button type="button" data-ssh-action="copy" title="${esc(sshText('copy'))}" aria-label="${esc(sshText('copy'))}">⧉</button><button type="button" data-ssh-action="details" aria-expanded="${!!tb.sshDetailsOpen}">${esc(sshText('details'))} ${tb.sshDetailsOpen ? '⌃' : '⌄'}</button><button type="button" data-ssh-action="interrupt" title="Ctrl+C"${tb.interruptPromise || tb.disposed ? ' disabled' : ''}>${esc(sshText('interrupt'))}</button><button type="button" data-ssh-action="reconnect"${tb.sshReconnecting || tb.sshDisconnecting || tb.disposed ? ' disabled' : ''}>${esc(sshText('reconnect'))}</button><button type="button" data-ssh-action="edit">${esc(sshText('editSession'))}</button><button type="button" data-ssh-action="disconnect"${tb.sshDisconnecting || tb.disposed || (tb.exited && !tb.startPromise) ? ' disabled' : ''}>${esc(sshText('disconnect'))}</button></div></div>${hint ? `<p class="ssh-info-hint${tb.sshError ? ' is-error' : ''}">${esc(hint)}</p>` : ''}<div class="ssh-info-summary"><span>${esc(sshText('serverIp'))}<b>${esc(serverIp)}</b></span><span>${esc(sshText('system'))}<b>${esc(info.os || '—')}</b></span>${info.uptime ? `<span>${esc(sshText('uptime'))}<b>${esc(info.uptime)}</b></span>` : ''}</div>${tb.sshDetailsOpen ? `<dl class="ssh-info-details">${data.map(([label, value]) => `<div><dt>${esc(sshText(label))}</dt><dd>${esc(value || '—')}</dd></div>`).join('')}</dl>` : ''}`;
  if (typeof fitTerm === 'function') fitTerm(tb);
  if (typeof renderManagedSshInfo === 'function') renderManagedSshInfo(tb);
  if (typeof curTab === 'function' && curTab() === tb) {
    const pageTitle = $('pageTitle');
    if (pageTitle) pageTitle.textContent = sshTabTitle(tb);
    if (typeof renderCrumbs === 'function') renderCrumbs();
    if (typeof renderStatus === 'function') renderStatus();
  }
}
function renderSshInfo(tb) { syncSshInfo(tb); }
function syncSshWorkspace() { for (const tb of state.tabs) if (isSshTab(tb)) syncSshInfo(tb); }
function interruptSshTab(tb) {
  if (!isSshTab(tb) || tb.disposed) return Promise.resolve(false);
  if (tb.sshConfig?.managed && tb.sshTerminalState && tb.sshTerminalState !== 'ready') { tb.input = ''; tb.interruptPending = false; return Promise.resolve(false); }
  // Discard queued user input without swallowing xterm's standard/DEC cursor
  // position replies, which ConPTY can still be waiting to receive.
  tb.input = (String(tb.input || '').match(/\x1b\[\??\d+;\d+R/g) || []).join('');
  if (tb.interruptPromise) return tb.interruptPromise;
  if (tb.exited || (tb.termId == null && !tb.starting)) {
    tb.interruptPending = false; tb.sshActionMessage = sshText('exitedInterrupt');
    syncSshInfo(tb); toast(tb.sshActionMessage, true);
    tb.sshBar?.querySelector?.('[data-ssh-action="reconnect"]')?.focus();
    return Promise.resolve(false);
  }
  if (tb.termId == null) {
    tb.interruptPending = !tb.sshDisconnectRequested;
    tb.sshActionMessage = sshText(tb.sshDisconnectRequested ? 'cancelWaiting' : 'interruptQueued');
    syncSshInfo(tb); return Promise.resolve(tb.interruptPending);
  }
  const key = tb.key, id = tb.termId;
  tb.interruptPending = false; tb.sshActionMessage = sshText('interruptSending');
  const pending = (async () => {
    try {
      await invoke('term_interrupt', { id });
      if (tb.disposed || tb.key !== key || tb.termId !== id || tb.exited) return false;
      tb.sshActionMessage = sshText('interruptSent'); return true;
    } catch (error) {
      if (!tb.disposed && tb.key === key && tb.termId === id) {
        tb.sshError = String(error); tb.sshActionMessage = String(error) + ' ' + sshText('interruptFailedHint');
        toast(tb.sshActionMessage, true);
      }
      return false;
    } finally {
      if (tb.key === key) {
        tb.interruptPromise = null;
        if (!tb.disposed) {
          if (tb.exited) tb.sshActionMessage = sshText('exitedInterrupt');
          syncSshInfo(tb);
          if (curTab() === tb && !document.querySelector?.('dialog[open]')) {
            if (tb.exited) tb.sshBar?.querySelector?.('[data-ssh-action="reconnect"]')?.focus();
            else tb.term?.focus();
          }
        }
      }
    }
  })();
  tb.interruptPromise = pending; syncSshInfo(tb); return pending;
}

async function copySshTerminalSelection(tb) {
  const selection = tb.term?.getSelection?.() || '';
  if (!selection) return;
  try { await navigator.clipboard.writeText(selection); toast(sshText('selectionCopied')); }
  catch { toast(sshText('copyFailed'), true); }
}

function disconnectSshTab(tb) {
  if (!isSshTab(tb) || tb.disposed) return Promise.resolve(false);
  if (tb.sshDisconnectPromise) return tb.sshDisconnectPromise;
  if (tb.exited && !tb.startPromise) return Promise.resolve(true);
  const key = tb.key, starting = tb.startPromise, id = tb.termId;
  tb.sshDisconnectRequested = true; tb.sshDisconnecting = true;
  tb.input = ''; tb.interruptPending = false;
  if (tb.resetTermReady) { tb.resetTermReady(); tb.resetTermReady = null; }
  tb.sshActionMessage = sshText(id == null && starting ? 'cancelWaiting' : 'disconnecting'); syncSshInfo(tb);
  const pending = (async () => {
    await Promise.resolve();
    try {
      if (id != null && !tb.exited) await stopTermProcess(tb, key, id);
      if (starting) await starting;
      if (tb.disposed || tb.key !== key) return false;
      if (tb.termId != null && !tb.exited) await stopTermProcess(tb, key, tb.termId);
      tb.termId = null; tb.exited = true; tb.starting = false;
      if (typeof disconnectSshQueue === 'function') disconnectSshQueue(tb);
      tb.sshActionMessage = sshText('disconnectedHint');
      return true;
    } catch (error) {
      if (!tb.disposed && tb.key === key) {
        tb.sshDisconnectRequested = false; tb.sshError = String(error); tb.sshActionMessage = String(error);
        toast(String(error), true);
      }
      return false;
    } finally {
      if (tb.key === key) {
        tb.sshDisconnecting = false; tb.sshDisconnectPromise = null;
        if (!tb.disposed) { syncSshInfo(tb); if (typeof renderTabs === 'function') renderTabs(); }
      }
    }
  })();
  tb.sshDisconnectPromise = pending;
  return pending;
}

function reconnectSshTab(tb) {
  if (!isSshTab(tb) || tb.disposed || tb.sshReconnecting || tb.sshDisconnecting) return Promise.resolve(false);
  tb.sshReconnecting = true; tb.input = ''; syncSshInfo(tb);
  return (async () => {
    try {
      if (!await disconnectSshTab(tb) || tb.disposed || !tb.exited || tb.startPromise) return false;
      tb.sshConfig = sshSafeConfig(tb.sshConfig);
      await restartSshTermSession(tb);
      return !tb.disposed && !tb.exited;
    } catch (error) { if (!tb.disposed) toast(String(error), true); return false; }
    finally { tb.sshReconnecting = false; if (!tb.disposed) syncSshInfo(tb); }
  })();
}
async function copySshAddress(tb) {
  try { await navigator.clipboard.writeText(sshAddress(tb.sshConfig)); toast(sshText('copied')); }
  catch { toast(sshText('copyFailed'), true); }
}

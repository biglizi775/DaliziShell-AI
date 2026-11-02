'use strict';
const archiveText = (zh, en) => locale === 'zh' ? zh : en;
let archiveDialogState = null;
function archiveName(name, format) {
  const value = name.trim();
  return /\.(7z|zip)$/i.test(value) ? value.replace(/\.(7z|zip)$/i, '.' + format) : value + '.' + format;
}
function archiveRequest(values, sources) {
  const T = archiveText, password = values.encrypt ? values.password : '';
  if (!sources.length) throw new Error(T('请先选择文件或文件夹。', 'Select files or folders first.'));
  if (!values.name.trim() || !values.directory.trim()) throw new Error(T('请填写压缩包名称和保存目录。', 'Enter an archive name and destination folder.'));
  if (!['7z', 'zip'].includes(values.format) || ![0, 1, 5, 9].includes(Number(values.level))) throw new Error(T('压缩选项无效。', 'Invalid archive options.'));
  if (values.encrypt && !password) throw new Error(T('启用加密后需要输入密码。', 'Enter a password to enable encryption.'));
  if (values.encrypt && password !== values.confirm) throw new Error(T('两次输入的密码不一致。', 'Passwords do not match.'));
  if ([...password].length > 256 || /[\x00-\x1f\x7f]/u.test(password)) throw new Error(T('密码最多 256 个字符，不能包含控制字符。', 'Use up to 256 characters without control characters.'));
  if (values.format === 'zip' && (/[^\x20-\x7e]/u.test(password) || password.length > 99)) throw new Error(T('ZIP 密码最多 99 个英文字母、数字、半角符号或空格；中文密码请选择 7z。', 'Use up to 99 ASCII characters for ZIP; choose 7z for Unicode passwords.'));
  const name = archiveName(values.name, values.format);
  if (/[\\/:*?"<>|\x00-\x1f]/u.test(name) || name.endsWith('.') || new TextEncoder().encode(name).length > 240) throw new Error(T('压缩包名称无效或过长。', 'Invalid or excessively long archive name.'));
  return { sources: [...sources], directory: values.directory.trim(), name, format: values.format, level: Number(values.level), password, encryptNames: values.encrypt && values.format === '7z' && !!values.encryptNames };
}
function openArchiveDialog() {
  const T = archiveText;
  if (archiveDialogState?.dialog.open) { archiveDialogState.dialog.focus(); return; }
  if (!state.path || isTermTab(curTab()) || isBrowserTab(curTab()) || !state.selection.size || fileOpBusy) return;
  closeMenu();
  const entries = state.entries.filter((e) => state.selection.has(e.name));
  if (!entries.length) return;
  const sources = entries.map((e) => join(state.path, e.name));
  const base = entries.length === 1 ? entries[0].isDir ? entries[0].name : entries[0].name.replace(/\.[^.]+$/, '') : basename(state.path) || T('压缩文件', 'Archive');
  const dialog = document.createElement('dialog'); dialog.id = 'archiveDialog'; dialog.className = 'file-settings-dialog archive-dialog'; dialog.setAttribute('aria-labelledby', 'archiveTitle');
  dialog.innerHTML = `<form id="archiveForm" autocomplete="off"><header class="file-settings-head"><div><span class="file-settings-eyebrow">${T('打包与分享', 'PACK & SHARE')}</span><h2 id="archiveTitle">${T('压缩文件', 'Create archive')}</h2></div><button type="button" data-archive-close aria-label="${T('关闭', 'Close')}">×</button></header><div class="file-settings-body"><p class="file-settings-intro">${T('已选择', 'Selected')} ${entries.length} ${T('项，包含所选文件夹的内容。原文件会保留。', 'items, including folder contents. Originals are kept.')}</p><details class="archive-sources"><summary>${T('查看所选项目', 'View selected items')}</summary><ul>${sources.slice(0, 20).map((p) => `<li>${esc(p)}</li>`).join('')}${sources.length > 20 ? `<li>… +${sources.length - 20}</li>` : ''}</ul></details><fieldset id="archiveOptions"><label class="archive-field" for="archiveName">${T('压缩包名称', 'Archive name')}<input id="archiveName" value="${esc(base + '.7z')}" maxlength="240" required></label><label class="archive-field" for="archiveDirectory">${T('保存目录', 'Destination folder')}</label><div class="archive-path-row"><input id="archiveDirectory" value="${esc(state.path)}" spellcheck="false" required><button type="button" id="archiveBrowse">${T('浏览…', 'Browse…')}</button></div><div class="archive-grid"><label class="archive-field" for="archiveFormat">${T('压缩格式', 'Format')}<select id="archiveFormat"><option value="7z">7z · ${T('支持隐藏文件名', 'Can hide file names')}</option><option value="zip">ZIP · ${T('常用格式', 'Widely used')}</option></select></label><label class="archive-field" for="archiveLevel">${T('压缩级别', 'Compression level')}<select id="archiveLevel"><option value="0">${T('仅打包 · 不压缩', 'Store · no compression')}</option><option value="1">${T('快速 · 节省时间', 'Fast · save time')}</option><option value="5" selected>${T('标准 · 平衡速度与体积', 'Normal · balanced')}</option><option value="9">${T('更小体积 · 耗时较长', 'Smaller · takes longer')}</option></select></label></div><section class="archive-encryption"><label class="archive-check"><input type="checkbox" id="archiveEncrypt">${T('设置解压密码（AES-256）', 'Protect with a password (AES-256)')}</label><div id="archivePasswordFields" class="hidden"><div class="archive-grid"><label class="archive-field" for="archivePassword">${T('密码', 'Password')}<input type="password" id="archivePassword" autocomplete="new-password" maxlength="512" disabled></label><label class="archive-field" for="archiveConfirm">${T('确认密码', 'Confirm password')}<input type="password" id="archiveConfirm" autocomplete="new-password" maxlength="512" disabled></label></div><div class="archive-checks"><label class="archive-check"><input type="checkbox" id="archiveShowPassword">${T('显示密码', 'Show password')}</label><label class="archive-check"><input type="checkbox" id="archiveEncryptNames" checked>${T('同时隐藏文件名（仅 7z）', 'Hide file names (7z only)')}</label></div></div><p id="archiveEncryptionHint" class="archive-note"></p></section></fieldset><p class="archive-note">${T('同名文件不会被覆盖。密码不会保存到设置或历史中，请妥善保管；忘记密码将无法解压。', 'Existing files are never overwritten. Passwords are not saved in settings or history; keep yours safe, as it is required to extract encrypted files.')}</p><div id="archiveProgressArea" class="hidden"><progress id="archiveProgress" max="100" aria-label="${T('压缩进度', 'Compression progress')}"></progress><p id="archiveProgressDetails" class="archive-note"></p></div><p id="archiveStatus" role="status" aria-live="polite"></p></div><footer class="file-settings-footer"><button type="button" data-archive-close>${T('取消', 'Cancel')}</button><span class="file-settings-spacer"></span><button type="button" id="archiveLocate" class="hidden">${T('打开所在文件夹', 'Open containing folder')}</button><button type="submit" id="archiveStart" class="file-settings-primary">${T('开始压缩', 'Create archive')}</button></footer></form>`;
  document.body.appendChild(dialog);
  const job = { dialog, sources, owner: curTab(), folder: state.path, id: null, running: false, cancelRequested: false, timer: null, output: null, format: '7z' };
  archiveDialogState = job;
  function sync() {
    const encrypt = $('archiveEncrypt').checked, format = $('archiveFormat').value;
    if (format !== job.format) { $('archiveName').value = archiveName($('archiveName').value, format); $('archiveEncryptNames').checked = format === '7z'; job.format = format; }
    $('archivePasswordFields').classList.toggle('hidden', !encrypt);
    for (const id of ['archivePassword', 'archiveConfirm']) { $(id).disabled = !encrypt; $(id).maxLength = format === 'zip' ? 99 : 512; if (!encrypt) $(id).value = ''; $(id).type = $('archiveShowPassword').checked ? 'text' : 'password'; }
    $('archiveEncryptNames').disabled = !encrypt || format !== '7z';
    $('archiveEncryptionHint').textContent = !encrypt ? T('当前不加密，任何获得压缩包的人都可以读取内容。', 'Encryption is off. Anyone with the archive can read its contents.') : format === '7z' ? T('支持中文密码，最多 256 个字符。启用隐藏文件名后，查看包内目录也需要密码。', 'Unicode passwords are supported, up to 256 characters. With hidden file names enabled, listing contents also requires the password.') : T('ZIP 的文件名仍可见。密码最多 99 个英文、数字和半角符号（可含空格）；需用支持 AES 的工具打开，例如 7-Zip。', 'ZIP file names remain visible. Use up to 99 ASCII characters and an AES-compatible tool, such as 7-Zip.');
  }
  for (const id of ['archiveEncrypt', 'archiveFormat', 'archiveShowPassword']) $(id).addEventListener('change', sync);
  $('archiveBrowse').addEventListener('click', async () => {
    const button = $('archiveBrowse'); button.disabled = true;
    try { const picked = await invoke('archive_pick_directory', { directory: $('archiveDirectory').value }); if (picked && dialog.open && !job.running) $('archiveDirectory').value = picked; }
    catch (error) { if (dialog.open) $('archiveStatus').textContent = String(error); }
    finally { button.disabled = false; }
  });
  const cancel = async () => {
    if (!job.running) { dialog.close(); return; }
    job.cancelRequested = true; $('archiveStatus').textContent = T('正在取消，等待当前磁盘读写结束…', 'Cancelling; waiting for the current disk operation…');
    if (job.id) { try { await invoke('archive_cancel', { id: job.id }); } catch (error) { $('archiveStatus').textContent = String(error); job.cancelRequested = false; } }
  };
  dialog.querySelectorAll('[data-archive-close]').forEach((button) => button.addEventListener('click', cancel));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); cancel(); });
  dialog.addEventListener('close', () => { clearTimeout(job.timer); $('archivePassword').value = ''; $('archiveConfirm').value = ''; if (archiveDialogState === job) archiveDialogState = null; dialog.remove(); }, { once: true });
  const finished = (progress) => {
    job.running = false; fileOpBusy = false; $('archiveOptions').disabled = progress.phase === 'done'; $('archiveStart').disabled = false;
    dialog.querySelectorAll('[data-archive-close]').forEach((b) => { b.disabled = false; if (b.textContent !== '×') b.textContent = T('关闭', 'Close'); });
    if (progress.phase === 'done') {
      job.output = progress.output; $('archiveStart').classList.add('hidden'); $('archiveLocate').classList.remove('hidden'); $('archiveProgress').value = 100;
      $('archiveStatus').textContent = T('压缩完成 · ', 'Archive created · ') + fmtSize(progress.archiveBytes);
      if (curTab() === job.owner && state.path === job.folder && job.folder.toLowerCase() === $('archiveDirectory').value.trim().replace(/[\\/]+$/, '').toLowerCase()) refresh(true);
    } else $('archiveStatus').textContent = progress.phase === 'cancelled' ? T('压缩已取消，未生成目标压缩包。', 'Cancelled. No destination archive was created.') : progress.error || T('压缩失败，请重试。', 'Compression failed. Please retry.');
    renderBar2();
  };
  const poll = async () => {
    if (!dialog.open || !job.running) return;
    try {
      const p = await invoke('archive_progress', { id: job.id });
      if (!dialog.open || !job.running) return;
      const bar = $('archiveProgress');
      if (p.phase === 'scanning') bar.removeAttribute('value');
      else bar.value = p.phase === 'done' ? 100 : Math.min(99, p.totalBytes ? p.bytes / p.totalBytes * 100 : p.entries ? p.completedEntries / p.entries * 100 : 0);
      $('archiveProgressDetails').textContent = `${p.completedEntries} / ${p.entries} ${T('项', 'items')} · ${fmtSize(p.bytes)} / ${fmtSize(p.totalBytes)}` + (p.current ? '\n' + p.current : '');
      if (['done', 'error', 'cancelled'].includes(p.phase)) { finished(p); return; }
      $('archiveStatus').textContent = job.cancelRequested || p.phase === 'cancelling' ? T('正在取消，等待当前磁盘读写结束…', 'Cancelling; waiting for the current disk operation…') : p.phase === 'scanning' ? T('正在统计文件…', 'Scanning files…') : p.phase === 'finalizing' ? T('正在完成压缩包…', 'Finalizing archive…') : T('正在压缩…', 'Compressing…');
    } catch (error) { if (dialog.open) $('archiveStatus').textContent = T('读取进度失败，将自动重试：', 'Progress unavailable; retrying: ') + String(error); }
    if (job.running) job.timer = setTimeout(poll, 300);
  };
  $('archiveForm').addEventListener('submit', async (event) => {
    event.preventDefault(); if (job.running || fileOpBusy || job.output) return;
    let request;
    try { request = archiveRequest({ name: $('archiveName').value, directory: $('archiveDirectory').value, format: $('archiveFormat').value, level: $('archiveLevel').value, encrypt: $('archiveEncrypt').checked, password: $('archivePassword').value, confirm: $('archiveConfirm').value, encryptNames: $('archiveEncryptNames').checked }, sources); }
    catch (error) { $('archiveStatus').textContent = error.message; return; }
    job.running = true; job.cancelRequested = false; job.id = null; fileOpBusy = true;
    $('archiveName').value = request.name; $('archiveOptions').disabled = true; $('archiveStart').disabled = true; $('archiveProgressArea').classList.remove('hidden'); $('archiveProgress').removeAttribute('value'); $('archiveStatus').textContent = T('正在启动压缩…', 'Starting compression…');
    dialog.querySelectorAll('[data-archive-close]').forEach((b) => { if (b.textContent !== '×') b.textContent = T('取消任务', 'Cancel task'); });
    try { job.id = await invoke('archive_start', { request }); if (job.cancelRequested) { try { await invoke('archive_cancel', { id: job.id }); } catch (error) { job.cancelRequested = false; $('archiveStatus').textContent = String(error); } } poll(); }
    catch (error) { finished({ phase: 'error', error: String(error) }); }
    finally { request.password = ''; $('archivePassword').value = ''; $('archiveConfirm').value = ''; }
  });
  $('archiveLocate').addEventListener('click', async () => { if (job.output) { dialog.close(); await openContainingFolder(job.output); } });
  sync(); dialog.showModal(); $('archiveName').focus(); $('archiveName').select();
}

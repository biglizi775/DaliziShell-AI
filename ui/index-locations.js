async function openIndexLocations() {
  const T = (zh, en) => locale === 'zh' ? zh : en;
  const owner = curTab(), nav = state.navToken;
  closeQuickSearch();
  const dialog = columnDialog('indexLocations', T('索引位置', 'Index locations'),
    `<div class="file-settings-body index-locations">
      <div class="index-location-sections"><button type="button" data-index-section="roots" aria-pressed="true">${T('索引范围', 'Search scope')}</button><button type="button" data-index-section="excluded" aria-pressed="false">${T('排除目录', 'Excluded folders')}</button></div>
      <fieldset disabled><div data-index-panel="roots">
      <label><input type="radio" name="indexScope" value="fixed"> ${T('所有固定磁盘', 'All fixed drives')}</label>
      <label><input type="radio" name="indexScope" value="selected"> ${T('指定文件夹', 'Selected folders')}</label>
      <label for="indexFolderList">${T('目录路径，每行一个', 'Folder paths, one per line')}</label>
      <textarea id="indexFolderList" rows="5" spellcheck="false"></textarea>
      <button type="button" class="file-settings-secondary" data-index-pick>${T('选择文件夹…', 'Choose folder…')}</button>
      <p class="file-settings-note">${T('指定目录包含其子目录。列表留空会暂停后台索引。仍可浏览其他位置并查看文件夹大小。', 'Selected folders include their subfolders. An empty selection pauses background indexing. Browsing and folder sizes remain available elsewhere.')}</p>
      </div><div data-index-panel="excluded" hidden>
      <label for="indexExcludeList">${T('排除的目录路径，每行一个', 'Excluded folder paths, one per line')}</label>
      <textarea id="indexExcludeList" rows="4" spellcheck="false"></textarea>
      <button type="button" class="file-settings-secondary" data-index-exclude-pick>${T('选择排除目录…', 'Choose folder to exclude…')}</button>
      <p class="file-settings-note">${T('两种索引范围都会跳过这些路径及其子目录。可预先填写尚未创建的目录。按 F5 仍可核验实际大小。', 'Both scopes skip these paths and their descendants. You can enter folders before they exist. F5 still measures the full size.')}</p>
      </div></fieldset>
      <p data-index-status class="file-settings-note" role="status"></p></div>`,
    `<span class="file-settings-spacer"></span><button type="button" data-close-dialog class="file-settings-secondary">${T('取消', 'Cancel')}</button><button type="button" data-index-save disabled class="file-settings-primary">${T('应用', 'Apply')}</button>`);
  if (!dialog) return;
  dialog.addEventListener('close', () => {
    if (owner === curTab() && nav === state.navToken && quickMode() !== 'local') { $('search').focus(); showQuickSearch(); }
  }, { once:true });
  const field = dialog.querySelector('fieldset'), paths = dialog.querySelector('#indexFolderList'), excluded = dialog.querySelector('#indexExcludeList');
  const sections = dialog.querySelectorAll('[data-index-section]');
  sections.forEach(button => button.addEventListener('click', () => {
    sections.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    dialog.querySelectorAll('[data-index-panel]').forEach(panel => { panel.hidden = panel.dataset.indexPanel !== button.dataset.indexSection; });
  }));
  const pick = dialog.querySelector('[data-index-pick]'), save = dialog.querySelector('[data-index-save]');
  const status = dialog.querySelector('[data-index-status]');
  const fixed = dialog.querySelector('[value=fixed]'), selected = dialog.querySelector('[value=selected]');
  const sync = () => { paths.disabled = pick.disabled = !selected.checked; };
  field.addEventListener('change', sync);
  let saving = false;
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  async function appendFolder(input) {
    try {
      const path = await invoke('index_locations_pick');
      if (path && dialog.open && !input.disabled && !saving) input.value = [input.value.trim(), path].filter(Boolean).join('\n');
    } catch (error) { status.textContent = String(error); }
  }
  pick.addEventListener('click', () => appendFolder(paths));
  dialog.querySelector('[data-index-exclude-pick]').addEventListener('click', () => appendFolder(excluded));
  save.addEventListener('click', async () => {
    if (saving) return;
    const lines = input => input.value.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    const settings = { mode: fixed.checked ? 'fixed' : 'selected', folders: lines(paths), excluded: lines(excluded) };
    saving = true; field.disabled = save.disabled = true;
    const closeButtons = dialog.querySelectorAll('[data-close-dialog]');
    closeButtons.forEach(b => { b.disabled = true; });
    status.textContent = T('正在保存…', 'Saving…');
    try {
      await invoke('index_locations_save', { settings });
      dialog.close();
    } catch (error) {
      status.textContent = String(error);
      field.disabled = save.disabled = false; closeButtons.forEach(b => { b.disabled = false; });
    } finally { saving = false; }
  });
  try {
    const policy = await invoke('index_locations_get');
    if (!dialog.open) return;
    fixed.checked = policy.settings.mode === 'fixed'; selected.checked = !fixed.checked;
    paths.value = policy.settings.folders.join('\n');
    excluded.value = (policy.settings.excluded || []).join('\n');
    if (policy.warning) status.textContent = T('原设置读取失败，已暂停后台索引。', 'Previous settings could not be read. Background indexing is paused. ') + ' ' + policy.warning;
    field.disabled = save.disabled = false; sync();
  } catch (error) { status.textContent = String(error); }
}

/* Persisted list columns. Width changes only update CSS, leaving virtual rows intact. */
const COLUMN_DEFAULTS = ['name', 'date', 'type', 'size'];
const COLUMN_KEYS = [...COLUMN_DEFAULTS, 'created', 'accessed', 'extension', 'attributes', 'path'];
const COLUMN_LIMITS = {
  name: { min: 160, max: 1200, initial: null },
  date: { min: 135, max: 500, initial: 160 },
  type: { min: 85, max: 500, initial: 120 },
  size: { min: 85, max: 400, initial: 100 },
  created: { min: 135, max: 500, initial: 160 },
  accessed: { min: 135, max: 500, initial: 160 },
  extension: { min: 85, max: 300, initial: 100 },
  attributes: { min: 100, max: 500, initial: 170 },
  path: { min: 160, max: 1400, initial: 300 },
};
function normalizeColumns(raw) {
  const order = [...new Set(Array.isArray(raw?.order) ? raw.order.filter((k) => COLUMN_KEYS.includes(k)) : [])];
  for (const key of COLUMN_KEYS) if (!order.includes(key)) order.push(key);
  const widths = {};
  for (const key of COLUMN_KEYS) {
    const limits = COLUMN_LIMITS[key], width = raw?.widths?.[key];
    widths[key] = typeof width === 'number' && Number.isFinite(width)
      ? Math.round(Math.max(limits.min, Math.min(limits.max, width))) : limits.initial;
  }
  const visible = new Set(Array.isArray(raw?.visible) ? raw.visible : COLUMN_DEFAULTS);
  visible.add('name');
  return { order, widths, visible: COLUMN_KEYS.filter((key) => visible.has(key)) };
}
function visibleColumns(layout = columnLayout) { return layout.order.filter((key) => layout.visible.includes(key)); }
function columnGeometry(layout, viewport) {
  const widths = { ...layout.widths };
  const visible = visibleColumns(layout);
  const other = visible.filter((key) => key !== 'name').reduce((sum, key) => sum + widths[key], 0);
  widths.name ??= Math.max(COLUMN_LIMITS.name.min, (viewport || 800) - 32 - other);
  const total = visible.reduce((sum, key) => sum + widths[key], 0);
  return { widths, total, template: visible.map((key) => `${widths[key]}px`).join(' ') };
}
function moveColumn(order, source, target, after) {
  if (!order.includes(source) || !order.includes(target) || source === target) return [...order];
  const next = order.filter((key) => key !== source);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source);
  return next;
}

let columnLayout = normalizeColumns(store.get('columns.v1', null));
let columnResize = null, columnDrag = null, columnBlockClickUntil = 0;
let columnInitialized = false;
const columnText = (zh, en) => locale === 'zh' ? zh : en;
function saveColumns() { store.set('columns.v1', columnLayout); }
function columnInteractionActive() { return !!columnResize || !!columnDrag; }

function columnLabel(key) {
  return {
    name: columnText('名称', 'Name'), date: columnText('修改日期', 'Date modified'),
    type: columnText('类型', 'Type'), size: columnText('大小', 'Size'),
    created: columnText('创建日期', 'Date created'), accessed: columnText('访问日期', 'Date accessed'),
    extension: columnText('扩展名', 'Extension'), attributes: columnText('属性', 'Attributes'),
    path: columnText('完整路径', 'Full path'),
  }[key] || key;
}
function fileAttributeLabel(entry) {
  const flags = Number(entry.attributes) || 0, labels = [];
  if (entry.readOnly || (flags & 0x1)) labels.push(columnText('只读', 'Read-only'));
  if (flags & 0x2 || (entry.hidden && !(flags & 0x4))) labels.push(columnText('隐藏', 'Hidden'));
  if (flags & 0x4) labels.push(columnText('系统', 'System'));
  if (flags & 0x20) labels.push(columnText('存档', 'Archive'));
  if (entry.isReparse || flags & 0x400) labels.push(columnText('重解析点', 'Reparse point'));
  if (flags & 0x800) labels.push(columnText('压缩', 'Compressed'));
  if (flags & 0x1000) labels.push(columnText('脱机', 'Offline'));
  if (flags & 0x2000) labels.push(columnText('不建立内容索引', 'Not content indexed'));
  if (flags & 0x4000) labels.push(columnText('加密', 'Encrypted'));
  return labels.join(' · ') || columnText('普通', 'Normal');
}
function columnValue(entry, key) {
  if (key === 'name') return entry.name;
  if (key === 'date' || key === 'created' || key === 'accessed') {
    const value = entry[{ date: 'mtime', created: 'ctime', accessed: 'atime' }[key]];
    return value ? fmtDate(value) : '—';
  }
  if (key === 'type') return typeLabel(entry);
  if (key === 'size') return entry.isDir ? folderSizeLabel(entry) : fmtSize(entry.size);
  if (key === 'extension') return entry.isDir ? '—' : entry.ext ? '.' + entry.ext : '—';
  if (key === 'attributes') return fileAttributeLabel(entry);
  if (key === 'path') return join(state.path, entry.name);
  return '';
}
function renderColumnCells(entry) {
  return visibleColumns().map((key) => {
    const value = columnValue(entry, key);
    return key === 'name'
      ? `<div class="c cname">${fileIcon(entry)}<span class="nm" title="${esc(entry.name)}">${esc(entry.name)}</span></div>`
      : `<div class="c c${key}" title="${esc(value)}">${esc(value)}</div>`;
  }).join('');
}

function renderColumnHeaders(labels) {
  const names = { ...Object.fromEntries(COLUMN_KEYS.map((key) => [key, columnLabel(key)])), ...Object.fromEntries(labels) };
  const { widths } = columnGeometry(columnLayout, els.scroller.clientWidth);
  const hint = columnText('点击排序 · 拖动调整顺序或宽度 · 右键选择显示列', 'Click to sort · Drag to reorder or resize · Right-click to choose columns');
  return '<div class="column-track">' + visibleColumns().map((key) => {
    const on = state.sortKey === key;
    const arrow = on ? `<span class="arr">${state.sortDir === 1 ? '▲' : '▼'}</span>` : '';
    const resize = columnText('调整宽度，方向键微调，双击自动适配', 'Resize; arrow keys adjust; double-click to fit');
    return `<div class="h ${key}${on ? ' on' : ''}" data-k="${key}" draggable="true" title="${esc(hint)}" role="columnheader" aria-sort="${on ? state.sortDir === 1 ? 'ascending' : 'descending' : 'none'}"><span class="column-label">${esc(names[key])}</span>${arrow}<span class="column-resize" data-resize="${key}" role="separator" aria-orientation="vertical" tabindex="0" aria-label="${esc(names[key] + ' · ' + resize)}" aria-valuemin="${COLUMN_LIMITS[key].min}" aria-valuemax="${COLUMN_LIMITS[key].max}" aria-valuenow="${widths[key]}" title="${esc(resize)}"></span></div>`;
  }).join('') + '</div>';
}

function syncColumnLayout() {
  const details = state.viewMode === 'details';
  els.content.classList.toggle('adjustable-columns', details);
  if (!details) {
    els.scroller.scrollLeft = 0;
    return;
  }
  const geometry = columnGeometry(columnLayout, els.scroller.clientWidth);
  els.content.style.setProperty('--columns-template', geometry.template);
  els.content.style.setProperty('--columns-width', `${geometry.total}px`);
  columnLayout.order.forEach((key, index) => els.content.style.setProperty(`--column-${key}-order`, String(index)));
  els.dhead.querySelectorAll('[data-resize]').forEach((handle) => handle.setAttribute('aria-valuenow', geometry.widths[handle.dataset.resize]));
  syncColumnScroll();
}
function syncColumnScroll() {
  const track = els.dhead.querySelector('.column-track');
  if (track) track.style.transform = `translateX(${-els.scroller.scrollLeft}px)`;
}
function consumeColumnClick(event) {
  return !!event.target.closest('[data-resize]') || Date.now() < columnBlockClickUntil;
}
function setColumnWidth(key, value) {
  if (!COLUMN_KEYS.includes(key) || !Number.isFinite(value)) return;
  // Freeze the flexible name column before resizing another edge, so the
  // dragged boundary follows the pointer instead of shrinking the name column.
  if (key !== 'name' && columnLayout.widths.name == null)
    columnLayout.widths.name = columnGeometry(columnLayout, els.scroller.clientWidth).widths.name;
  const limits = COLUMN_LIMITS[key];
  columnLayout.widths[key] = Math.round(Math.max(limits.min, Math.min(limits.max, value)));
  syncColumnLayout();
}
function fitColumn(key) {
  if (!COLUMN_KEYS.includes(key)) return;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  if (ctx) ctx.font = getComputedStyle(els.scroller).font || '12px sans-serif';
  const measure = (text) => ctx ? ctx.measureText(String(text)).width : String(text).length * 8;
  const label = columnLabel(key);
  let width = measure(label) + 44;
  // Bound measurement work when browsing huge directories; include visible rows first.
  const first = Math.max(0, Math.floor(els.scroller.scrollTop / ROWH.details));
  const sample = state.view.slice(first, first + 100).concat(state.view.slice(0, 900));
  for (const entry of sample) {
    const value = columnValue(entry, key);
    width = Math.max(width, measure(value) + (key === 'name' ? 58 : 28));
  }
  setColumnWidth(key, Math.ceil(width));
  saveColumns();
}
function resetColumns() {
  columnLayout = normalizeColumns(null);
  saveColumns();
  renderList();
}
function finishColumnResize(event, cancelled = false) {
  if (!columnResize || event.pointerId !== columnResize.pointerId) return;
  const old = columnResize;
  columnResize = null;
  if (cancelled) {
    columnLayout.widths = old.savedWidths;
    syncColumnLayout();
  } else saveColumns();
  if (old.handle.hasPointerCapture?.(event.pointerId)) old.handle.releasePointerCapture(event.pointerId);
  document.body.classList.remove('resizing-column');
  columnBlockClickUntil = Date.now() + 250;
}
function clearColumnDrag() {
  columnDrag = null;
  els.dhead.querySelectorAll('.drop-before,.drop-after,.column-dragging').forEach((header) => header.classList.remove('drop-before', 'drop-after', 'column-dragging'));
}
function columnDialog(id, title, body, footer) {
  const previous = document.getElementById(id);
  if (previous) { previous.focus(); return null; }
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = 'file-settings-dialog';
  dialog.setAttribute('aria-labelledby', id + 'Title');
  dialog.innerHTML = `<header class="file-settings-head"><div><span class="file-settings-eyebrow">${columnText('文件视图', 'FILE VIEW')}</span><h2 id="${id}Title">${esc(title)}</h2></div><button type="button" data-close-dialog aria-label="${columnText('关闭', 'Close')}">×</button></header>${body}<footer class="file-settings-footer">${footer}</footer>`;
  dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}
function openColumnPicker() {
  const description = {
    name: columnText('始终显示，便于选择和重命名文件', 'Always visible for selecting and renaming files'),
    date: columnText('文件内容最近一次修改时间', 'When the content was last modified'),
    type: columnText('文件夹或文件类型', 'Folder or file type'),
    size: columnText('文件大小或缓存的文件夹大小', 'File size or cached folder size'),
    created: columnText('文件或文件夹的创建时间', 'When the file or folder was created'),
    accessed: columnText('文件系统记录的访问时间，可能延迟更新', 'Access time recorded by the file system; updates may be delayed'),
    extension: columnText('例如 .pdf、.docx、.jpg', 'For example .pdf, .docx or .jpg'),
    attributes: columnText('只读、隐藏、压缩等系统属性', 'Read-only, hidden, compressed and other flags'),
    path: columnText('包含文件名的完整位置', 'The complete location including the file name'),
  };
  const rows = columnLayout.order.map((key) => `<label class="column-option"><input type="checkbox" value="${key}" ${columnLayout.visible.includes(key) ? 'checked' : ''} ${key === 'name' ? 'disabled' : ''}><span><strong>${esc(columnLabel(key))}${key === 'name' ? `<em>${columnText('固定', 'Required')}</em>` : ''}</strong><small>${esc(description[key])}</small></span></label>`).join('');
  const dialog = columnDialog('columnPicker', columnText('选择显示列', 'Choose columns'),
    `<div class="file-settings-body"><p class="file-settings-intro">${columnText('选择在详细列表中显示的属性。设置会记住并应用到其他文件夹。拖动表头可调整顺序和宽度。', 'Choose the properties shown in Details view. Your choice is remembered across folders. Drag column headings or edges to change their order or width.')}</p><div class="column-options">${rows}</div><p id="columnSelectionStatus" class="file-settings-note" aria-live="polite"></p></div>`,
    `<button type="button" id="columnDefaults" class="file-settings-secondary">${columnText('默认显示列', 'Default columns')}</button><span class="file-settings-spacer"></span><button type="button" data-close-dialog class="file-settings-secondary">${columnText('取消', 'Cancel')}</button><button type="button" id="columnApply" class="file-settings-primary">${columnText('应用', 'Apply')}</button>`);
  if (!dialog) return;
  const boxes = [...dialog.querySelectorAll('.column-option input')];
  const update = () => {
    const count = boxes.filter((box) => box.checked).length;
    dialog.querySelector('#columnSelectionStatus').textContent = columnText(`已选择 ${count} 列 · 应用后生效`, `${count} columns selected · Apply to save`);
  };
  boxes.forEach((box) => box.addEventListener('change', update));
  dialog.querySelector('#columnDefaults').addEventListener('click', () => {
    boxes.forEach((box) => { box.checked = COLUMN_DEFAULTS.includes(box.value); });
    update();
  });
  dialog.querySelector('#columnApply').addEventListener('click', () => {
    columnLayout = normalizeColumns({ ...columnLayout, visible: boxes.filter((box) => box.checked).map((box) => box.value) });
    saveColumns();
    dialog.close();
    if (state.viewMode !== 'details') setViewMode('details');
    else renderList();
    toast(columnText('显示列已更新', 'Visible columns updated'));
  });
  update();
}
function propertySizeValue(entry) {
  const bytes = entry.isDir ? entry.dirSize : entry.size;
  return columnValue(entry, 'size') + (Number.isFinite(bytes) ? ` (${bytes.toLocaleString()} ${columnText('字节', 'bytes')})` : '');
}
function refreshEntryPropertySize() {
  const dialog = document.getElementById('entryProperties');
  if (!dialog?.open || !dialog.dataset.propertyPath) return;
  const entry = state.sizeEntries?.get(dialog.dataset.propertyPath);
  const cell = dialog.querySelector('[data-property-size]');
  if (entry && cell) cell.textContent = propertySizeValue(entry);
}
function showEntryProperties(entry) {
  const rows = COLUMN_KEYS.map((key) => {
    const value = key === 'size' ? propertySizeValue(entry) : columnValue(entry, key);
    return `<div><dt>${esc(columnLabel(key))}</dt><dd${key === 'size' ? ' data-property-size' : ''}>${esc(value)}</dd></div>`;
  }).join('');
  const dialog = columnDialog('entryProperties', columnText('属性', 'Properties'),
    `<div class="file-settings-body"><div class="file-property-identity">${fileIcon(entry, true)}<div><strong>${esc(entry.name)}</strong><span>${esc(typeLabel(entry))}</span></div></div><dl class="file-property-list">${rows}</dl><p class="file-settings-note">${columnText('访问日期由文件系统维护，可能延迟更新。文件夹大小使用后台缓存。', 'Access times are maintained by the file system and may update later. Folder sizes use the background cache.')}</p></div>`,
    `<button type="button" id="propertyColumns" class="file-settings-secondary">${columnText('选择显示列…', 'Choose columns…')}</button><span class="file-settings-spacer"></span><button type="button" data-close-dialog class="file-settings-primary">${columnText('完成', 'Done')}</button>`);
  if (dialog && entry.isDir) dialog.dataset.propertyPath = sizePathKey(join(state.path, entry.name));
  dialog?.querySelector('#propertyColumns').addEventListener('click', () => { dialog.close(); openColumnPicker(); });
}
function initColumns() {
  if (columnInitialized) return;
  columnInitialized = true;
  els.scroller.addEventListener('scroll', syncColumnScroll, { passive: true });
  els.dhead.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-resize]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const key = handle.dataset.resize;
    columnResize = { key, handle, startX: event.clientX, width: columnGeometry(columnLayout, els.scroller.clientWidth).widths[key], savedWidths: { ...columnLayout.widths }, pointerId: event.pointerId };
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-column');
  });
  els.dhead.addEventListener('pointermove', (event) => {
    if (!columnResize || event.pointerId !== columnResize.pointerId) return;
    setColumnWidth(columnResize.key, columnResize.width + event.clientX - columnResize.startX);
  });
  els.dhead.addEventListener('pointerup', (event) => finishColumnResize(event));
  els.dhead.addEventListener('pointercancel', (event) => finishColumnResize(event, true));
  els.dhead.addEventListener('lostpointercapture', (event) => finishColumnResize(event, true));
  els.dhead.addEventListener('dblclick', (event) => {
    const handle = event.target.closest('[data-resize]');
    if (!handle) return;
    event.preventDefault();
    fitColumn(handle.dataset.resize);
  });
  els.dhead.addEventListener('keydown', (event) => {
    const handle = event.target.closest('[data-resize]');
    if (!handle || !['ArrowLeft', 'ArrowRight', 'Home', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const key = handle.dataset.resize;
    if (event.key === 'Enter') fitColumn(key);
    else if (event.key === 'Home') { columnLayout.widths[key] = COLUMN_LIMITS[key].initial; syncColumnLayout(); saveColumns(); }
    else {
      const current = columnGeometry(columnLayout, els.scroller.clientWidth).widths[key];
      setColumnWidth(key, current + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 32 : 8));
      saveColumns();
    }
  });
  els.dhead.addEventListener('dragstart', (event) => {
    const header = event.target.closest('.h');
    if (!header || columnResize || event.target.closest('[data-resize]')) { event.preventDefault(); return; }
    columnDrag = header.dataset.k;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-dalizi-column', columnDrag);
    header.classList.add('column-dragging');
  });
  els.dhead.addEventListener('dragover', (event) => {
    const header = event.target.closest('.h');
    if (!columnDrag || !header) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    els.dhead.querySelectorAll('.drop-before,.drop-after').forEach((node) => node.classList.remove('drop-before', 'drop-after'));
    if (header.dataset.k !== columnDrag) {
      const rect = header.getBoundingClientRect();
      header.classList.add(event.clientX > rect.left + rect.width / 2 ? 'drop-after' : 'drop-before');
    }
  });
  els.dhead.addEventListener('drop', (event) => {
    const header = event.target.closest('.h');
    if (!columnDrag || !header) return;
    event.preventDefault();
    const rect = header.getBoundingClientRect();
    columnLayout.order = moveColumn(columnLayout.order, columnDrag, header.dataset.k, event.clientX > rect.left + rect.width / 2);
    clearColumnDrag();
    columnBlockClickUntil = Date.now() + 250;
    saveColumns();
    renderList();
  });
  els.dhead.addEventListener('dragend', () => { clearColumnDrag(); columnBlockClickUntil = Date.now() + 250; });
  els.dhead.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const key = event.target.closest('.h')?.dataset.k;
    const items = [
      { id: 'choose-columns', label: columnText('选择显示列…', 'Choose columns…'), fn: openColumnPicker },
      { id: 'reset-columns', label: columnText('恢复默认列布局', 'Reset column layout'), fn: resetColumns },
    ];
    if (key) items.unshift({ id: 'fit-column', label: columnText('自动适配此列', 'Fit this column'), fn: () => fitColumn(key) });
    showMenu(event.clientX, event.clientY, items);
  });
  syncColumnLayout();
}

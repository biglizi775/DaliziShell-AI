/* Local document reader. PDF bytes are rendered on a worker, one page at a time.
   Only our bundled fonts/CMaps are fetched; document scripts/forms/links are not mounted. */
const DOCUMENT_TEXT = {
  zh: { loading: '正在准备文档…', rendering: '正在绘制页面…', previous: '上一页', next: '下一页', page: '页码', fit: '适合宽度', zoom: '缩放', wide: '加宽阅读区', normal: '恢复阅读宽度', pdf: 'PDF · 本地预览', word: 'Word · 正文预览', wordHint: '显示正文和表格文字，不包含图片及原始排版。', partial: '文档较长，仅显示前 256 KB 正文。', empty: '文档中没有可预览的正文。', password: '此文档需要密码，请使用关联程序打开。', invalid: '文档已损坏或格式无法解析，请使用关联程序打开。', large: '文件超过预览上限（图片 8 MB / PDF 32 MB / Word 16 MB），请使用关联程序打开。', legacy: '旧版 .doc 暂不支持内嵌预览。可用 Word 打开，或另存为 .docx 后预览。', complex: '文档内容超出预览处理上限，请使用关联程序打开。' },
  en: { loading: 'Preparing document…', rendering: 'Rendering page…', previous: 'Previous page', next: 'Next page', page: 'Page', fit: 'Fit width', zoom: 'Zoom', wide: 'Widen reader', normal: 'Restore reader width', pdf: 'PDF · Local preview', word: 'Word · Text preview', wordHint: 'Body and table text only. Images and original layout are not included.', partial: 'Showing the first 256 KB of document text.', empty: 'This document has no body text to preview.', password: 'This document needs a password. Open it with the associated application.', invalid: 'The document is damaged or cannot be parsed. Open it with the associated application.', large: 'File exceeds the preview limit (images 8 MB / PDF 32 MB / Word 16 MB). Open it with the associated application.', legacy: 'Legacy .doc preview is unavailable. Open in Word, or save as .docx to preview.', complex: 'The document exceeds the preview processing limit. Open it with the associated application.' },
};
const documentText = (key) => DOCUMENT_TEXT[locale === 'zh' ? 'zh' : 'en'][key] || key;
Object.assign(DOCUMENT_TEXT.zh, {
  large: '文件超过预览上限（图片 8 MB / PDF、表格 32 MB / Word 16 MB），请使用关联程序打开。',
  sheet: '表格 · 本地只读预览', sheetHint: '显示保存的单元格值，不运行公式、宏或外部链接；不还原图表和完整格式。',
  sheetLimit: '预览最多 20 个工作表、每表前 500 行和 50 列，单元格最多 4 KB；内容可能已截断。',
  sheetSelect: '工作表', sheetEmpty: '此工作表没有可显示的单元格。', rowRange: '行',
  cloud: '此文件尚未完整下载到本机。请在网盘中选择“始终保留在此设备上”或下载后重试。',
  reparse: '此路径是链接或不支持的特殊文件。请定位到实际文件后预览。',
  unsafe: '此路径不是可预览的普通文件路径。', encoding: '无法识别此文本的编码，请转换为 UTF-8 后预览。',
  legacySheet: '此表格格式尚未接入。支持 XLSX、XLSM、XLTX、XLTM、XLSB、CSV、TSV；XLS/ODS 可另存为 XLSX 后预览。',
  enterPassword: '输入 PDF 密码', wrongPassword: '密码不正确，请重试。', unlock: '解锁预览', passwordHint: '密码只用于本次本地预览，不保存。',
  engine: 'PDF 预览组件加载失败。请确认正在运行完整的新版程序，或使用关联程序打开。',
});
Object.assign(DOCUMENT_TEXT.en, {
  large: 'Preview limit exceeded (images 8 MB / PDF and spreadsheets 32 MB / Word 16 MB). Open with the associated application.',
  sheet: 'Spreadsheet · Local read-only preview', sheetHint: 'Saved cell values only. Formulas, macros and external links are not executed; charts and full formatting are not rendered.',
  sheetLimit: 'Limited to 20 sheets, the first 500 rows and 50 columns per sheet, and 4 KB per cell. Content may be truncated.',
  sheetSelect: 'Worksheet', sheetEmpty: 'No cells to display in this worksheet.', rowRange: 'Rows',
  cloud: 'This cloud file is not fully downloaded. Download it or choose Always keep on this device, then retry.',
  reparse: 'This path is a link or special file. Locate the actual document to preview it.',
  unsafe: 'This is not an ordinary file path.', encoding: 'Unsupported text encoding. Convert the file to UTF-8 to preview it.',
  legacySheet: 'This spreadsheet format is not available yet. Supported: XLSX, XLSM, XLTX, XLTM, XLSB, CSV and TSV. Save XLS/ODS as XLSX to preview.',
  enterPassword: 'PDF password', wrongPassword: 'Incorrect password. Try again.', unlock: 'Unlock preview', passwordHint: 'Used only for this local preview; not saved.',
  engine: 'The PDF reader could not load. Run the complete updated app, or open with the associated application.',
});
let documentPreviewSession = null;
let documentPdfLibrary = null;

function documentPreviewReason(reason) {
  return ({ 'legacy-word': 'legacy', 'legacy-sheet': 'legacySheet', 'size-limit': 'large', 'invalid-document': 'invalid', 'encrypted-document': 'password', 'complex-document': 'complex', 'cloud-not-local': 'cloud', 'reparse-point': 'reparse', 'unsafe-path': 'unsafe', 'text-encoding': 'encoding' })[reason];
}
function disposeDocumentPreview() {
  const session = documentPreviewSession;
  documentPreviewSession = null;
  if (!session) return;
  session.disposed = true;
  clearTimeout(session.resizeTimer);
  session.observer?.disconnect();
  session.renderTask?.cancel();
  if (session.loadingTask) Promise.resolve(session.loadingTask.destroy()).catch(() => {});
}
function pdfCanvasGeometry(width, height, available, zoom, pixelRatio = 1) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Invalid page dimensions');
  const scale = zoom === 'fit' ? Math.max(100, available) / width : Number(zoom);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid zoom');
  // Bound both dimensions and memory even for PDFs declaring enormous pages.
  const bounded = Math.min(scale, 4096 / width, 4096 / height);
  const cssWidth = Math.max(1, width * bounded), cssHeight = Math.max(1, height * bounded);
  const density = Math.min(Math.max(1, pixelRatio), 2, Math.sqrt(4_000_000 / (cssWidth * cssHeight)));
  return { scale: bounded, cssWidth, cssHeight, density, width: Math.max(1, Math.floor(cssWidth * density)), height: Math.max(1, Math.floor(cssHeight * density)) };
}
async function loadDocumentPdfLibrary() {
  if (!documentPdfLibrary) {
    documentPdfLibrary = import('./vendor/pdfjs/legacy/build/pdf.min.mjs').then((library) => {
      library.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/legacy/build/pdf.worker.min.mjs', document.baseURI).href;
      return library;
    }).catch((error) => { documentPdfLibrary = null; throw error; });
  }
  return documentPdfLibrary;
}
async function renderDocumentPreview(result, container, name, current) {
  disposeDocumentPreview();
  if (result.kind === 'spreadsheet') { renderSpreadsheetPreview(result, container); return; }
  if (result.kind === 'document') {
    const label = document.createElement('p'); label.className = 'document-label'; label.textContent = documentText('word');
    const hint = document.createElement('p'); hint.className = 'preview-note'; hint.textContent = documentText('wordHint');
    const body = document.createElement('pre'); body.className = 'document-body'; body.textContent = result.content || documentText('empty');
    container.append(label, hint, body);
    if (result.truncated) { const note = document.createElement('p'); note.className = 'preview-note'; note.textContent = documentText('partial'); container.append(note); }
    return;
  }
  const session = { disposed: false, loadingTask: null, renderTask: null, page: 1, revision: 0, zoom: 'fit', pageObject: null };
  documentPreviewSession = session;
  const alive = () => !session.disposed && documentPreviewSession === session && current();
  container.innerHTML = `<div class="document-label"><span>${esc(documentText('pdf'))}</span><button class="document-wide" type="button" aria-pressed="false">${esc(documentText('wide'))}</button></div><div class="pdf-toolbar"><button type="button" data-pdf-prev disabled aria-label="${esc(documentText('previous'))}">‹</button><label><input data-pdf-page type="number" min="1" value="1" aria-label="${esc(documentText('page'))}" disabled><span data-pdf-total>/ —</span></label><button type="button" data-pdf-next disabled aria-label="${esc(documentText('next'))}">›</button><select data-pdf-zoom aria-label="${esc(documentText('zoom'))}" disabled><option value="fit">${esc(documentText('fit'))}</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></div><p class="preview-note pdf-status" role="status">${esc(documentText('loading'))}</p><div class="pdf-page-viewport" tabindex="0" aria-label="${esc(name)}"><canvas class="pdf-page" role="img" aria-label="${esc(name)}"></canvas></div>`;
  const previous = container.querySelector('[data-pdf-prev]'), next = container.querySelector('[data-pdf-next]');
  const pageInput = container.querySelector('[data-pdf-page]'), zoom = container.querySelector('[data-pdf-zoom]');
  const status = container.querySelector('.pdf-status'), viewport = container.querySelector('.pdf-page-viewport');
  let canvas = container.querySelector('canvas');
  const wide = container.querySelector('.document-wide');
  wide.onclick = () => {
    const expanded = $('previewPanel').classList.toggle('preview-wide');
    wide.setAttribute('aria-pressed', String(expanded)); wide.textContent = documentText(expanded ? 'normal' : 'wide');
  };
  try {
    let library;
    try { library = await loadDocumentPdfLibrary(); } catch (error) { error.previewEngine = true; throw error; }
    if (!alive()) return;
    const binary = atob(result.content), data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    session.loadingTask = library.getDocument({
      data, cMapUrl: new URL('vendor/pdfjs/cmaps/', document.baseURI).href, cMapPacked: true,
      standardFontDataUrl: new URL('vendor/pdfjs/standard_fonts/', document.baseURI).href,
      wasmUrl: new URL('vendor/pdfjs/wasm/', document.baseURI).href,
      iccUrl: new URL('vendor/pdfjs/iccs/', document.baseURI).href,
      isEvalSupported: false, enableXfa: false, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 16_000_000,
      useWorkerFetch: true, verbosity: 0,
    });
    session.loadingTask.onPassword = (submit, reason) => {
      if (!alive()) return;
      status.textContent = documentText(reason === library.PasswordResponses.INCORRECT_PASSWORD ? 'wrongPassword' : 'passwordHint');
      viewport.replaceChildren();
      const form = document.createElement('form'); form.className = 'pdf-password';
      const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; input.placeholder = documentText('enterPassword'); input.setAttribute('aria-label', documentText('enterPassword'));
      const button = document.createElement('button'); button.type = 'submit'; button.textContent = documentText('unlock');
      form.append(input, button); viewport.append(form);
      form.onsubmit = (event) => { event.preventDefault(); if (!alive() || !input.value) return; const password = input.value; input.value = ''; button.disabled = true; submit(password); };
    };
    const pdf = await session.loadingTask.promise;
    if (!alive()) return;
    viewport.replaceChildren(canvas);
    pageInput.disabled = zoom.disabled = false; pageInput.max = String(pdf.numPages);
    container.querySelector('[data-pdf-total]').textContent = `/ ${pdf.numPages}`;
    const renderPage = async () => {
      const revision = ++session.revision;
      const oldTask = session.renderTask;
      oldTask?.cancel();
      if (oldTask) await oldTask.promise.catch(() => {});
      if (!alive() || revision !== session.revision) return;
      session.pageObject?.cleanup(); session.pageObject = null;
      previous.disabled = session.page <= 1; next.disabled = session.page >= pdf.numPages;
      pageInput.value = String(session.page);
      status.textContent = documentText('rendering');
      let nextCanvas;
      try {
        const page = await pdf.getPage(session.page);
        if (!alive() || revision !== session.revision) { page.cleanup(); return; }
        session.pageObject = page;
        const initial = page.getViewport({ scale: 1 });
        const geometry = pdfCanvasGeometry(initial.width, initial.height, viewport.clientWidth - 20, session.zoom, window.devicePixelRatio);
        // Paint offscreen. Resizing a visible canvas clears it immediately and
        // otherwise flashes white on every fit-width/zoom/page update.
        nextCanvas = document.createElement('canvas');
        nextCanvas.className = 'pdf-page'; nextCanvas.setAttribute('role', 'img');
        nextCanvas.width = geometry.width; nextCanvas.height = geometry.height;
        nextCanvas.style.width = `${geometry.cssWidth}px`; nextCanvas.style.height = `${geometry.cssHeight}px`;
        nextCanvas.setAttribute('aria-label', `${name} · ${session.page} / ${pdf.numPages}`);
        session.renderTask = page.render({ canvasContext: nextCanvas.getContext('2d'), viewport: page.getViewport({ scale: geometry.scale }), transform: [geometry.density, 0, 0, geometry.density, 0, 0], annotationMode: library.AnnotationMode.DISABLE });
        await session.renderTask.promise;
        if (alive() && revision === session.revision) {
          nextCanvas.dataset.page = String(session.page);
          canvas.replaceWith(nextCanvas); canvas.width = canvas.height = 0; canvas = nextCanvas;
          status.textContent = `${session.page} / ${pdf.numPages}`;
        }
      } catch (error) {
        if (alive() && revision === session.revision && error.name !== 'RenderingCancelledException') status.textContent = documentText('invalid');
      } finally {
        if (nextCanvas && nextCanvas !== canvas) nextCanvas.width = nextCanvas.height = 0;
      }
    };
    const changePage = (number) => {
      session.page = Math.max(1, Math.min(pdf.numPages, Number.isFinite(number) ? Math.trunc(number) : session.page));
      viewport.scrollTop = viewport.scrollLeft = 0;
      void renderPage();
    };
    previous.onclick = () => changePage(session.page - 1); next.onclick = () => changePage(session.page + 1);
    pageInput.onchange = () => changePage(Number(pageInput.value));
    pageInput.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); changePage(Number(pageInput.value)); } };
    zoom.onchange = () => { session.zoom = zoom.value; void renderPage(); };
    viewport.onkeydown = (event) => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); changePage(session.page + (event.key === 'ArrowRight' ? 1 : -1)); }
    };
    let lastWidth = viewport.clientWidth;
    session.observer = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width; clearTimeout(session.resizeTimer);
      session.resizeTimer = setTimeout(() => { if (alive() && session.zoom === 'fit') void renderPage(); }, 100);
    });
    session.observer.observe(viewport);
    await renderPage();
  } catch (error) {
    if (!alive()) return;
    status.textContent = documentText(error.previewEngine ? 'engine' : error.name === 'PasswordException' ? 'password' : 'invalid');
    viewport.hidden = true;
    if (session.loadingTask) { await session.loadingTask.destroy().catch(() => {}); session.loadingTask = null; }
  }
}

function sheetColumnName(index) {
  let text = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text;
  return text;
}
function renderSpreadsheetPreview(result, container) {
  const workbook = JSON.parse(result.content);
  if (!Array.isArray(workbook.sheets)) throw new Error(documentText('invalid'));
  container.innerHTML = `<div class="document-label">${esc(documentText('sheet'))}</div><p class="preview-note">${esc(documentText('sheetHint'))}</p><div class="sheet-toolbar"><select data-sheet-select aria-label="${esc(documentText('sheetSelect'))}"></select><button type="button" data-sheet-prev aria-label="${esc(documentText('previous'))}">‹</button><span data-sheet-range></span><button type="button" data-sheet-next aria-label="${esc(documentText('next'))}">›</button></div><p class="preview-note sheet-limit"></p><div class="sheet-viewport" tabindex="0"><table class="sheet-grid"></table></div>`;
  const select = container.querySelector('[data-sheet-select]'), previous = container.querySelector('[data-sheet-prev]'), next = container.querySelector('[data-sheet-next]');
  const range = container.querySelector('[data-sheet-range]'), grid = container.querySelector('.sheet-grid'), viewport = container.querySelector('.sheet-viewport');
  viewport.onkeydown = (event) => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) event.stopPropagation(); };
  let page = 0;
  for (const [i, sheet] of workbook.sheets.entries()) { const option = document.createElement('option'); option.value = String(i); option.textContent = sheet.name; select.append(option); }
  const paint = () => {
    const sheet = workbook.sheets[Number(select.value) || 0], rows = sheet?.rows || [], start = page * 50;
    previous.disabled = page === 0; next.disabled = start + 50 >= rows.length;
    range.textContent = rows.length ? `${documentText('rowRange')} ${start + 1}–${Math.min(start + 50, rows.length)} / ${rows.length}` : documentText('sheetEmpty');
    container.querySelector('.sheet-limit').textContent = workbook.truncated || sheet?.truncated ? documentText('sheetLimit') : '';
    const width = Math.max(0, ...rows.map((r) => r.length));
    grid.replaceChildren();
    const head = document.createElement('thead'), heading = document.createElement('tr');
    for (let col = -1; col < width; col++) { const th = document.createElement('th'); th.textContent = col < 0 ? '#' : sheetColumnName(col); th.scope = 'col'; heading.append(th); }
    head.append(heading); grid.append(head);
    const body = document.createElement('tbody');
    rows.slice(start, start + 50).forEach((row, i) => {
      const tr = document.createElement('tr'), number = document.createElement('th'); number.scope = 'row'; number.textContent = String(start + i + 1); tr.append(number);
      for (let c = 0; c < width; c++) { const td = document.createElement('td'); td.textContent = row[c] || ''; tr.append(td); }
      body.append(tr);
    });
    grid.append(body); viewport.scrollTop = viewport.scrollLeft = 0;
  };
  select.onchange = () => { page = 0; paint(); };
  previous.onclick = () => { if (page) { page--; paint(); } };
  next.onclick = () => { page++; paint(); };
  paint();
}

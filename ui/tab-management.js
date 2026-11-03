'use strict';
const tabText = (zh, en) => locale === 'zh' ? zh : en;
const recentlyClosedTabs = [];
let tabDrag = null, suppressTabClickUntil = 0;
let tabRevealFrame = null, tabDragFrame = null, tabViewportOwner = null, tabViewportIndex = -1;
let tabViewportLocation = null;
let tabScrollbarDrag = null;
function syncTabScrollbar() {
  const viewport = $('tabViewport'), track = $('tabScrollTrack'), thumb = $('tabScrollThumb');
  const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth), width = track.clientWidth;
  const thumbWidth = Math.min(width, Math.max(28, width * viewport.clientWidth / Math.max(1, viewport.scrollWidth)));
  track.classList.toggle('has-overflow', maximum > 1); track.tabIndex = maximum > 1 ? 0 : -1;
  track.setAttribute('aria-hidden', String(maximum <= 1));
  track.setAttribute('aria-label', tabText('标签页滚动条', 'Tab scrollbar'));
  track.setAttribute('aria-valuemax', String(Math.round(maximum)));
  track.setAttribute('aria-valuenow', String(Math.round(viewport.scrollLeft)));
  thumb.style.width = thumbWidth + 'px';
  thumb.style.transform = `translateX(${maximum ? (width - thumbWidth) * viewport.scrollLeft / maximum : 0}px)`;
}
function tabWheelDistance(event, width) {
  if (event.ctrlKey) return 0;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  return delta * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? width : 1);
}
function revealActiveTab() {
  if (tabRevealFrame !== null) return;
  tabRevealFrame = requestAnimationFrame(() => {
    tabRevealFrame = null;
    const viewport = $('tabViewport'), active = viewport?.querySelector('.tab.on');
    if (!active || tabDrag?.moved) return;
    const area = viewport.getBoundingClientRect(), rect = active.getBoundingClientRect();
    if (rect.left < area.left || rect.width > viewport.clientWidth) viewport.scrollLeft += rect.left - area.left;
    else if (rect.right > area.left + viewport.clientWidth) viewport.scrollLeft += rect.right - area.left - viewport.clientWidth;
    syncTabScrollbar();
  });
}
function syncTabViewport() {
  const viewport = $('tabViewport'); if (!viewport) return;
  viewport.setAttribute('aria-label', tabText('标签页：滚轮左右浏览，也可拖动下方滚动条', 'Tabs: use the wheel or drag the scrollbar to browse'));
  // Background titles and directory refreshes must not undo manual scrolling.
  const owner = curTab(), location = isBrowserTab(owner) ? owner.url : isTermTab(owner) ? owner.cwd : owner?.path;
  if (tabViewportOwner !== owner || tabViewportIndex !== state.tab || tabViewportLocation !== location) revealActiveTab();
  tabViewportOwner = owner; tabViewportIndex = state.tab; tabViewportLocation = location;
  syncTabScrollbar();
}
function paintTabDropTarget() {
  const drag = tabDrag; if (!drag?.moved) return;
  const viewport = $('tabViewport'), area = viewport.getBoundingClientRect();
  const inside = drag.clientX >= area.left && drag.clientX <= area.right && drag.clientY >= area.top && drag.clientY < area.top + viewport.clientHeight;
  const target = inside ? document.elementFromPoint(drag.clientX, drag.clientY)?.closest('.tab') : null;
  els.tabbar.querySelectorAll('.tab-drop-before, .tab-drop-after').forEach(el => el.classList.remove('tab-drop-before', 'tab-drop-after'));
  drag.target = target && viewport.contains(target) ? target.workbenchTab : null;
  if (!drag.target || drag.target === drag.tab) return;
  const bounds = target.getBoundingClientRect(); drag.after = drag.clientX >= bounds.left + bounds.width / 2;
  target.classList.add(drag.after ? 'tab-drop-after' : 'tab-drop-before');
}
function scrollDraggedTabs() {
  tabDragFrame = null;
  const drag = tabDrag; if (!drag?.moved) return;
  const viewport = $('tabViewport'), area = viewport.getBoundingClientRect();
  if (drag.clientY >= area.top - 16 && drag.clientY <= area.bottom + 16 && drag.clientX >= area.left - 16 && drag.clientX <= area.right + 16) {
    const edge = Math.min(36, viewport.clientWidth / 4);
    const delta = drag.clientX < area.left + edge ? -12 : drag.clientX > area.right - edge ? 12 : 0;
    if (delta) { viewport.scrollLeft += delta; paintTabDropTarget(); tabDragFrame = requestAnimationFrame(scrollDraggedTabs); }
  }
}
function rememberClosedTab(tab) {
  if (!tab || isTermTab(tab)) return;
  let item;
  if (isBrowserTab(tab)) {
    if (!browserSettings().recordHistory) return;
    const target = placeTarget(tab.pendingNavigation || tab.url);
    if (target?.kind !== 'browser') return;
    item = { kind: 'browser', url: target.url };
  } else {
    const path = tab.path === null ? null : placeFolder(tab.path);
    if (path === null && tab.path !== null) return;
    item = { kind: 'files', path };
  }
  recentlyClosedTabs.push(item);
  if (recentlyClosedTabs.length > 20) recentlyClosedTabs.shift();
}
function clearClosedBrowserTabs() {
  for (let i = recentlyClosedTabs.length - 1; i >= 0; i--) if (recentlyClosedTabs[i].kind === 'browser') recentlyClosedTabs.splice(i, 1);
  updateReopenTabButton();
}
function updateReopenTabButton() {
  const button = $('tabReopen'); if (button) button.disabled = !recentlyClosedTabs.length;
}
async function reopenClosedTab() {
  if (!browserSettings().recordHistory) clearClosedBrowserTabs();
  const item = recentlyClosedTabs.pop(); updateReopenTabButton();
  if (!item) return;
  // Recreate UI identity. Terminal processes, credentials and AI permissions are never replayed.
  if (item.kind === 'browser') await newBrowserTab(item.url);
  else await newTab(item.path);
}
function moveWorkbenchTab(tab, targetIndex) {
  const from = state.tabs.indexOf(tab), active = curTab();
  if (from < 0 || !Number.isInteger(targetIndex)) return false;
  const to = Math.max(0, Math.min(state.tabs.length - 1, targetIndex));
  if (from === to) return false;
  state.tabs.splice(from, 1); state.tabs.splice(to, 0, tab);
  state.tab = state.tabs.indexOf(active);
  renderTabs(); // no navigation, process restart, focus change or content redraw
  return true;
}
function tabManagementMenu(tab) {
  const i = state.tabs.indexOf(tab);
  return [
    { id: 'tab-left', label: tabText('向左移动标签', 'Move tab left'), dis: i <= 0, fn: () => moveWorkbenchTab(tab, state.tabs.indexOf(tab) - 1) },
    { id: 'tab-right', label: tabText('向右移动标签', 'Move tab right'), dis: i < 0 || i >= state.tabs.length - 1, fn: () => moveWorkbenchTab(tab, state.tabs.indexOf(tab) + 1) },
    { id: 'tab-reopen', label: tabText('恢复刚关闭的标签', 'Reopen closed tab'), dis: !recentlyClosedTabs.length, fn: reopenClosedTab },
  ];
}
function cancelTabDrag() {
  if (tabDragFrame !== null) { cancelAnimationFrame(tabDragFrame); tabDragFrame = null; }
  if (!tabDrag) return;
  const id = tabDrag.pointer; tabDrag = null;
  els.tabbar.classList.remove('sorting-tabs');
  els.tabbar.querySelectorAll('.tab-drop-before, .tab-drop-after').forEach((el) => el.classList.remove('tab-drop-before', 'tab-drop-after'));
  if (els.tabbar.hasPointerCapture(id)) els.tabbar.releasePointerCapture(id);
}
function initTabManagement() {
  const bar = els.tabbar;
  const viewport = $('tabViewport');
  bar.addEventListener('wheel', event => {
    if (viewport.scrollWidth <= viewport.clientWidth) return;
    const delta = tabWheelDistance(event, viewport.clientWidth); if (!delta) return;
    event.preventDefault(); viewport.scrollLeft += delta;
  }, { passive: false });
  viewport.addEventListener('scroll', () => { syncTabScrollbar(); paintTabDropTarget(); }, { passive: true });
  const track = $('tabScrollTrack');
  const scrollKeys = event => {
    if ((event.target !== viewport && event.target !== track) || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') viewport.scrollLeft = 0;
    else if (event.key === 'End') viewport.scrollLeft = viewport.scrollWidth;
    else viewport.scrollLeft += event.key === 'PageUp' ? -viewport.clientWidth : event.key === 'PageDown' ? viewport.clientWidth : event.key === 'ArrowLeft' ? -160 : 160;
  };
  viewport.addEventListener('keydown', scrollKeys); track.addEventListener('keydown', scrollKeys);
  track.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !track.classList.contains('has-overflow')) return;
    event.preventDefault(); track.focus({ preventScroll: true });
    const rect = track.getBoundingClientRect(), thumbWidth = $('tabScrollThumb').getBoundingClientRect().width;
    const maximum = viewport.scrollWidth - viewport.clientWidth, travel = rect.width - thumbWidth;
    if (travel <= 0) return;
    if (event.target !== $('tabScrollThumb')) viewport.scrollLeft = Math.max(0, Math.min(1, (event.clientX - rect.left - thumbWidth / 2) / travel)) * maximum;
    tabScrollbarDrag = { pointer: event.pointerId, x: event.clientX, start: viewport.scrollLeft, maximum, travel };
    track.setPointerCapture(event.pointerId); syncTabScrollbar();
  });
  track.addEventListener('pointermove', event => {
    const drag = tabScrollbarDrag; if (!drag || drag.pointer !== event.pointerId) return;
    viewport.scrollLeft = drag.start + (event.clientX - drag.x) * drag.maximum / drag.travel; syncTabScrollbar();
  });
  const endScrollbar = () => { const drag = tabScrollbarDrag; tabScrollbarDrag = null; if (drag && track.hasPointerCapture(drag.pointer)) track.releasePointerCapture(drag.pointer); };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(event, endScrollbar);
  window.addEventListener('blur', endScrollbar);
  new ResizeObserver(() => { syncTabScrollbar(); revealActiveTab(); }).observe(viewport);
  bar.addEventListener('click', (event) => {
    if (Date.now() < suppressTabClickUntil && (event.target === bar || (event.target.closest('.tab') && !event.target.closest('button')))) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  bar.addEventListener('pointerdown', (event) => {
    const element = event.target.closest('.tab');
    if (event.button !== 0 || !element || event.target.closest('button')) return;
    cancelTabDrag();
    tabDrag = { pointer: event.pointerId, tab: element.workbenchTab, x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY, moved: false, target: null, after: false };
    bar.setPointerCapture(event.pointerId);
  });
  bar.addEventListener('pointermove', (event) => {
    const drag = tabDrag; if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.moved = true; drag.clientX = event.clientX; drag.clientY = event.clientY;
    bar.classList.add('sorting-tabs'); event.preventDefault(); paintTabDropTarget();
    if (tabDragFrame === null) tabDragFrame = requestAnimationFrame(scrollDraggedTabs);
  });
  bar.addEventListener('pointerup', (event) => {
    const drag = tabDrag; if (!drag || drag.pointer !== event.pointerId) return;
    cancelTabDrag();
    if (!drag.moved) {
      // Pointer capture retargets click to the bar; activate the actual original tab.
      const index = state.tabs.indexOf(drag.tab); if (index >= 0) switchTab(index);
      suppressTabClickUntil = Date.now() + 100; return;
    }
    suppressTabClickUntil = Date.now() + 200;
    const from = state.tabs.indexOf(drag.tab), target = state.tabs.indexOf(drag.target);
    if (from >= 0 && target >= 0 && from !== target) moveWorkbenchTab(drag.tab, target + (drag.after ? 1 : 0) - (from < target ? 1 : 0));
  });
  bar.addEventListener('pointercancel', cancelTabDrag); bar.addEventListener('lostpointercapture', cancelTabDrag);
  window.addEventListener('blur', cancelTabDrag);
  bar.addEventListener('keydown', (event) => {
    const element = event.target.closest('.tab'); if (!element || event.target.closest('button')) return;
    if (event.key === 'Escape') { cancelTabDrag(); return; }
    const index = Number(element.dataset.t), tab = state.tabs[index];
    if (event.altKey && event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); moveWorkbenchTab(tab, index + (event.key === 'ArrowLeft' ? -1 : 1));
      bar.querySelector(`[data-t="${state.tabs.indexOf(tab)}"]`)?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); switchTab(index); }
  });
}

'use strict';
const tabText = (zh, en) => locale === 'zh' ? zh : en;
const recentlyClosedTabs = [];
let tabDrag = null, suppressTabClickUntil = 0;
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
  if (!tabDrag) return;
  const id = tabDrag.pointer; tabDrag = null;
  els.tabbar.classList.remove('sorting-tabs');
  els.tabbar.querySelectorAll('.tab-drop-before, .tab-drop-after').forEach((el) => el.classList.remove('tab-drop-before', 'tab-drop-after'));
  if (els.tabbar.hasPointerCapture(id)) els.tabbar.releasePointerCapture(id);
}
function initTabManagement() {
  const bar = els.tabbar;
  bar.addEventListener('click', (event) => {
    if (Date.now() < suppressTabClickUntil && (event.target === bar || (event.target.closest('.tab') && !event.target.closest('button')))) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  bar.addEventListener('pointerdown', (event) => {
    const element = event.target.closest('.tab');
    if (event.button !== 0 || !element || event.target.closest('button')) return;
    cancelTabDrag();
    tabDrag = { pointer: event.pointerId, tab: state.tabs[Number(element.dataset.t)], x: event.clientX, y: event.clientY, moved: false, target: null, after: false };
    bar.setPointerCapture(event.pointerId);
  });
  bar.addEventListener('pointermove', (event) => {
    const drag = tabDrag; if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.moved = true; bar.classList.add('sorting-tabs'); event.preventDefault();
    const rect = bar.getBoundingClientRect();
    if (event.clientX < rect.left + 35) bar.scrollLeft -= 20;
    if (event.clientX > rect.right - 35) bar.scrollLeft += 20;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tab');
    bar.querySelectorAll('.tab-drop-before, .tab-drop-after').forEach((el) => el.classList.remove('tab-drop-before', 'tab-drop-after'));
    drag.target = target && bar.contains(target) ? state.tabs[Number(target.dataset.t)] : null;
    if (!drag.target || drag.target === drag.tab) return;
    const bounds = target.getBoundingClientRect(); drag.after = event.clientX >= bounds.left + bounds.width / 2;
    target.classList.add(drag.after ? 'tab-drop-after' : 'tab-drop-before');
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

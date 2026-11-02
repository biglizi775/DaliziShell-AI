/* Independent Agent dock and a modeless floating reader. Never owns preview state. */
let agentLayoutPanel = null, agentLayoutOpen = false, agentLayoutWidth = 380;
let agentFloating = store.get('agentFloating', false) === true;
let agentFloatBounds = store.get('agentFloatBounds', null), agentWindowGesture = null;

function agentWindowBounds(raw, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const maxWidth = Math.max(260, viewportWidth - 24), maxHeight = Math.max(280, viewportHeight - 24);
  const width = Math.max(Math.min(320, maxWidth), Math.min(maxWidth, finite(raw?.width, 396)));
  const height = Math.max(Math.min(420, maxHeight), Math.min(maxHeight, finite(raw?.height, viewportHeight - 36)));
  const x = Math.max(12, Math.min(viewportWidth - width - 12, finite(raw?.x, viewportWidth - width - 18)));
  const y = Math.max(12, Math.min(viewportHeight - height - 12, finite(raw?.y, 18)));
  return { x, y, width, height };
}
function paintAgentWindow() {
  const dock = $('agentDock');
  agentFloatBounds = agentWindowBounds(agentFloatBounds);
  for (const [key, value] of Object.entries(agentFloatBounds)) dock.style.setProperty('--agent-float-' + key, `${value}px`);
  const handle = dock.querySelector('.agent-window-resize');
  handle?.setAttribute('aria-valuetext', `${Math.round(agentFloatBounds.width)} × ${Math.round(agentFloatBounds.height)}`);
}
function syncAgentLayout(open, width) {
  if (!agentLayoutPanel) return;
  agentLayoutOpen = !!open;
  if (Number.isFinite(width)) agentLayoutWidth = Math.max(320, Math.min(560, width));
  const dock = $('agentDock'), sidebarWidth = window.innerWidth <= 1120 ? 64 : 180;
  const allowed = Math.max(320, Math.min(560, window.innerWidth - sidebarWidth - 520));
  dock.classList.toggle('hidden', !agentLayoutOpen);
  dock.classList.toggle('agent-floating', agentFloating);
  document.body.classList.toggle('agent-docked', agentLayoutOpen && !agentFloating);
  document.body.classList.toggle('agent-floating', agentLayoutOpen && agentFloating);
  document.documentElement.style.setProperty('--agent-sidebar-width', `${sidebarWidth}px`);
  document.documentElement.style.setProperty('--agent-dock-width', `${Math.min(agentLayoutWidth, allowed)}px`);
  for (const [id, zh, en] of [['brandHome', '工作空间', 'Workspace'], ['btnAiSidebar', 'Agent 对话', 'Agent chat'], ['btnCommand', '快捷操作', 'Quick actions']]) {
    const item = $(id);
    if (item) { item.title = locale === 'en' ? en : zh; item.setAttribute('aria-label', item.title); }
  }
  const floatingButton = agentLayoutPanel.querySelector('[data-ai-action="float"]');
  if (floatingButton) {
    const label = locale === 'en' ? agentFloating ? 'Dock to the right' : 'Open floating chat' : agentFloating ? '停靠到右侧' : '浮动对话窗口';
    floatingButton.title = label; floatingButton.setAttribute('aria-label', label);
    floatingButton.setAttribute('aria-pressed', String(agentFloating));
    floatingButton.classList.toggle('active', agentFloating);
  }
  const heading = agentLayoutPanel.querySelector('.ai-chat-header');
  heading.tabIndex = agentFloating ? 0 : -1;
  heading.setAttribute('aria-label', locale === 'en' ? 'Agent conversation. Drag or use arrow keys to move the floating window.' : 'Agent 对话。浮动时可拖动标题或用方向键移动窗口。');
  if (agentFloating) {
    paintAgentWindow();
  }
}
function toggleAgentFloating() {
  agentFloating = !agentFloating;
  store.set('agentFloating', agentFloating);
  if (agentFloating && !agentFloatBounds) agentFloatBounds = agentWindowBounds({ width: agentLayoutWidth });
  syncAgentLayout(agentLayoutOpen);
}
function initAgentLayout(panel) {
  if (agentLayoutPanel) return;
  agentLayoutPanel = panel;
  const dock = $('agentDock');
  panel.setAttribute('role', 'complementary');
  const handle = document.createElement('button');
  handle.type = 'button'; handle.className = 'agent-window-resize'; handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', locale === 'en' ? 'Resize floating chat; use arrow keys' : '调整浮动对话大小；可使用方向键');
  dock.append(handle);
  const heading = panel.querySelector('.ai-chat-header');
  const begin = (event, kind) => {
    if (!agentFloating || event.button !== 0 || (kind === 'move' && event.target.closest('button, input, a'))) return;
    event.preventDefault();
    const target = kind === 'move' ? heading : handle;
    target.setPointerCapture(event.pointerId);
    agentFloatBounds = agentWindowBounds(agentFloatBounds);
    agentWindowGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: { ...agentFloatBounds }, kind, target };
    document.body.classList.add(kind === 'move' ? 'agent-moving' : 'agent-window-resizing');
  };
  heading.addEventListener('pointerdown', (event) => begin(event, 'move'));
  handle.addEventListener('pointerdown', (event) => begin(event, 'resize'));
  dock.addEventListener('pointermove', (event) => {
    const gesture = agentWindowGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    agentFloatBounds = gesture.kind === 'move'
      ? { ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy }
      : { ...gesture.start, width: Math.min(window.innerWidth - gesture.start.x - 12, gesture.start.width + dx), height: Math.min(window.innerHeight - gesture.start.y - 12, gesture.start.height + dy) };
    paintAgentWindow();
  });
  const finish = (event) => {
    const gesture = agentWindowGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    agentWindowGesture = null;
    if (gesture.target.hasPointerCapture?.(event.pointerId)) gesture.target.releasePointerCapture(event.pointerId);
    document.body.classList.remove('agent-moving', 'agent-window-resizing');
    store.set('agentFloatBounds', agentFloatBounds);
  };
  dock.addEventListener('pointerup', finish); dock.addEventListener('pointercancel', finish); dock.addEventListener('lostpointercapture', finish);
  const keyboard = (event, kind) => {
    if (!agentFloating || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.target !== event.currentTarget) return;
    event.preventDefault(); event.stopPropagation();
    agentFloatBounds = agentWindowBounds(agentFloatBounds);
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const key = kind === 'move' ? horizontal ? 'x' : 'y' : horizontal ? 'width' : 'height';
    agentFloatBounds[key] += event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -16 : 16;
    paintAgentWindow(); store.set('agentFloatBounds', agentFloatBounds);
  };
  heading.addEventListener('keydown', (event) => keyboard(event, 'move'));
  handle.addEventListener('keydown', (event) => keyboard(event, 'resize'));
  window.addEventListener('resize', () => syncAgentLayout(agentLayoutOpen));
}

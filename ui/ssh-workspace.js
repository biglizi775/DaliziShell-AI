/* The authenticated SSH connection owns one terminal and one visible file workspace. */
function setSshWorkspaceLayout(tb, layout) {
  if (!tb.sshConfig?.managed || tb.disposed) return;
  const terminalReady = tb.sshTerminalState === 'ready' && !tb.exited;
  if (layout !== 'files' && !terminalReady) return;
  ensureSshFilePanel(tb);
  tb.sshTerminalVisible = layout !== 'files';
  if (tb.sshFilesPanel) tb.sshFilesPanel.hidden = layout === 'terminal';
  tb.el.classList.toggle('ssh-files-open', !!tb.sshFilesPanel && !tb.sshFilesPanel.hidden);
  syncManagedTerminalUi(tb);
  if (layout === 'terminal' && curTab() === tb) tb.term?.focus();
}
function mountSshWorkspace(tb) {
  if (!tb.sshConfig?.managed || !tb.el) return;
  tb.el.classList.add('ssh-workbench');
  if (!tb.sshWorkspaceBar) {
    const bar = document.createElement('div'); bar.className = 'ssh-workspace-toolbar';
    bar.innerHTML = `<strong>${esc(ms('SSH 工作区', 'SSH workspace'))}</strong><div class="ssh-layout-options" role="group" aria-label="${esc(ms('工作区布局', 'Workspace layout'))}"><button type="button" data-ssh-layout="split">${esc(ms('分屏', 'Split'))}</button><button type="button" data-ssh-layout="files" data-ssh-files>${esc(ms('文件', 'Files'))}</button><button type="button" data-ssh-layout="terminal" data-ssh-terminal>${esc(ms('终端', 'Terminal'))}</button></div><span class="ssh-toolbar-spacer"></span><button type="button" data-workspace-interrupt title="Ctrl+C">Ctrl+C</button><button type="button" data-workspace-reconnect>${esc(ms('重连', 'Reconnect'))}</button><button type="button" data-workspace-disconnect>${esc(ms('断开', 'Disconnect'))}</button>`;
    bar.querySelectorAll('[data-ssh-layout]').forEach(button => { button.onclick = () => setSshWorkspaceLayout(tb, button.dataset.sshLayout); });
    bar.querySelector('[data-workspace-interrupt]').onclick = () => interruptSshTab(tb);
    bar.querySelector('[data-workspace-reconnect]').onclick = () => reconnectSshTab(tb);
    bar.querySelector('[data-workspace-disconnect]').onclick = () => disconnectSshTab(tb);
    tb.sshWorkspaceBar = bar; tb.el.insertBefore(bar, tb.termViewport);
    const pending = document.createElement('p'); pending.className = 'ssh-terminal-pending';
    pending.textContent = ms('正在准备交互终端，远程文件可直接使用…', 'Preparing terminal. Remote files are available…');
    tb.termViewport.append(pending); tb.sshTerminalPending = pending;
    const splitter = document.createElement('div'); splitter.className = 'ssh-workspace-divider'; splitter.tabIndex = 0;
    splitter.setAttribute('role', 'separator'); splitter.setAttribute('aria-orientation', 'horizontal');
    splitter.setAttribute('aria-label', ms('调整终端与文件面板高度', 'Resize terminal and file panels'));
    tb.sshWorkspaceDivider = splitter; tb.termViewport.after(splitter);
    const resize = height => {
      const host = tb.el.getBoundingClientRect(), terminal = tb.termViewport.getBoundingClientRect();
      const minimumFiles = innerWidth < 1000 ? 170 : 190;
      const maximum = Math.max(80, host.bottom - terminal.top - minimumFiles - 6);
      tb.el.style.setProperty('--ssh-terminal-height', Math.max(80, Math.min(maximum, height)) + 'px');
      fitTerm(tb);
    };
    let drag = null;
    splitter.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); splitter.focus(); drag = { id:event.pointerId, y:event.clientY, height:tb.termViewport.getBoundingClientRect().height };
      splitter.setPointerCapture(event.pointerId);
    });
    splitter.addEventListener('pointermove', event => { if (drag?.id === event.pointerId) resize(drag.height + event.clientY - drag.y); });
    const end = () => { const current = drag; drag = null; if (current && splitter.hasPointerCapture(current.id)) splitter.releasePointerCapture(current.id); };
    for (const name of ['pointerup','pointercancel','lostpointercapture']) splitter.addEventListener(name, end);
    splitter.addEventListener('keydown', event => {
      if (!['ArrowUp','ArrowDown','Home'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Home') { tb.el.style.removeProperty('--ssh-terminal-height'); fitTerm(tb); }
      else resize(tb.termViewport.getBoundingClientRect().height + (event.key === 'ArrowUp' ? -24 : 24));
    });
    splitter.addEventListener('dblclick', () => { tb.el.style.removeProperty('--ssh-terminal-height'); fitTerm(tb); });
    tb.sshWorkspaceResize = new ResizeObserver(() => { if (!drag) tb.el.style.removeProperty('--ssh-terminal-height'); fitTerm(tb); });
    tb.sshWorkspaceResize.observe(tb.el);
  }
  if (tb.sshFilesPanel && tb.el.lastElementChild !== tb.sshFilesPanel) tb.el.append(tb.sshFilesPanel);
  const terminalReady = tb.sshTerminalState === 'ready' && !tb.exited && !tb.sshDisconnectRequested;
  tb.sshTerminalPending.hidden = tb.sshTerminalState !== 'starting' || !!tb.exited;
  const filesShown = !!tb.sshFilesPanel && !tb.sshFilesPanel.hidden;
  tb.el.classList.toggle('ssh-files-hidden', !filesShown);
  const layout = !tb.sshTerminalVisible ? 'files' : filesShown ? 'split' : 'terminal';
  for (const button of tb.sshWorkspaceBar.querySelectorAll('[data-ssh-layout]')) {
    button.setAttribute('aria-pressed', String(button.dataset.sshLayout === layout));
    button.disabled = button.dataset.sshLayout === 'files' ? !tb.sshAuthenticated : !terminalReady;
  }
  tb.sshWorkspaceBar.querySelector('[data-workspace-interrupt]').disabled = !terminalReady || !!tb.interruptPromise;
  tb.sshWorkspaceBar.querySelector('[data-workspace-reconnect]').disabled = !!tb.sshReconnecting || !!tb.sshDisconnecting;
  tb.sshWorkspaceBar.querySelector('[data-workspace-disconnect]').disabled = !!tb.exited || !!tb.sshDisconnecting;
}
function visibleSshEntries(view) {
  const filter = (view.filter || '').toLocaleLowerCase();
  return view.entries.map((entry,index)=>({entry,index})).filter(({entry})=>!filter||entry.name.toLocaleLowerCase().includes(filter));
}
function mountSshDirectoryTools(tb) {
  const panel = tb.sshFilesPanel, view = tb.sshFiles;
  const filter = document.createElement('input'); filter.type = 'search'; filter.dataset.remoteFilter = '';
  filter.placeholder = ms('筛选当前目录', 'Filter this folder'); filter.setAttribute('aria-label', filter.placeholder);
  panel.querySelector('.ssh-files-heading strong').after(filter);
  filter.oninput = () => { view.filter = filter.value; view.selection.clear(); view.selected = -1; renderSshFiles(tb, view.lastStatus || '', view.lastError || false); };
  const addNav = (attr, text, destination) => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute(attr,''); button.textContent = text;
    button.onclick = () => loadSshFiles(tb, destination()); panel.querySelector('[data-path]').before(button);
  };
  addNav('data-root', ms('根目录', 'Root'), () => '/');
  addNav('data-home', ms('主目录', 'Home'), () => view.home || '.');
  const headings = document.createElement('div'); headings.className = 'ssh-files-columns';
  headings.innerHTML = `<span></span><span>${esc(ms('名称', 'Name'))}</span><span>${esc(ms('大小', 'Size'))}</span><span>${esc(ms('修改日期', 'Modified'))}</span>`;
  panel.querySelector('.ssh-files-list').before(headings);
  const copy = document.createElement('button'); copy.type = 'button'; copy.dataset.remoteCopy = ''; copy.textContent = ms('复制路径', 'Copy path');
  copy.onclick = async () => {
    const selected = view.entries.filter((_,i)=>view.selection.has(i));
    const value = selected.length ? selected.map(entry=>remoteChild(view.path,entry.name)).join('\r\n') : view.path;
    try { await navigator.clipboard.writeText(value); toast(ms('已复制远程路径', 'Remote path copied')); } catch { toast(ms('无法写入剪贴板', 'Unable to write to clipboard'), true); }
  };
  panel.querySelector('.ssh-files-actions').append(copy);
  panel.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key.toLowerCase()==='l') { event.preventDefault(); panel.querySelector('[data-path]').focus(); panel.querySelector('[data-path]').select(); }
    if (event.key==='F5') { event.preventDefault(); if(!view.busy) void loadSshFiles(tb,view.path); }
  });
}

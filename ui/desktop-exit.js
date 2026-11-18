'use strict';

let desktopExitPending = false;

async function prepareDesktopChats(stillClosing) {
  const manualWrites = new Set();
  while (stillClosing()) {
    const sessions = [...aiSessions.values()];
    const executing = sessions.find(session => session.running);
    if (executing) {
      toast(chatText('文件操作完成后可退出：', 'A file operation is still running in ') + executing.root, true);
      return false;
    }
    // A manual write can finish while another folder is waiting for a decision.
    for (const session of sessions) {
      if (session.archive?.saving || session.archive?.failedWrite) manualWrites.add(session);
    }
    const dirty = sessions.find(session => aiArchiveNeedsFlush(session, manualWrites.has(session)));
    if (dirty) {
      if (!await flushAiArchiveForExit(dirty, manualWrites.has(dirty), stillClosing)) return false;
      continue;
    }
    // Resolve every known conflict before cancelling replies. Keep in one folder
    // should leave a reply in a different folder running whenever possible.
    const live = sessions.filter(aiHasWorkToStop);
    if (!live.length) return true;
    for (const session of live) {
      if (session.requestId) cancelAiRequest(session, false);
      if (session.messages.some(message => message.plan && message.planState === 'pending')) discardSessionPlans(session);
    }
    // Cancelling can append streamed text or change a plan status. Inspect the resulting snapshots again.
  }
  return false;
}

function showDesktopExitProgress() {
  const dialog = document.createElement('dialog');
  dialog.id = 'desktopExitProgress'; dialog.className = 'file-settings-dialog';
  dialog.setAttribute('aria-labelledby', 'desktopExitTitle');
  const header = document.createElement('header'); header.className = 'file-settings-head';
  const title = document.createElement('h2'); title.id = 'desktopExitTitle';
  title.textContent = chatText('正在保存对话', 'Saving conversations');
  const footer = document.createElement('footer'); footer.className = 'file-settings-footer';
  const cancel = document.createElement('button'); cancel.type = 'button';
  cancel.textContent = chatText('暂不退出', 'Stay in the app'); cancel.onclick = () => dialog.close();
  header.append(title); footer.append(cancel); dialog.append(header, footer);
  document.body.append(dialog); dialog.showModal();
  return dialog;
}

async function handleDesktopClose(event, mainWindow) {
  event.preventDefault();
  if (desktopExitPending || [...aiSessions.values()].some(session => session.archive?.leaving)) return;
  if (localPlanning || localQueueRunning) {
    toast(chatText('本地文件任务正在处理。可在任务面板停止后续项目，当前项目结束后再退出。', 'Local file tasks are active. Stop remaining items in the task panel and close after the current item finishes.'));
    openLocalTaskCenter();
    return;
  }
  desktopExitPending = true;
  let progress;
  try {
    if ([...aiSessions.values()].some(aiSessionNeedsExitWork)) {
      progress = showDesktopExitProgress();
      if (!await prepareDesktopChats(() => progress.open) || !progress.open) return;
    }
    persistWorkspaceSession();
    await mainWindow.destroy();
  } catch (error) {
    toast(chatText('无法退出：', 'Could not close the window: ') + String(error), true);
  } finally {
    if (progress?.open) progress.close();
    progress?.remove();
    for (const session of aiSessions.values()) clearAiArchiveDismissal(session);
    desktopExitPending = false;
  }
}

const desktopMainWindow = window.__TAURI__?.window?.getCurrentWindow();
if (desktopMainWindow) {
  desktopMainWindow.onCloseRequested(event => handleDesktopClose(event, desktopMainWindow))
    .catch(error => toast(chatText('无法监听窗口关闭：', 'Could not listen for window close: ') + String(error), true));
}

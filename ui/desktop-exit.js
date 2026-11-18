'use strict';

let desktopExitPending = false;
const desktopExitText = (zh, en) => locale === 'en' ? en : zh;

async function handleDesktopClose(event, mainWindow) {
  event.preventDefault();
  if (desktopExitPending) return;
  if (localPlanning || localQueueRunning) {
    toast(desktopExitText('本地文件任务正在处理。可在任务面板停止后续项目，当前项目结束后再退出。', 'Local file tasks are active. Stop remaining items in the task panel and close after the current item finishes.'));
    openLocalTaskCenter();
    return;
  }
  desktopExitPending = true;
  try {
    persistWorkspaceSession();
    await mainWindow.destroy();
  } catch (error) {
    toast(desktopExitText('无法退出：', 'Could not close the window: ') + String(error), true);
  } finally {
    desktopExitPending = false;
  }
}

const desktopMainWindow = window.__TAURI__?.window?.getCurrentWindow();
if (desktopMainWindow) {
  desktopMainWindow.onCloseRequested(event => handleDesktopClose(event, desktopMainWindow))
    .catch(error => toast(desktopExitText('无法监听窗口关闭：', 'Could not listen for window close: ') + String(error), true));
}

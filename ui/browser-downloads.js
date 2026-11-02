'use strict';
/* The WebView2 download panel belongs to a visible native browser view. */
let browserDownloadsBusy = false;

function canLeaveForBrowserDownloads(dialog) {
  const open = [...document.querySelectorAll('dialog[open]')];
  if (open.some((item) => item !== dialog)) {
    toast(browserText('请先关闭当前对话窗口，再打开下载管理。', 'Close the current dialog before opening downloads.'), true);
    return false;
  }
  return true;
}

async function openBrowserDownloads(dialog = null) {
  if (browserDownloadsBusy || !canLeaveForBrowserDownloads(dialog)) return false;
  const target = browserSettingsTarget();
  if (!target) {
    toast(browserText('请先打开一个可用的网页标签，再查看下载。', 'Open a working browser tab to view downloads.'), true);
    return false;
  }
  browserDownloadsBusy = true;
  const button = $('browserDownloads');
  if (button) button.disabled = true;
  try {
    dialog?.close(); closeMenu();
    if (curTab() !== target) switchTab(state.tabs.indexOf(target));
    // Native child views are hidden under HTML modals. Complete the visibility
    // update before opening a panel anchored to that view.
    await syncBrowserBounds();
    if (curTab() !== target || target.disposed || !target.browserReady) return false;
    await invoke('browser_downloads_show', { key: target.key });
    return true;
  } catch (error) {
    toast(String(error), true);
    return false;
  } finally {
    browserDownloadsBusy = false;
    if (button) button.disabled = false;
  }
}

function openBrowserDownloadFolder(dialog = null) {
  if (!canLeaveForBrowserDownloads(dialog)) return false;
  const path = browserSettings().downloadDirectory || (state.roots?.quick || []).find((item) => item.key === 'downloads')?.path;
  if (!path) { toast(browserText('无法找到系统下载目录，请在浏览器设置中指定目录。', 'Downloads folder unavailable. Set a folder in Browser settings.'), true); return false; }
  dialog?.close(); closeMenu(); newTab(path);
  return true;
}

$('browserDownloads').addEventListener('click', () => openBrowserDownloads());

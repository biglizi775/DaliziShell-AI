'use strict';
// Run before styles and asynchronous startup IPC, so a saved dark theme does
// not first paint a light workspace. Storage may be disabled or malformed.
try {
  document.documentElement.dataset.theme = JSON.parse(localStorage.getItem('df.theme')) === 'dark' ? 'dark' : 'light';
} catch { document.documentElement.dataset.theme = 'light'; }

function applyWorkspaceTheme(value) {
  const theme = value === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  // Match the native window and WebView backing surfaces during resize/restore.
  return window.__TAURI__.core.invoke('ui_set_theme', { theme }).catch(() => {});
}

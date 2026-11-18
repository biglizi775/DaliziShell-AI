'use strict';
// Run before styles and asynchronous startup IPC. Read the independent fields
// separately so a malformed theme cannot erase a saved visual style (or vice versa).
try {
  document.documentElement.dataset.theme = JSON.parse(localStorage.getItem('df.theme')) === 'dark' ? 'dark' : 'light';
} catch { document.documentElement.dataset.theme = 'light'; }
try {
  applyWorkspaceVisualStyle(JSON.parse(localStorage.getItem('df.visualStyle')), false);
} catch { applyWorkspaceVisualStyle('studio', false); }

function normalizeWorkspaceVisualStyle(value) {
  return value === 'classic' ? 'classic' : 'studio';
}

function applyWorkspaceVisualStyle(value, syncNative = true) {
  const visualStyle = normalizeWorkspaceVisualStyle(value);
  document.documentElement.dataset.visualStyle = visualStyle;
  if (syncNative) void applyWorkspaceTheme(document.documentElement.dataset.theme);
  return visualStyle;
}

function applyWorkspaceTheme(value) {
  const theme = value === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  // Match the native window and WebView backing surfaces during resize/restore.
  const visualStyle = normalizeWorkspaceVisualStyle(document.documentElement.dataset.visualStyle);
  return window.__TAURI__.core.invoke('ui_set_theme', { theme, visualStyle }).catch(() => {});
}

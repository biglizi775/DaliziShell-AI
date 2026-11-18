# 旧版 WebView2 的网页标签

将完整 ZIP 解压到新目录，运行 `DaliziFiles.exe`。网页标签现在检测当前 WebView2 的接口，而不是要求最新运行时。Windows 7 和 8.1 的 Edge 停在 109；本预览以 WebView2 109.0.1518.70 固定版本作为下限样本。

在 WebView2 109 上：

- 网页导航、后退、标签关闭、下载、页面设置、自动填充与密码保存开关照常使用。自动填充开关改用 109 已有的 `ICoreWebView2Settings4`，不再依赖较新的 Profile6。
- 链接新窗口、先 `window.open('')` 再跳转的登录弹窗、表单 POST 弹窗和 `window.close()` 都留在工作台标签内。109 将空地址的新窗口报告为 `about:blank#blocked`，程序按空白窗口处理。
- 扩展管理显示当前版本并隐藏加载入口。管理扩展需要 WebView2 118 或更新版本提供的 Profile7。
- “清除浏览数据 → 缓存的图片和文件”会直接提示更新 WebView2。109 完成这项清理需要一分钟以上，期间后续的 Cookie 清理也会排队等待。Cookie 与网站数据仍可单独清除。

### 在开发机复验

从 Microsoft 下载 x64 固定版本运行时 109.0.1518.70，解压后找到含 `msedgewebview2.exe` 的目录。用独立应用标识构建桌面，再让测试脚本指定该运行时。变量只影响当前 PowerShell 及其子进程。

```powershell
$env:TAURI_CONFIG = '{"identifier":"com.dalizi.files.webview-compat-test-x64"}'
cargo build --release --locked --manifest-path src-tauri/Cargo.toml --bin dalizi-files
Remove-Item Env:TAURI_CONFIG
$env:DALIZI_EXE = (Resolve-Path src-tauri\target\release\dalizi-files.exe).Path
$env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = '<解压目录>\109.0.1518.70'
$env:DALIZI_EXPECT_WEBVIEW2 = '109.0.1518.70'
node tools/search_drop_smoke.cjs --webview-runtime --without-extensions
cargo run --release --locked --manifest-path src-tauri/Cargo.toml --bin browser_smoke -- --without-extensions
```

去掉 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 与 `--without-extensions`，并把 `DALIZI_EXPECT_WEBVIEW2` 改为本机注册的版本，即可对照系统运行时。[实测记录](verification/browser-runtime-windows11.json) · [兼容矩阵](WINDOWS_COMPATIBILITY.md) · [WebView2 固定版本](https://developer.microsoft.com/microsoft-edge/webview2/#download)

两种运行时都在 Windows 11 x64 开发机上验证。真实 Windows 7、8.1 或冻结运行时的早期 Windows 10 仍需整机验收；本程序的 Rust 目标和随包 Node 对这些系统另有要求。

# 开发指南

## 环境与首次运行

原生后端面向 Windows x64。安装 Git、Rust MSVC 工具链、Visual Studio C++ 生成工具及 Windows SDK、WebView2 Runtime。Node.js 22+ 用于测试（CI 使用 24），Python 仅用于可选样本和工具。

应用前端没有 npm 构建步骤。Tauri 直接嵌入 `ui/`，技能正文由 Rust 的 `include_str!` 从 `resources/` 引入，因此应保留完整仓库目录，不能只复制 `src-tauri/` 构建。

```powershell
npm ci
Push-Location src-tauri
cargo run --locked --bin dalizi-files
Pop-Location
```

请在 `src-tauri/` 内执行 Cargo，确保使用相同的项目级配置。默认通过 crates.io 获取依赖；网络需要镜像时，可复制 `src-tauri/.cargo/config.example.toml` 为同目录 `config.toml`。该本机文件被忽略，不会强制其他开发者或 CI 使用镜像。不要将认证令牌写入示例配置。

## 目录与模块

| 路径 | 职责 |
| --- | --- |
| `src-tauri/src/main.rs` | Tauri 入口、Win32 文件枚举与 Shell 操作、命令注册 |
| `src-tauri/src/tray.rs` | 原生托盘图标、最小化收起、窗口恢复与退出入口 |
| `src-tauri/src/ai_compaction.rs`、`agent_memory_maintenance.rs` | 无工具的聊天摘要请求、目录记忆统计/备份/精确去重 |
| `src-tauri/src/index.rs`、`search.rs` | 文件名/目录大小索引与查询 |
| `src-tauri/src/preview.rs`、`preview_sheets.rs` | 有界只读文档解析 |
| `src-tauri/src/term.rs`、`ssh.rs` | ConPTY 生命周期、OpenSSH 与系统信息 |
| `src-tauri/src/ssh_managed.rs`、`ssh_credentials.rs`、`ssh_files.rs` | 内置 SSH、Windows 凭据、Linux/Windows 资源查询与 SFTP |
| `src-tauri/src/browser*.rs` | WebView2 标签、偏好、扩展和下载 |
| `src-tauri/src/ai.rs`、`ai_protocol.rs`、`agent_profile.rs`、`agent_builtin_skills.rs` | 模型请求、权限、技能与目录记忆 |
| `src-tauri/src/bin/` | 显式运行的原生诊断程序，不是应用入口 |
| `src-tauri/capabilities/` | Tauri ACL 配置；新增命令/事件需核对权限 |
| `ui/app.js`、`workspace*.js`、`columns.js` | 主界面、工作区、设置、列与属性 |
| `ui/places.js`、`ai-memory.js` | 收藏、统一会话快照、自动摘要与统计界面 |
| `ui/ai.js`、`agent-*.js` | 对话、布局、技能与记忆管理 |
| `ui/browser*.js`、`ssh*.js`、`document-preview.js` | 浏览器、SSH 与文档界面 |
| `ui/vendor/` | 运行必需的离线库、字体与解码资源，须提交 |
| `resources/builtin-skills/` | 9 项内置技能的 SKILL.md 正文 |
| `tests/` | Node 内置测试运行器，模拟 IPC 验证交互与状态 |
| `tools/` | 检查、样本生成、UI 集成验证、图标与源码打包 |
| `docs/` | 使用手册、开发指南、发布指南及后续规划 |

`src-tauri/target/`、`src-tauri/gen/`、`node_modules/`、`tools/vendor-cache/`、`dist/` 为本地产物。目录记忆 `.dalizi/` 与本机 Cargo 配置也被忽略。提交应用的 `Cargo.lock` 和测试工具的 `package-lock.json`，以便通过 `--locked` / `npm ci` 复现依赖。

## 常规验证

```powershell
npm run check
npm test
Push-Location src-tauri
cargo test --locked --bin dalizi-files
Pop-Location
```

`check` 校验自有 JavaScript 语法、本地文档链接、页面静态资源和仓库忽略规则。它不证明不存在所有敏感信息。Rust 测试使用独立临时目录；默认不运行需要 OpenSSH 环境的回环测试。不要以通用 `cargo test` 代替主程序目标，因为 `src/bin/` 中还有独立诊断程序。

UI 检查使用真实前端、xterm 和 PDF.js，Tauri IPC 使用模拟实现：

```powershell
npx playwright install chromium
npm run test:ui
# 可选专项
node tools/ui_smoke.cjs --ssh-recovery
node tools/ui_smoke.cjs --builtin-skills
node tools/ui_smoke.cjs --browser-startup
node tools/ui_smoke.cjs --copy-paths
node tools/ui_smoke.cjs --ai-api
node tools/ui_smoke.cjs --workbench
```

也可用 `DALIZI_BROWSER` 指定现有 Chromium 可执行文件；不需要配置 Codex 或个人机器的绝对路径。截图保存在 `src-tauri/target/ui-smoke/`。模拟 IPC 通过不等同于真实 Windows API、远程服务器或所有 WebView2 版本通过。

## 文档预览真实文件验证

可选工具依赖记录在 [requirements-dev.txt](../tools/requirements-dev.txt)，建议安装到虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r tools/requirements-dev.txt
.\.venv\Scripts\python.exe tools/preview_fixtures.py
Push-Location src-tauri
$previewFiles = (Get-ChildItem -LiteralPath target/preview-smoke -File | Where-Object { $_.Extension -notin '.json', '.png' }).FullName
cargo run --locked --bin preview_smoke -- $previewFiles | Set-Content -LiteralPath target/preview-smoke/results.json -Encoding utf8
Pop-Location
npm run test:preview
```

该流程读取真实 Rust 解析输出，检查 PDF 密码重试/翻页、Word 非默认正文路径、Excel 稀疏坐标、表切换与分页、中文 CSV、UTF-16 TSV、纯文本单元格显示。文件与截图均写入忽略的 `src-tauri/target/preview-smoke/`。

可选 XLSB 样本来自 [Calamine tests/date.xlsb](https://github.com/tafia/calamine/blob/master/tests/date.xlsb)，放入同目录后参与解析及显示检查；不随本项目分发。使用私人文件诊断时不要提交生成的 `results.json` 或截图。云盘已缓存/未下载文件仍需在目标机器上单独验收。

## 可选原生检查

0.4.0 工作台检查：构建 release 后运行 `node tools/ai_api_smoke.cjs --workbench`。除原有协议测试外，使用本机 HTTP 样本验证三种 API 的自动摘要、后续上下文复用及权限隔离；在生成的独立工作目录验证长期记忆去重、完整备份、启用状态、收藏与混合标签恢复。纯前端分支 `node tools/ui_smoke.cjs --workbench` 覆盖收藏编辑/转义、栏显示切换、自动/手动恢复、摘要失败回退及 960×560 深色布局。测试不使用云密钥或用户记忆文件。

AI 协议集成测试：构建 release 后，在项目根目录运行 `node tools/ai_api_smoke.cjs`。工具启动真实 EXE、独立 WebView2 配置和仅监听回环地址的 HTTP 样本服务，验证三种 API 的测试与实际对话、认证头、历史、错误响应、配置恢复和密钥不落盘。工作目录为生成的临时样本，不使用云服务密钥、不调用外部模型。可用 `DALIZI_EXE` 指定已构建程序，截图与测试配置位于忽略的 `src-tauri/target/ai-api-smoke-*`。这不替代具体云服务、真实密钥及所选模型参数的在线验收。

以下命令均在 `src-tauri/` 执行：

```powershell
# 两个真实 PowerShell：握手、输入、调整尺寸、退出；不加载用户配置
cargo run --locked --bin term_smoke
# 独立 WebView2 配置、隐藏窗口、本机 HTTP 样本与临时扩展
cargo run --locked --bin browser_smoke
# 独立空白窗口与托盘：需交互桌面，不加载应用设置或启动索引
cargo run --locked --bin tray_smoke
# 真实 OpenSSH 回环认证、中断与重连；需要 OpenSSH、Git Bash、Python/Paramiko
cargo test --locked --bin dalizi-files real_openssh_conpty_loopback_auth_info_resize_and_exit -- --ignored --nocapture
```

SSH 用例通过 `tools/ssh_fixture.py` 启动仅监听回环地址的测试服务，使用生成的密钥与独立 known_hosts，不连接真实远程主机。确保测试所用的 `python` 能导入 Paramiko；使用虚拟环境时先激活环境。`ptytest` 是历史底层 PTY 诊断工具，可能加载 PowerShell 用户配置，不作为默认回归入口。

托盘检查验证 Windows 通知区图标位置、原生最小化/隐藏/恢复、最大化状态、窗口句柄保留、图标缺失时的回退及退出事件。它直接调用菜单使用的窗口操作函数；正式发布前还应在目标桌面单击/右键托盘图标，检查三个菜单项及退出后的图标、会话清理。图标可能位于 Windows 隐藏图标区。

### 内置 SSH/SFTP 集成回归

安装上述 Python 工具依赖与 `npm ci` 后，在项目根目录执行：

```powershell
Push-Location src-tauri
cargo build --locked --bin dalizi-files
Pop-Location
npm run test:ssh
# 验证 release 时可设置：
# $env:DALIZI_EXE = (Resolve-Path src-tauri/target/release/dalizi-files.exe).Path
```

`tools/ssh_managed_smoke.cjs` 启动真实应用与仅监听 127.0.0.1 的 Paramiko 测试服务器。测试生成密码、OpenSSH 加密私钥、主机密钥、测试文件和独立 WebView2 配置；先确认随机端口没有既有信任，再允许结束时清理该测试身份的 Windows 凭据。测试不会连接用户服务器。可用 `DALIZI_PYTHON` 指定 Python 路径。生成的凭据、输出与截图仅位于忽略的 `src-tauri/target/ssh-managed-smoke-*`，不要发布它们。

覆盖首次主机确认/取消、错误密码不保存、成功后的凭据读取、私钥口令、指纹变化前拒绝认证、Ctrl+C/调整尺寸、同标签重新登录、旧会话失效、SFTP 大目录截断、中文与特殊字符文件名、上传/下载、同名保护、取消与临时文件清理。Linux/Windows 的远程资源响应使用固定样本验证协议分支；Windows CIM 脚本另在本机验证，不等同于真实远端 Linux/Windows OpenSSH 全环境验收。最小窗口与常规窗口分别输出截图。

图标生成：安装 Pillow 后运行 `python tools/gen_icon.py`。提交更新后的 `src-tauri/icons/icon.ico`，运行或构建不需要 Python。

## CI 与发布

[Windows CI](../.github/workflows/ci.yml) 在 push、PR 或手动触发时运行仓库检查、前端测试、UI 检查、Rust 测试与 release 编译；不自动发布，也不运行需要交互环境的原生集成程序。Actions 使用 GitHub 官方 [checkout](https://github.com/actions/checkout) 与 [setup-node](https://github.com/actions/setup-node)。

本地验证结果不能替代尚未在 GitHub 执行的 CI 结果。Windows 10/11、不同 WebView2 版本、文件权限与真实网络环境的发布验收见 [发布指南](RELEASING.md)。

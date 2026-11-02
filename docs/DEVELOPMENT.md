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
| `src-tauri/src/search_query.rs`、`ui/search-syntax.js` | 有界 Everything 语法解析、共享表达式与当前目录过滤 |
| `src-tauri/src/external_drop.rs`、`ui/external-drop.js` | WebView 拖入坐标与目标、确认界面、路径校验和 Shell 移动/复制 |
| `src-tauri/src/archive.rs`、`ui/archive.js` | Rust 7z/ZIP 创建、密码/文件名加密、任务状态/取消和压缩选项弹窗 |
| `src-tauri/src/preview.rs`、`preview_sheets.rs` | 有界只读文档解析 |
| `src-tauri/src/term.rs`、`ssh.rs` | ConPTY 生命周期、OpenSSH 与系统信息 |
| `src-tauri/src/ssh_managed.rs`、`ssh_credentials.rs`、`ssh_files.rs` | 内置 SSH、Windows 凭据、Linux/Windows 资源查询与 SFTP |
| `src-tauri/src/ssh_files_batch.rs`、`ui/ssh-transfer-queue.js` | 批量准备/文件名检查、按连接串行队列、状态补查、取消与复核重试、传输任务面板 |
| `src-tauri/src/browser*.rs` | WebView2 标签、偏好、扩展和下载 |
| `src-tauri/src/ai.rs`、`ai_protocol.rs`、`agent_profile.rs`、`agent_builtin_skills.rs` | 模型请求、权限、技能与目录记忆 |
| `src-tauri/src/bin/` | 显式运行的原生诊断程序，不是应用入口 |
| `src-tauri/capabilities/` | Tauri ACL 配置；新增命令/事件需核对权限 |
| `ui/app.js`、`workspace*.js`、`columns.js` | 主界面、工作区、设置、列与属性 |
| `ui/places.js`、`ai-memory.js` | 收藏、统一会话快照、自动摘要与统计界面 |
| `ui/ai-conversations.js`、`src-tauri/src/agent_conversations.rs` | 目录级对话档案、串行/CAS 保存、历史恢复、原生 Markdown 导出 |
| `ui/tab-management.js` | 指针拖动/键盘排序、内存中的最近关闭标签及隐私清理 |
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

界面稳定性：`node tools/ui_smoke.cjs --render-stability` 检查重复刷新时行/表头节点保留、虚拟滚动复用、缩放期间重命名文本/焦点/光标、迟到刷新保持最新选择/滚动、编辑期间目录事件延迟应用、重命名所属目录校验、PDF 双缓冲以及重复浏览器 IPC 合并。它作为独立 UI 回归加入 CI。

构建 release 后运行 `npm run test:stability`，以真实 EXE、独立主 WebView2 配置和 300 个自建文件检查文件界面、PDF、真实目录通知，以及三轮 Win32 最小化与恢复后主界面身份保持不变。`tools/window_fixture.ps1` 只调整 PID 与绝对 EXE 路径均匹配的测试窗口；不会操控其他已运行实例。截图和结果保留在 `src-tauri/target/render-stability-*`。浏览器原生检查另运行下方的 `browser_smoke`：使用独立应用身份与回环网站，验证创建后隐藏、原生位置与尺寸、隐藏页视口不变、12 轮显示切换及页面状态保留，再执行设置、扩展和下载回归。不要在该程序设置全局 `WEBVIEW2_USER_DATA_FOLDER`，它会强制主界面与网页共享目录，造成 WebView2 环境选项冲突。这些检查不等同于所有显卡驱动、远程桌面、多屏 DPI 或 Win10/Win11 组合均无闪烁。

文件刷新将目录数据比较与局部渲染分开，复用虚拟列表节点并保护编辑器。浏览器同步使用单个串行任务和已应用状态，隐藏页不调整尺寸；原生端以一次 `set_bounds` 更新位置与大小。窗口底色与 CSS 主题一致，避免窗口背景与页面色块不一致；WebView2 背景闪白的机制参见 [Microsoft 说明](https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/BackgroundColor.md)。PDF 同时最多保留当前页与一个待绘制页，每个画布仍受 400 万像素上限约束。

对于没有明显触发规律的闪烁，可运行 `npm run test:stability -- --soak`。该模式在独立样本中先静置 20 秒，再用约 40 秒持续改写一个非选中文件；逐帧记录主界面/列表隐藏、PDF 缺失、行/表头/画布替换、底色变化和整页重绘次数。结果写入同一测试目录的 `results.json`，不将诊断逻辑加入发行版、不收集用户文件内容。可通过 `DALIZI_EXE` 指定要核验的已打包程序。该检查只观察 DOM 与布局，不能检测 WebView 外部的窗口合成或显卡驱动闪帧，短时间通过也不代表已排除全部偶发问题。

压缩检查：`node tools/ui_smoke.cjs --archive` 验证菜单、密码确认、格式/文件名联动、进度、取消失败重试和窄窗口深色布局。构建 release 后运行 `npm run test:archive`，使用真实应用创建 7z/ZIP，再调用独立 7-Zip 检查正确/错误密码、文件名加密、解压后哈希、空目录、中文路径、同名不覆盖、源目录内输出拒绝和压缩中途取消。验证工具需要测试机安装 7-Zip，或设置 `DALIZI_7ZIP` 指向程序；应用运行本身不依赖它。样本和截图保留在 `src-tauri/target/archive-smoke-*`。

压缩始终在后台线程中流式处理。路径枚举拒绝重解析点并有数量/深度上限，源文件以只共享读取的句柄打开；输出先写同目录的独占临时文件，完成并刷新后使用不覆盖的原子移动发布。取消检查覆盖枚举、读取和写入，最终发布与取消请求串行。7z 每个文件流和文件头使用独立的随机 salt/IV，KDF 轮次参数为 19；字典大小限为 1/8/16 MiB。密码请求在释放时清理，不保存在任务进度中。`sevenz-rust2 0.24.2` 需要 Rust 1.93+。

搜索与拖入检查：构建 release 后运行 `npm run test:search-drop`。启动真实 EXE 和独立 WebView2 配置，在 `src-tauri/target/search-drop-smoke-*` 生成专用样本，验证 Rust 索引与前端筛选语义一致、隐藏目标在新标签选中、150% 缩放坐标、真实 Shell 移动/复制、取消入口、同名不覆盖和自身/子目录拦截。测试模拟 WebView 的拖入事件负载，不替代从 Windows 资源管理器实际鼠标拖入的人工验收；网络共享、跨卷与大批量取消也需在目标环境验收。可用 `DALIZI_EXE` 指定程序，运行后保留样本和截图供检查。

搜索解析位于 Rust：本地高级过滤调用 `search_parse` 得到表达式，索引查询直接使用同一解析器；普通名称分词有无 IPC 快速路径。日期使用本机时区，索引与 UI 时间均为毫秒。索引事件合并刷新，结果 DOM 按路径复用；新输入未返回时禁止激活过期条件的结果。外部拖入通过主 WebView 监听，物理坐标按 `devicePixelRatio` 转为 CSS 坐标；Rust 在执行前重新校验绝对路径和祖先关系，再交给后台 STA 的 `IFileOperation`。该功能不启用远程网页的文件操作权限。

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

SFTP 队列专项：`npm run test:transfers` 运行真实 Chromium + 模拟 Tauri 的多选/批次确认、漏事件补查、失败项重试、暂停/取消、断线核对及小窗口深色布局检查。`npm run test:ssh` 已接入 `tools/ssh_transfer_queue_native.cjs`，在生成的回环 SSH/SFTP 服务上验证实际批量上传/下载、文件内容比对、不覆盖、重试仅失败项、丢失事件后查询恢复、重复传输标识拒绝和取消清理。文件/目录系统选择框由模拟测试返回路径，原生测试传入生成目录，不自动点击系统选择框。Rust 状态缓存最多 256 条，保留运行中的任务；前端任务最多 50 批、每批展开最多 2000 项，均不落盘、不含凭据配置。队列支持同次运行内、经过前缀内容校验的字节续传，不自动重新登录或恢复任务。

对话与标签专项验证：`npm run test:productivity` 使用模拟 Tauri 的真实 Chromium 界面，检查手动/自动保存、摘要恢复、旧计划不可执行、删除/另存、导出调用、标签拖动/键盘/误关恢复、网页隐私和 960×560 深色布局。构建 release 后执行 `node tools/productivity_native_smoke.cjs`，以独立 EXE/WebView2 配置和生成目录验证实际 JSON、重启、复制工作目录后在全新配置中恢复，不调用云模型。原生系统保存对话框不由该脚本自动点击，需人工验收导出路径和取消。产物保存在忽略的 `src-tauri/target/productivity-native-*`。Rust 测试覆盖格式/容量、只读/文件占用、损坏保留、删除版本与旧写入拒绝。

[Windows CI](../.github/workflows/ci.yml) 在 push、PR 或手动触发时运行仓库检查、前端测试、UI 检查、Rust 测试与 release 编译；不自动发布，也不运行需要交互环境的原生集成程序。Actions 使用 GitHub 官方 [checkout](https://github.com/actions/checkout) 与 [setup-node](https://github.com/actions/setup-node)。

便携配置原生验证：构建 release 后运行 `npm run test:portable`（可通过 `DALIZI_EXE` 指定程序）。测试把 EXE 复制到两个隔离目录，以全新的 WebView2 配置模拟换电脑，检查真实 JSON 写入、启动加载、网页收藏/历史、密钥与本机路径排除、清空历史后的再次启动以及关闭便携配置。仅使用 `.test` 域名作为收藏数据，不访问这些网站。样本保留于忽略的 `src-tauri/target/portable-smoke-*`。Rust 测试另覆盖文件损坏、格式版本、原子替换失败、上一版本备份与并发修改冲突；这仍不能替代两台实际机器的跨系统验收。

本地验证结果不能替代尚未在 GitHub 执行的 CI 结果。Windows 10/11、不同 WebView2 版本、文件权限与真实网络环境的发布验收见 [发布指南](RELEASING.md)。


0.5.0 新增 `ui/dual-pane.js` 和 `src-tauri/src/ssh_files_tree.rs` / `ssh_files_resume.rs`。`npm run test:panes` 覆盖独立目录/选择、跨面板目标、AI 工作目录切换、虚拟列表和迟到请求；`tools/ssh_tree_resume_native.cjs` 由 `test:ssh` 驱动，验证真实 EXE 的递归目录、空目录、上传/下载续传以及临时内容损坏拒绝。续传记录最多 128 个，不落盘；绑定后端已验证的 host/account/key 身份，内容比较读取完整前缀。环境已有 Edge 时可设置 `DALIZI_BROWSER` 为 Edge 可执行文件，运行 UI 测试而无需再下载 Chromium。

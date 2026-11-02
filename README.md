# 呆梨文件 / Dalizi Files

面向 Windows 的文件资源管理器与智能体工作台，基于 **Rust + Tauri 2 + 原生 HTML/CSS/JavaScript**。在同一窗口中浏览文件、阅读文档、使用 PowerShell/SSH、打开网页，并围绕当前目录与 AI 协作。

当前版本为 **0.5.0**，目标平台是 Windows 10 / 11 x64。已实现功能与后续规划分别列出，不将规划能力作为现有功能宣传。

[使用手册](docs/USER_GUIDE.md) · [开发指南](docs/DEVELOPMENT.md) · [开发规划](docs/AGENT_WORKBENCH_DEVELOPMENT.md) · [发布指南](docs/RELEASING.md) · [更新记录](docs/CHANGELOG.md)

[GitHub 仓库](https://github.com/biglizi775/DaliziShell-AI) · [下载 Windows 版本](https://github.com/biglizi775/DaliziShell-AI/releases)

## 主要功能

| 模块 | 已实现能力 |
| --- | --- |
| 文件工作区 | 多标签、独立双面板、跨面板复制/移动、列表/网格、可拖动列与列宽、右键属性、复制完整路径、外部文件拖入移动/复制、重命名/回收站、目录监听 |
| 文件压缩 | 右键压缩选项、7z/ZIP、四档级别、AES-256 密码、7z 文件名加密、进度与取消，无需另装 7-Zip |
| 搜索与大小索引 | 三种范围、Everything 常用语法、应用内新标签定位、文件名与大小缓存，刷新时保留结果和选择 |
| 文档预览 | 图片与文本、PDF 翻页/缩放/密码、Word 正文、Excel/CSV/TSV 工作表切换与分页 |
| 本地与远程终端 | PowerShell 多标签；内置 SSH 与 OpenSSH 兼容模式、主机指纹核对、成功登录后记住凭据、中断与重新登录 |
| 远程资源与文件 | Linux / Windows 系统信息、内存与系统盘容量；SFTP 多选、批量上传/下载、集中传输任务、暂停后续文件、取消与失败项重试、递归目录、校验后的断点续传 |
| 浏览器标签 | WebView2 网页、路径与 URL 历史、下载入口、浏览器设置、解压扩展管理 |
| AI 对话 | 独立右侧面板、三种 API 格式、连接测试、自定义模型接口、推理强度、三种权限；目录级保存/恢复、可选自动保存、Markdown 导出 |
| 技能与记忆 | 9 项内置文本技能、自定义 SKILL.md 导入、当前目录的本地记忆与确认保存的学习建议 |
| 系统托盘 | 最小化后驻留通知区域、单击恢复窗口、右键显示/收起/退出；保留当前标签与会话 |
| 收藏与恢复 | 文件夹/网址收藏夹栏、编辑与排序；自动或手动恢复上次最多 50 个文件夹和网页标签，后台网页按需加载 |
| 标签管理 | 拖动/右键/键盘排序、恢复本次运行最近关闭的文件夹与网页，排序保留当前终端与网页会话 |
| 记忆整理 | 聊天上下文统计与自动摘要、目录记忆统计与无损去重、整理前完整备份 |

目录枚举使用 Win32，文件列表使用虚拟化渲染。前端资源随程序打包，日常运行无需 Node.js、Python 或在线 CDN。

## 快速启动

无需开发环境：前往 [Releases](https://github.com/biglizi775/DaliziShell-AI/releases)，下载 `dalizi-files-0.5.0-windows-x64.zip`，解压后运行 `DaliziFiles.exe`。压缩包包含许可证和使用说明；发行版尚未签名。

运行环境：Windows 10 1809+ / Windows 11 x64、Microsoft Edge WebView2 Runtime。PowerShell 使用系统安装；内置 SSH 无需另装客户端，OpenSSH 兼容模式需要 Windows OpenSSH Client。不同 Windows/WebView2 版本仍需分别验证。

从源码构建需要 Rust MSVC 工具链和 Visual Studio C++ 生成工具。在项目根目录打开 PowerShell：

```powershell
git clone https://github.com/biglizi775/DaliziShell-AI.git
cd DaliziShell-AI
cd src-tauri
cargo run --locked --bin dalizi-files
# 或编译发布版本
cargo build --locked --release --bin dalizi-files
```

可执行文件生成在 `src-tauri/target/release/dalizi-files.exe`。前端无需额外打包。修改后请退出旧程序再启动新版本；Windows 可能阻止替换正在运行的同名程序。

开发检查：

```powershell
npm ci
npm run check
npm test
```

Node 依赖仅用于测试。UI 与文档预览集成检查、可选 Cargo 镜像和 Python 工具见 [开发指南](docs/DEVELOPMENT.md)。

## 需要了解的边界

- **预览**：Word/表格以正文和单元格值为主，不还原完整 Office 排版。旧 `.doc/.xls/.ods` 需转换格式。PDF/表格最多 32 MiB、Word 最多 16 MiB；大表格分段显示并提示截断。
- **AI**：以当前标签目录为工作范围；当前文件动作是新建目录、复制文件、移动和重命名。技能是工作流说明，不会自动获得运行代码、操控电脑或浏览网页的能力。模型请求发送目录元数据、对话及启用的技能/记忆，默认不读取文件正文。
- **对话档案**：点击 Agent 中的“保存 / 对话历史”，可手动保存或开启本次会话自动保存；明文记录位于当前目录 `.dalizi/chat-history.json`，每目录最多 30 条、每条最近 60 条消息及摘要。恢复在新标签中加载文字，权限重置为逐次确认，旧操作不会重放；API 配置密钥不写入档案。移动项目时可连同 `.dalizi` 一起复制。
- **记忆与迁移**：记忆显式保存到当前目录的 `.dalizi/agent-memory.json`。在“设置 → 配置与迁移”开启便携配置后，通用偏好、AI 接口参数、网页收藏与历史自动保存在 EXE 同级的 `DaliziData/preferences.json`，复制软件文件夹即可加载。文件夹路径、技能、索引、浏览器登录与凭据仍由本机管理，尚非完整数据便携。API Key 仅保留在当前会话内存中。
- **浏览器**：采用 WebView2，不等同于完整 Chrome；支持的扩展 API 取决于运行时，暂不支持商店一键安装或 Chrome 账户同步。
- **搜索**：基于普通权限的枚举与本地索引，首次建库需要时间；尚未实现 MFT/USN 服务。
  - 当前目录、含子目录、全部位置均支持 `*.pdf|*.docx !草稿`、`ext:xlsx;csv size:>10mb`、`dm:7days`、`path:"D:\资料"` 等常用条件；输入框旁“?”可查看示例。支持 Everything 常用语法子集，暂不支持 `regex:`、`content:` 等扩展函数。结果的文件夹按钮在应用内新建标签并选中目标。
  - 外部文件可拖到文件列表空白处或文件夹行，松开后选择移动或复制；同名项目自动重命名，避免覆盖。仅接收真实文件系统路径，网页图片、邮件附件等虚拟拖入暂不支持。
- **压缩**：选中项目 → 右键“压缩…”，或工具栏更多菜单 →“压缩所选项目…”。支持新建 7z/ZIP；密码仅用于当前任务。7z 可隐藏文件名，ZIP 加密后文件名仍可见，且 AES 加密 ZIP 需要兼容工具打开。暂不支持解压、更新已有压缩包、分卷或自解压包；同名输出不会覆盖。

新建 SSH 连接默认使用内置模式；已有连接保留原模式。密码仅在登录成功且勾选记住后存入当前 Windows 用户的凭据管理器，不写入连接列表。SFTP 需要服务器启用子系统，支持批量与递归传输、同次运行内的断线续传，不覆盖同名文件。详见 [SSH 使用说明](docs/USER_GUIDE.md#ssh-连接)。

## 项目结构

```text
.github/              GitHub CI、Issue 与 PR 模板
ui/                   原生前端，vendor/ 为离线第三方资源
src-tauri/            Rust 后端、Tauri 配置、图标和锁定依赖
resources/            随程序内置的技能正文
tests/               前端单元与行为回归测试
tools/               开发检查、样本生成、集成测试和打包工具
docs/                使用、开发、发布与后续规划文档
```

`src-tauri/target/`、`dist/`、下载缓存、用户记忆和本机配置均不进入版本控制。`Cargo.lock`、`package-lock.json` 及运行必需的 `ui/vendor/` 资源应提交。完整说明见 [目录与模块](docs/DEVELOPMENT.md#目录与模块)。

## 参与与许可

欢迎提交可复现的问题和围绕具体场景的改进建议；请先阅读 [贡献指南](CONTRIBUTING.md)。电脑/浏览器 Agent、终端与任务恢复、批量远程传输和完整便携模式等方向见 [开发规划](docs/AGENT_WORKBENCH_DEVELOPMENT.md)。

项目代码使用 [MIT License](LICENSE)。随仓库分发的第三方组件保留各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

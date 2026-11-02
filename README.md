# 呆梨文件 / Dalizi Files

面向 Windows 的文件资源管理器与智能体工作台，基于 **Rust + Tauri 2 + 原生 HTML/CSS/JavaScript**。在同一窗口中浏览文件、阅读文档、使用 PowerShell/SSH、打开网页，并围绕当前目录与 AI 协作。

当前版本为 **0.4.0 开发版**，目标平台是 Windows 10 / 11 x64。已实现功能与后续规划分别列出，不将规划能力作为现有功能宣传。

[使用手册](docs/USER_GUIDE.md) · [开发指南](docs/DEVELOPMENT.md) · [开发规划](docs/AGENT_WORKBENCH_DEVELOPMENT.md) · [发布指南](docs/RELEASING.md) · [更新记录](docs/CHANGELOG.md)

[GitHub 仓库](https://github.com/biglizi775/DaliziShell-AI) · [下载 Windows 版本](https://github.com/biglizi775/DaliziShell-AI/releases)

## 主要功能

| 模块 | 已实现能力 |
| --- | --- |
| 文件工作区 | 多标签、列表/网格、可拖动列与列宽、右键属性、复制完整路径、复制/移动/重命名/回收站、目录监听 |
| 搜索与大小索引 | 当前目录/子目录/全部位置搜索，文件名与文件夹大小缓存，后台校验与增量更新 |
| 文档预览 | 图片与文本、PDF 翻页/缩放/密码、Word 正文、Excel/CSV/TSV 工作表切换与分页 |
| 本地与远程终端 | PowerShell 多标签；内置 SSH 与 OpenSSH 兼容模式、主机指纹核对、成功登录后记住凭据、中断与重新登录 |
| 远程资源与文件 | Linux / Windows 系统信息、内存与系统盘容量；SFTP 目录浏览、单文件上传/下载、进度、速度与取消 |
| 浏览器标签 | WebView2 网页、路径与 URL 历史、下载入口、浏览器设置、解压扩展管理 |
| AI 对话 | 独立右侧面板、三种 API 格式、连接测试、自定义模型接口、推理强度设置、三种文件操作权限 |
| 技能与记忆 | 9 项内置文本技能、自定义 SKILL.md 导入、当前目录的本地记忆与确认保存的学习建议 |
| 系统托盘 | 最小化后驻留通知区域、单击恢复窗口、右键显示/收起/退出；保留当前标签与会话 |
| 收藏与恢复 | 文件夹/网址收藏夹栏、编辑与排序；自动或手动恢复上次最多 50 个文件夹和网页标签，后台网页按需加载 |
| 记忆整理 | 聊天上下文统计与自动摘要、目录记忆统计与无损去重、整理前完整备份 |

目录枚举使用 Win32，文件列表使用虚拟化渲染。前端资源随程序打包，日常运行无需 Node.js、Python 或在线 CDN。

## 快速启动

无需开发环境：前往 [Releases](https://github.com/biglizi775/DaliziShell-AI/releases)，下载 `dalizi-files-0.4.0-windows-x64.zip`，解压后运行 `DaliziFiles.exe`。压缩包包含许可证和使用说明；开发预览版尚未签名。

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
- **记忆**：显式保存到当前目录的 `.dalizi/agent-memory.json`。API Key 仅保留在当前应用会话内存中；浏览器配置、索引和通用设置仍使用本机应用数据目录，尚非完整便携模式。
- **浏览器**：采用 WebView2，不等同于完整 Chrome；支持的扩展 API 取决于运行时，暂不支持商店一键安装或 Chrome 账户同步。
- **搜索**：基于普通权限的枚举与本地索引，首次建库需要时间；尚未实现 MFT/USN 服务。

新建 SSH 连接默认使用内置模式；已有连接保留原模式。密码仅在登录成功且勾选记住后存入当前 Windows 用户的凭据管理器，不写入连接列表。SFTP 需要服务器启用子系统，当前支持单文件传输且不覆盖同名文件。详见 [SSH 使用说明](docs/USER_GUIDE.md#ssh-连接)。

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

# 文档导航

适用版本：**0.5.1 · 2026-11-03**。下载见 [最新版 Release](https://github.com/biglizi775/DaliziShell-AI/releases/latest)。

| 文档 | 内容 |
| --- | --- |
| [项目首页](../README.md) | 项目介绍、功能概览和快速启动 |
| [使用手册](USER_GUIDE.md) | 预览、搜索、AI、技能与记忆、终端、SSH、浏览器设置和快捷键 |
| [0.5.1 发布说明](RELEASE_0.5.1.md) | SSH 默认分屏、远程目录操作、终端异常恢复、标签滚动与升级方法 |
| [历史功能更新纪要](../README.md#历史功能更新纪要) | 从 0.2.0 到 0.5.1 的功能演进摘要与发行链接 |
| [完整更新记录](CHANGELOG.md) | 各版本详细变更、验证范围与当时的功能限制 |
| [开发指南](DEVELOPMENT.md) | 环境、目录结构、测试工具与可选原生验证 |
| [GitHub 发布指南](RELEASING.md) | 源码范围、首次推送、源码包和 Windows 发行版 |
| [索引缓存预览](PREVIEW_index-cache.md) · [源码重建实测](verification/index-cache-source-windows11.json) | Windows 短时占用缓存后的保存、预览包对应源码、从空构建目录核验的结果 |
| [固定项目预览](PREVIEW_pinned-auto.md) · [Windows 实测](verification/pinned-auto-windows11.json) | 切走后仍在原项目接收回答，创建文件和修改已有文档均须另行确认 |
| [工作区草稿与计划保留](PREVIEW_workspace-retention.md) · [Windows 实测](verification/workspace-retention-windows11.json) | 跨目录浏览后的草稿、临时对话、文件计划有效期和缓存回收 |
| [对话保存失败后的恢复](PREVIEW_archive-recovery.md) | 从其他标签关闭、重试或另存，处理版本冲突，保留原记录 |
| [退出程序前保存对话](PREVIEW_desktop-exit.md) | 正常退出时处理后台目录和固定项目的写入，保留已收到的部分回复 |
| [按目录查看任务记录](PREVIEW_history-scope.md) | 从全部记录切回单个项目，识别任务归属，重试暂时不可读的目录 |
| [旧版 WebView2 的网页标签](PREVIEW_browser-runtime.md) · [Windows 实测](verification/browser-runtime-windows11.json) | WebView2 109 与系统运行时的浏览、弹窗、设置、扩展与数据清理差异 |
| [智能体工作台开发方案](AGENT_WORKBENCH_DEVELOPMENT.md) | 已实现基线、后续增强、优先级与验收场景 |
| [呆梨与 DeepSeek Harness 集成开发文档](HARNESS_WORKBENCH_DEVELOPMENT.md) | 设计稿：工作区隔离、运行时协议、权限、分期实施与 Windows 验收 |
| [Harness M0 开发验证](HARNESS_M0.md) | 独立 Rust 客户端、固定版本的只读配置、离线回放与本机模型联调 |
| [Harness M1 桌面文件任务](HARNESS_M1.md) | 开发版试用步骤、文件快照、任务归属、异常恢复与原生验证 |
| [Harness M2 审阅写入](HARNESS_M2.md) | 单文件提案、差异审阅、权限撤销、冲突与历史迁移 |
| [Harness M3 网页引用](HARNESS_M3.md) | 选中网页正文、预览发送内容、明确任务所属项目与原生导航回归 |
| [Harness M4 远程目录只读任务](HARNESS_M4.md) | SFTP 选区、服务器身份、连接变化、断线前快照及双主机回归 |
| [Harness M5 Windows 候选包](HARNESS_M5.md) | 安装与停用、诊断预览、并排回退、组件构建及干净系统验收步骤 |
| [Windows 10/11 离线验收包](WINDOWS_GUEST_QA.md) | 在普通用户快照运行原版 EXE，无需 Node 或 Python；分开记录开发机演练与干净系统验收 |
| [用 VMware 验收 Windows 候选版](WINDOWS_TEST_GUESTS.md) | 准备 Windows 10/11 客机、挂载只读验收光盘、断网执行并取回每个版本的独立报告 |
| [M5 RC2 实测记录](verification/harness-m5-rc2-windows11.json) | 本地发行包摘要、跨版本聊天往返、组件实测及未通过干净系统验收的项目 |
| [M5 RC3 实测记录](verification/harness-m5-rc3-windows11.json) | 当前候选包、模型故障时的实际发送次数、任务归属及脱敏诊断 |
| [两台 OpenSSH 服务器实测](verification/harness-openssh-windows11.json) | 真实 Linux SFTP 属性、仅 SFTP 账户、同名路径隔离及断线后任务归属 |
| [贡献指南](../CONTRIBUTING.md) | 提交改动和报告问题 |
| [第三方组件](../THIRD_PARTY_NOTICES.md) | 随仓库分发的组件来源、许可和本地补丁 |

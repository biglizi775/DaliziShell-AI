# Windows 兼容性与验收范围

发行文件名包含桌面架构。相同的 Windows 产品名可能对应不同的系统构建、架构和 WebView2 版本。

| 环境 | 当前包的状态 |
| --- | --- |
| Windows 11 x64 | 在开发机上验证文件、索引、双面板、终端及其他已有回归用例。干净系统安装验收待做。 |
| Windows 10 x64，1809 至 22H2，含相应 LTSC | 全功能目标。需要可用的 WebView2。最低构建 17763 和较新构建需要分别实测。 |
| Windows 10 x64，1809 之前 | 新版终端在系统缺少 ConPTY 时使用随包 WinPTY。兼容后端已在本机验证，应用能否在对应 Windows 构建和 WebView2 上加载仍需实测。 |
| Windows 7、8、8.1 与更早的 Windows | 当前 Rust MSVC 桌面目标有更高的系统要求。覆盖这些系统需要单独的运行后端、构建和实际机器验收。 |
| 32 位 Windows 10 | x86 桌面预览随包提供 32 位 WinPTY。已在 Windows 11 x64 的 WOW64 下运行，真实 32 位系统待测。 |
| Windows on Arm | Windows 11 的 x64 模拟与 Windows 10／11 的 x86 模拟各自需要实机验证。 |
| Windows Server | 有桌面体验的 Server 2019 及以后版本可以进入候选矩阵。Server Core、缺少桌面环境或旧版 Server 需要分别处理。当前没有服务端实机签收记录。 |

内嵌终端会探测创建、调整和关闭伪控制台的三个系统入口。全部可用时使用系统 ConPTY，缺少任一入口时使用程序旁的 `terminal/winpty.dll` 与 `terminal/winpty-agent.exe`。PowerShell 的查找顺序是 Windows 提供的程序安装目录、PATH 中的 PowerShell 7、系统目录中的 Windows PowerShell，最后才查找 PATH 中的 Windows PowerShell。[Microsoft ConPTY 系统要求](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole) · [WinPTY 上游](https://github.com/rprichard/winpty) · [Windows on Arm 模拟支持](https://learn.microsoft.com/en-us/windows/arm/apps-on-arm-x86-emulation)

旧系统的评估还需分别覆盖 WebView2 和 Rust 标准库。微软对 WebView2 的系统支持随 Edge 演进。Windows 7 和 8.1 的 Edge 停在 109。网页标签已在开发机上用 WebView2 109 固定版本验证：浏览、弹窗、设置和 Cookie 清理可用，扩展管理与磁盘缓存清理会提示更新运行时。[旧版 WebView2 说明](PREVIEW_browser-runtime.md)[WebView2 支持平台](https://learn.microsoft.com/en-us/microsoft-edge/webview2/) · [Edge 生命周期](https://learn.microsoft.com/en-us/lifecycle/products/microsoft-edge) · [Rust Windows MSVC 目标](https://doc.rust-lang.org/rustc/platform-support/windows-msvc.html)

## 在目标机器上检查

解压 ZIP，在允许执行本地脚本的 Windows PowerShell 中运行 `.\Check-Windows.ps1`。加 `-Json` 可获取结构化结果。新版检查脚本从同目录 `DaliziFiles.exe` 读取 PE 架构，同时检查系统构建、操作系统架构、桌面安装类型和 WebView2 注册版本或指定的固定运行时目录。`wow64-needs-test` 表示当前 x64 Windows 将通过 WOW64 运行 x86 包。无需安装开发工具、写入注册表或联网。

`winptyPresent` 表示两份终端组件均存在且 PE 架构与桌面一致。`early-windows-with-winpty-needs-test` 表示早期 Windows 10 或相应桌面 Server 具备进入实测的条件。`prerequisites-detected` 表示检测到了常规前置条件。正式签收还要在目标系统上用同一发行 ZIP 打开桌面，执行文件、浏览器、终端和 SSH 工作流并验证重启恢复。

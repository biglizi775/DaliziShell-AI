# Windows x86 桌面预览

将完整 ZIP 解压到新目录，运行 `DaliziFiles.exe`。包内的程序使用 i686 MSVC 目标编译，可在 Windows 11 x64 的 WOW64 环境中运行。真实 32 位 Windows 10 的安装、WebView2 和重启恢复仍待验收。运行 `.\Check-Windows.ps1 -Json` 可同时查看包和系统的架构。

文件管理、内嵌浏览器、终端、SSH 和原有聊天仍从各自的标签进入。模型服务沿用用户已有的配置。独立 Harness 任务需要 x64 桌面及配套组件；x86 设置页显示架构限制。锁定的 Harness 要求 Node.js 24.9 或更高版本，Node 24.22.1 的官方 Windows 发行文件只有 x64 和 Arm64。[Node 官方发行清单](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt)

### 在开发机重建

安装 MSVC x86 工具并运行 `rustup target add i686-pc-windows-msvc`。在项目根目录执行以下命令，使用与桌面相同的 MSVC 工具链：

```powershell
cargo build --release --locked --manifest-path src-tauri/Cargo.toml --target i686-pc-windows-msvc --bin dalizi-files
python tools/collect_windows_notices.py --architecture x86 --output src-tauri/target/x86-licenses
python tools/package_windows.py --preview x86-desktop --licenses src-tauri/target/x86-licenses --exe src-tauri/target/i686-pc-windows-msvc/release/dalizi-files.exe
```

许可证收集和打包使用本机 Cargo 缓存。首次构建前可运行 `cargo fetch --locked --manifest-path src-tauri/Cargo.toml --target i686-pc-windows-msvc`。打包器读取 PE 头选择架构和依赖清单，并拒绝将 x64 Harness 组件装入 x86 包。

终端使用随源码分发的 portable-pty 0.9.0。上游 crate 的 SHA-256 为 `b4a596a2b3d2752d94f51fac2d4a96737b8705dddd311a32b9af47211f08671e`。本地修改将三个动态 ConPTY 函数指针声明为 Windows 系统调用约定，修正了 x86 进程在开启终端时崩溃的问题。源码位于 `src-tauri/vendor/portable-pty`，保留上游 MIT 许可证。

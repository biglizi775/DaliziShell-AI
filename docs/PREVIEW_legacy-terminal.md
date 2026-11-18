# 早期 Windows 的内嵌终端

解压完整 ZIP 后运行 `DaliziFiles.exe`，保留同目录的 `terminal/`。每个压缩包已带上对应架构的 WinPTY。在缺少系统 ConPTY 的机器上，从文件夹打开终端仍可进入该目录的交互式 PowerShell。使用系统 OpenSSH 客户端的兼容模式共用同一终端入口。内置 SSH 使用自己的连接和终端通道。

当系统提供全部 ConPTY 接口时，程序优先使用系统后端。在较新的 Windows 上复核兼容终端时，可退出桌面，从解压目录运行以下 PowerShell 命令。变量仅影响该 PowerShell 及其子进程。

```powershell
$env:DALIZI_USE_WINPTY = '1'
.\DaliziFiles.exe
```

打开两个终端，在不同目录执行命令，调整窗口大小，然后在运行 `Start-Sleep -Seconds 60` 时按 Ctrl+C。返回提示符后再输入下一条命令。`exit 23` 可用于核对退出码。恢复默认后端时，退出桌面，在新的 PowerShell 窗口启动程序。

桌面根据 Windows 进程句柄的结束信号读取退出码。即使程序返回 `259`，标签也能识别会话已结束。强制关闭会话时，程序按 Windows 实际返回值报告成功或失败。

x64 和 x86 兼容终端均在 Windows 11 x64 开发机上验证。系统 OpenSSH 客户端通过本机 SSH 测试服务器验证了认证失败后重试、主机概况、终端中断和重连。使用兼容模式的目标机需要安装 OpenSSH 客户端。真实早期 Windows 10、Server 和 32 位系统的整机验收仍待进行。[兼容矩阵](WINDOWS_COMPATIBILITY.md)

### 离线构建

开发机可预先保存上游 `winpty-0.4.3-msvc2015.zip` 到 `src-tauri/target/`，或在打包时通过 `--winpty-archive` 指定位置。打包器校验归档的 SHA-256 为 `35a48ece2ff4acdcbc8299d4920de53eb86b1fb41e64d2fe5ae7898931bcee89`。测试 Cargo 构建的独立程序时，使用 `python tools/package_winpty.py --architecture x64 --output <程序目录>` 准备运行文件，32 位程序改用 `x86`。[上游归档](https://github.com/rprichard/winpty/releases/tag/0.4.3)

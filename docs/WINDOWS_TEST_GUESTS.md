# 用两台 VMware 客机验收 RC7

这两台虚拟机用于回答：普通用户在断网且没有开发工具的 Windows 10 和 11 上，能否打开 RC7、运行随包组件，再退回公开版并保留聊天。每个系统单独出一份报告。**空白虚拟机、光盘读取测试、开发机演练都不算通过。**

## 宿主机准备

用生成器新建 `Windows10/Windows10.vmx` 和 `Windows11/Windows11.vmx` 后，可在 VMware Workstation 中打开。不要移动单个 VMX：同一批次的两台客机用相对路径引用上一层的 `Dalizi-RC7-QA.iso`。虚拟磁盘是空的，验收光盘不包含 Windows 安装程序。 若已有 RC3 至 RC6 的两台客机，无需重新建机：运行 `python tools/prepare_windows_guests.py --release rc7 --disc-only`，在关机状态将第二台光驱改挂它打印的 RC7 ISO。不要覆盖旧光盘或旧报告。

要在另一台开发机重新创建，先把与 [RC7 记录](verification/harness-m5-rc7-windows11.json) 中 `offlineKit.sha256` 匹配的验收 ZIP 放在仓库的 `dist` 下。宿主机需有 VMware Workstation（含 `vmware-vdiskmanager.exe`）、Python 3.11+ 和 pycdlib 1.22.0。在项目根目录运行：

~~~powershell
python tools/prepare_windows_guests.py
~~~

每次运行都创建新的 `src-tauri/target/windows-guests/rc7-…` 目录。每台客机有 2 核、6 GiB 内存、独立的 80 GB 按需增长磁盘、EFI 和安全启动。第一台光驱预留给系统安装介质；第二台挂载只读验收光盘。网卡默认断开，不需要设置共享目录或剪贴板。生成器会打印本次光盘的 SHA-256；重制光盘应核对内部文件，两次制盘时间不同可能产生不同的外层摘要。

## 安装系统与建立快照

1. 在客机**关闭**时，给第一台光驱（SATA 0:1）选择有权使用的 Windows x64 客户端安装 ISO，勾选启动时连接。保留第二台光驱（SATA 0:2）的验收 ISO。如需官方评估介质，请由使用方按微软页面办理：[Windows 10 Enterprise](https://www.microsoft.com/en-us/evalcenter/download-windows-10-enterprise/) 或 [Windows 11 Enterprise](https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise)。不要使用 Windows Server 代替。
2. 安装 Windows 11 前，按 [VMware 的 Windows 11 要求](https://knowledge.broadcom.com/external/article/315650) 在虚拟机设置中启用加密并添加 **Trusted Platform Module**。按 VMware 提示保管加密凭据。Windows 10 客机不需要这一步。
3. 正常安装系统并准备 WebView2 Runtime，设置阶段若需联网只连接该客机的网卡。创建独立的**标准用户**，用该账户登录。未提升权限的管理员账户仍不合格；不要在这个账户安装开发工具或打开过呆梨。弹出安装 ISO，保留验收光盘，在 VMware 中断开客机网卡。为此状态创建快照。

## 客机执行与宿主机取回报告

1. 用普通用户打开 **64 位 Windows PowerShell 5.1**。在「此电脑」找到卷标 `DALIZI_RC7` 的光驱，进入实际盘符。先运行 `.\verify_windows_guest.ps1 -Mode Inspect`，按[离线验收说明](WINDOWS_GUEST_QA.md)核对普通用户、网络、配置和 ZIP 摘要。无法按组织策略运行脚本时，应使用已获准的测试环境。
2. 在光驱目录运行 `.\Run-Guest.ps1 -ConfirmDisposableGuest`，等待 PowerShell 返回。输出会指出本次报告在客机「文档」中的位置；COM1 可用时会同时将这份报告发到宿主机该客机目录的 `acceptance-serial.log`。前置条件不满足时，测试可能在生成报告前就停止；先处理报错，再从干净快照重试。
3. **恢复快照或再次开机前**，在宿主机项目根目录收取结果。以下示例中把变量设为生成器实际打印的批次目录：

~~~powershell
$run = 'D:\path\to\rc7-…'
python tools/collect_windows_guest_report.py --release rc7 --family 10 --log "$run\Windows10\acceptance-serial.log" --output "$run\windows10-first.json"
python tools/collect_windows_guest_report.py --release rc7 --family 11 --log "$run\Windows11\acceptance-serial.log" --output "$run\windows11-first.json"
~~~

每条命令只在对应客机运行结束后执行，输出路径必须是新文件。退出码 0 表示这份报告符合该 Windows 版本、指定发行 EXE 和九个阶段的通过条件；合法的失败报告也会保存，但退出码非零。摘要不符、重复回传、拿错系统或使用演练报告时拒绝签收。每次独立测试要保留独立的串口日志；若串口不可用，先通过允许的离线导出方式保留客机文档里的原始 JSON，不要先还原。串口摘要用于发现传输损坏，不能证明快照来源；测试人员仍需记录实际所用安装介质和快照。

离线客机不能验收云端鉴权。单独在联网测试环境按[真实模型验收步骤](WINDOWS_GUEST_QA.md#另行验收真实模型)操作；密钥只填在应用的模型设置中。

## 维护这套设施

运行 `python tests/test_windows_guest_report.py` 检查收集器如何处理损坏、失败、重复和演练报告。若宿主机无法从虚拟光驱读出卷，可用宿主机的 `tar.exe -tf <光盘路径>` 检查目录；也可在装有[测试依赖](../tools/requirements-openssh-guest.txt)的开发环境运行 `python tools/probe_windows_qa_disc.py <光盘路径>`。后者用一次性 Alpine 客机读取实际 VMware SATA 光驱，与原验收 ZIP 和入口脚本逐文件核对 SHA-256，再用串口返回随机校验标记；它不会启动两台 Windows 客机。[RC3 设施记录](verification/windows-guest-preparation.json)及 [RC7 验证记录](verification/harness-m5-rc7-windows11.json)与 Windows 应用验收报告分别保存。

保留旧批次时，制盘、光驱测试和报告收集均可显式指定 `--release rc3`、`--release rc4` 、`--release rc5` 或 `--release rc6`。旧报告不能签收 RC7。

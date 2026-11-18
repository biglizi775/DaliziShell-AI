# Harness M5：Windows 候选包、停用与回退

本地候选包是在 0.5.1 工作树上生成的未签名 Windows x64 构建，未发布到 GitHub。已在一台 Windows 11 开发机验收；干净 Windows 10 和 11 尚未签收。公开发布的 0.5.1 没有此组件。

当前本地候选为 **M5 RC7**，请解压到新目录。它沿用已测 history-scope 预览中的生产程序与运行组件。选择「查看所有目录」时，折叠行会显示任务归属；切回当前目录时立即清除上一视图的操作。目录暂不可用时可以重试。

RC7 还包含项目会话保留、固定目录的权限检查、聊天保存失败后的恢复与退出前保存。双面板提问会标出取件的工作目录。重复提交同一预览、同一问题只产生一个任务；若要换问题，请重新预览。关闭原标签不会撤销已提交的任务。

自 RC5 起，文件任务完成时，只有所属项目的「文件任务」（面板收起时为「AI 对话」）或对应 SSH 目录的提问按钮显示未读数。只打开列表不会清除提示，展开并看到结果后才记已读；已读状态随重启保留。现有已结束的历史不会在升级后全部标红。

RC3 中尚未发送的本地文件、网页引用和 SFTP 预览会相互覆盖，导致已核对的预览报失效。RC4 按编号保存各份快照，关闭或提交一份不影响其他来源；同一网页引用改选目的地会撤销旧目标。每份预览有效期为五分钟，同时最多保留八份；仍一次执行一个模型任务。RC4 沿用 RC3 的 r2 组件及旧聊天回退逻辑，未更换模型协议。

两台干净系统的签收使用[VMware 客机与报告回收步骤](WINDOWS_TEST_GUESTS.md)。验收光盘和串口可以独立检查；只有各系统实际运行原版 EXE 的 Guest 报告才计入 M5。

## 首次使用

1. 将外层 ZIP 完整解压到新目录，例如 `D:\应用\呆梨 候选版`。保留原程序。需要系统已有 Microsoft Edge WebView2 Runtime；用户不需要安装 Node、pnpm、Rust、Visual Studio 或 Python。
2. 启动 `DaliziFiles.exe`。默认仍可使用文件、浏览器、手动 SSH 和原有聊天。若要使用 Harness，打开 **设置 → Agent 引擎**，检查组件后选择启用。该开关保存在本机用户数据目录，不写入工作项目。
3. 在 Agent 模型设置中选择 **Anthropic Messages**，核对用户自己的端点、模型和密钥。选择项目中的 TXT 或 Markdown，打开「文件任务」，检查预览再提交。已提交的问答留在原项目。普通聊天的配置和历史不因启用而转换。
4. 内层文件必须保留为 `components/harness-0.2.2-rc.3-node24.22.1-win-x64-r2.zip`，与主程序保持上述相对位置。**不要解压、重命名或从 PATH 补装这个组件**。缺失或损坏时换回与桌面程序配套的原件，再检查组件。

## 模型请求失败时

文件任务只在你提交后发送，失败后重新预览、手动提交才会再次发送。鉴权失败请核对 API Key；额度不足请检查该密钥所属账户；限流或服务暂不可用可稍后手动提交。网络中断时无法判断服务商是否已处理或计费。切换目录不会移动失败记录。诊断只记错误类别，不保存服务商返回的原始错误正文。这里的约束适用于 Harness 文件、网页引用和远程快照任务。错误含义见 [DeepSeek 官方错误码](https://api-docs.deepseek.com/quick_start/error_codes/)。

## 停用、更新与回退

- 从「Agent 引擎」停用后，不再接受新任务，未提交预览及未审批提案失效。已经提交的只读请求可以完成；需要立即终止时在原任务记录点停止，或真正退出程序。收起到托盘仍在运行。
- 更新前先完成或停止任务并退出，将新主程序和配套组件解压到另一个目录。新组件编号不会继承旧编号的启用状态；同一用户运行同编号的另一份程序会看到原开关。不要用新组件覆盖正在读取的组件。
- 回退时退出新程序，重新启动保留的旧程序。原目录中的便携设置与工作区 `.dalizi/` 不随包移动；如需沿用便携偏好，先留副本。旧聊天归档保持原格式。Harness 的 v4 索引保存在当前用户本机；迁移保留已有旧索引，旧程序不会显示新增的 v4 任务。不要把降级当作任务记录同步。
- **诊断**：在「Agent 引擎」检查组件、预览诊断，再自行选择新文件保存；不自动上传或覆盖旧文件。报告含宿主版本、组件清单摘要、配置与协议、开关、最近最多 20 个阶段的结果和耗时。问题、回答、API Key、服务器地址、文件名与路径不在报告里。诊断中的工具数是配置值；集成测试另对实际模型请求里的工具清单做断言。

## 已验证的范围

**旧版聊天怎么回退：** 从公开版直接升级，查看历史不会改文件。用过早期候选包的目录，先在 RC2 或更新版本打开「对话历史」；如出现 **整理步骤，使旧版可读**，点击一次再回退。它只将内联步骤移到附件，保留正文、消息 ID、时间和修订号。没有这个按钮表示该目录没有需要整理的内联步骤。

自 RC2 起保存的聊天正文、摘要和标题可由旧版读取；操作步骤只在新版显示。步骤附件位于工作区 `.dalizi/chat-steps-v1-<摘要>.json`，随整个 `.dalizi` 复制或备份。在旧版修改一条聊天后，新修订不继承旧修订的步骤；其他对话不受影响。若附件损坏，新版允许读取和导出正文、另存为新对话，阻止覆盖受影响的原记录。删除或更新后，程序清理不再引用的有效附件；文件被锁定时会在下次成功保存时重试。

| 情形 | 结果 |
| --- | --- |
| Windows 11 家庭中文版 10.0.26300；真实优化构建、WebView2、随包 Node/dsh、回环模型 | 用独立应用标识在中文与空格路径启动；子程序的 PATH 只有 System32。无组件时文件可浏览且无法启用；组件被改动时启用失败；启用后再损坏也没有发出模型请求。 |
| 启用、停用与退出 | UI 能启用；旧草稿不能在停用再启用后提交；已提交的只读问答可完成。停用及结果在重启后保留。等待回复时正常退出，所测 Node 进程数归零；重启将任务标为中断，不再次请求。 |
| v0.5.1 → RC2 → v0.5.1 → RC2 | 在 Windows 11 开发机用 v0.5.1 标签源码和当前源码分别构建优化桌面程序，只更换测试应用标识。经真实 WebView2 检查项目迁移、目录记忆、便携偏好、旧版读新正文、回退后续写及返回新版找回步骤。未把这项记作在干净系统运行公开二进制。 |
| 冷启动与资源（2026-11-16，一台机器、一次复测） | 启动至可操控桌面 0.86 秒；提交至回环服务收到请求 4.41 秒，其中任务组件准备 3.16 秒。提交至回答可见 6.97 秒，含夹具刻意等待 0.80 秒。宿主/Node 峰值工作集约 112/141 MiB，不含 WebView2 子进程；不代表公网延迟。 |
| RC3 组件可复现 | 101 个 npm 包，3,105 个载荷文件。r2 只改了一份配置，ZIP 为 42,884,693 字节；SHA-256 为 `576a0c64da03d892ea8ac94b7bfeda905dacd2ed7fb5f8d310fe75c46e069dc2`。 |
| 安装目录不可写、模型端点不可达 | 在同一开发机对测试目录设置并验证拒绝写入的 NTFS 权限，真实桌面和 dsh 仍从随包 PowerShell 夹具获得回答；关停该端点后新任务约 22 秒显示失败。恢复后核对原权限条目并确认目录可写。完整[复测记录及对应候选包哈希](verification/harness-m5-windows11.json)。 |
| OpenSSH / SFTP | 已在两台独立部署的 Linux OpenSSH 服务器实测同名路径、仅 SFTP 账户、切服务器后断线及任务归属，见[实测记录](verification/harness-openssh-windows11.json)。 |
| 仍需外部环境 | 无开发工具的干净 Windows 10/11 x64、普通用户首次启动、整机断网、真实云模型及旧公开版回退演练仍待实测。不用本机隔离进程的结果代替干净系统验收。 |

每个任务在一次性临时目录内校验并展开约 115 MiB，工作结束后清理；请为任务临时文件预留相应空间。受限配置提供本次快照且不注册模型工具，不是 Windows 系统级沙箱。此包只覆盖已测试的快照工作流，不承诺完整 dsh CLI 的所有插件和 provider。

## 在干净 Windows 上复验

[Windows 离线验收包与运行说明](WINDOWS_GUEST_QA.md)适用于 [RC7](verification/harness-m5-rc7-windows11.json)。里面是未改动的旧公开 ZIP 和 RC7 ZIP；用系统自带的 Windows PowerShell 5.1 驱动两款桌面，无需在客机安装测试工具。先运行 `Inspect` 核对包摘要、普通用户和离线环境，再在可还原快照中运行 `Guest`。历史 [RC3 记录](verification/harness-m5-rc3-windows11.json)、[RC4 记录](verification/harness-m5-rc4-windows11.json)、[RC5 记录](verification/harness-m5-rc5-windows11.json)和 [RC6 记录](verification/harness-m5-rc6-windows11.json)继续留档。非提权运行的管理员账户仍算管理员；开发机演练不代替两份干净系统报告。

在可还原快照的 x64 测试机，用普通用户操作。记录系统 build、WebView2 版本、外层 ZIP 的 SHA-256、操作及实测结果；没有实际执行的项目标为「未测」。只用测试目录、假密钥和合成文件。

1. 确认系统未装 Node/pnpm，校验外层 ZIP，对照随附摘要后解压到有中文和空格的目录。首次启动不配密钥，核对文件浏览。另复制一份去掉内层组件，验证仍能浏览且无法启用 Harness。
2. 在测试项目 A 的 `notes.md` 写入 `DALIZI_M5_SELECTED`，在**不选中**的 `other.md` 写入 `DALIZI_M5_OTHER`。在 PowerShell 运行随包的 `qa\windows_acceptance_model.ps1`，使用它打印的本机地址，协议选 Anthropic Messages，模型填 `deepseek-v4-pro`、密钥填 `local-test-key`。只提交第一个文件；预期在 A 看到 `DALIZI_M5_ANSWER`，夹具检查选择标记和零工具并退出。夹具每次只服务一条请求，无需互联网。
3. 在仅对安装目录有读取/执行权限的账户重做问答；临时目录及用户本机数据目录须可写。尝试保存便携偏好，单独记录只读提示，不把它当成 Harness 故障。导出诊断至用户目录，核对无内容或密钥。
4. 保持夹具已退出，仍使用刚才的本地端点，再提问。应显示失败或可停止，不回退到其他提供商。断开测试机的外网，在无密钥状态重新启动并浏览文件。只在测试机切换网络。
5. 重启夹具（可加 `-HoldSeconds 30`），提交后切到 B，核对 B 无 A 的消息；等待模型期间真正退出，核对应用的 Node 子进程已退出。重启查 A 的中断记录，无自动重发。用保留的旧程序核对旧归档；记录回退前后样本数量。需要回到起点时还原虚拟机快照。

## 构建与开发验收

开发机可从仓库根目录运行 `.\tools\verify_chat_rollback.ps1`。它从固定的 v0.5.1 Git 对象导出源码，使用独立应用标识，不打开日常配置。[RC4 回退实测](verification/harness-m5-rc4-chat-rollback.json)另使用此次已核对摘要的两个演练 EXE：用旧版改写带步骤的聊天后，新版不把旧步骤附到新修订，同目录另一条聊天的步骤仍在。

要在开发机检查发行文件而不启动程序，可运行 `python tools/verify_public_rollback.py --inspect --release rc7 --previous <公开版ZIP> --candidate <RC7 ZIP>`。它分别校验两份 ZIP 和内含 EXE，记录 `executed: false`。在已声明为一次性的测试环境去掉 `--inspect`、指定 `--report <新文件>`，才会运行两款原始 EXE。GitHub 托管 CI 另用 `--ci-exe` 比对本次 Cargo 构建的程序，报告标记 `fresh-ci-build`，工作流只保存回退结果 JSON。它不代替本地交付 ZIP 或干净 Windows 客户端的验收。

冻结 RC7 使用下列命令。根据独立预览记录核对完整源码 ZIP、预览 ZIP、EXE、锁文件和组件，原样沿用 EXE 与依赖许可。包内 BUILDINFO 记录两份源归档的摘要。

~~~powershell
python tools/promote_windows_preview.py --release rc7 --evidence docs/verification/history-scope-windows11.json --output-dir dist/rc7-rebuild
~~~

如需从当前工作树生成新的集成测试包，在仓库根目录运行下列命令。Python 3.11+ 用于打包；Cargo 与 npm 的已核验缓存可重用。Node 的输入是官方 `node-v24.22.1-win-x64.zip`，不要使用开发目录里散落的二进制文件。

~~~powershell
python tools/package_harness_component.py --node-zip D:\inputs\node-v24.22.1-win-x64.zip --output src-tauri/target/verified-component
$component = (Get-ChildItem src-tauri/target/verified-component/*.zip).FullName
.\tools\verify_harness_release.ps1 -Component $component
cargo +stable-x86_64-pc-windows-msvc build --release --locked --manifest-path src-tauri/Cargo.toml --bin dalizi-files
python tools/collect_windows_notices.py --output src-tauri/target/candidate-notices
python tools/package_windows.py --licenses src-tauri/target/candidate-notices --component $component
~~~

宿主只接受编译进程序的规范清单摘要，当前为 `e4e3be83659bac58a61ab997a264d2f7def45e01d399c0c2f41ca869d1903def`；清单按路径列出大小和 SHA-256。启用时完整检查，每次启动前从同一已锁定的 ZIP 句柄重新校验并写入本任务的新目录。仅生成候选组件不更新宿主信任值。变更 Node、依赖、配置或许可时，应重新审查运行时追踪、锁文件、许可和回归结果，再更换宿主信任值及组件编号。

组件内含 Node 与 Harness 许可、各 npm 包的声明和来源索引；主包另有 Rust 和前端许可、BUILDINFO、逐文件 SHA-256 以及外层 ZIP 摘要。构建来源带未提交变更时 BUILDINFO 明示 dirty；候选包不是公开发布或干净安装验收的证明。

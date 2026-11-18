# Windows 候选包的真实模型单次问答验收

这是给测试人员的独立工具；日常试用只需应用 ZIP。请准备一台可联网的 Windows x64 电脑、WebView2、从未运行过呆梨的测试账户，以及你有权使用的测试密钥。使用随包组件发送一次问答，可能产生该服务的费用。密钥只在应用的模型设置中输入。不要使用日常账户；请事先创建可以还原的测试快照。

1. 将云端验收工具解压，保留与工具批次一致的应用 ZIP 原样。在工具目录打开 **Windows PowerShell 5.1**。先运行以下命令，把路径替换成应用 ZIP 的实际位置。Inspect 只检查外层 ZIP、EXE 与内层组件的摘要，不启动桌面，不访问网络。

   ~~~powershell
   $app = Read-Host '输入本批次应用 ZIP 的完整路径'
   .\verify_cloud_turn.ps1 -Candidate $app
   ~~~

2. 确认准备好使用测试账户和额度后运行下列命令。报告路径必须是新文件；不要关闭 PowerShell。工具会创建两个临时文件夹 **A** 和 **B**、解压刚才核对的应用并启动它。脚本不会录屏、监听调试端口、读取凭据或代替你提交问题。

   ~~~powershell
   $report = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'cloud-first.json'
   .\verify_cloud_turn.ps1 -Mode Live -Candidate $app -ConfirmFreshTestAccount -Report $report
   ~~~

3. 在桌面「设置 → Agent 引擎」启用 Harness，在模型设置中选择 **Anthropic Messages**，使用 [DeepSeek 官方兼容地址](https://api-docs.deepseek.com/guides/anthropic_api/) `https://api.deepseek.com/anthropic`，选择账户可用的 `deepseek-flash` 或 `deepseek-v4-pro`。打开工具打印的 A，只选 `notes.md`；不要选 `other.md`。在「文件任务」的预览中核对文件和目标，按原样填入下列问题，只发送一次。

   > Reply with only the exact text of the selected file.

4. 提交后切到 B，确认 B 没有这条回答。回 A，只看「文件任务」的未读数，**不要展开回答**。通过托盘菜单彻底退出应用。脚本先读取本次任务，核对官方端点、所选文件、回答中的随机标记、A 和 B 的记录数和未读状态。按实际观察回答它关于切到 B 的问题。

5. 工具会启动同一份应用第二次。回到 A，打开「文件任务」，展开原回答直到未读标记消失，再从托盘退出。不要重发。它比对两次的任务和目录身份、回答、结果版本，同时核对两次落盘的未读状态。只接受同一条结果从未读变为已读。

报告仅包含批次、时间、程序与组件摘要、核对阶段、结果以及通过时的模型名称和人工切换确认。正文、标记、任务编号、目录、账号和密钥不进入报告。此检查依据应用记录和你的观察；它不读取服务商的计费日志，也不能由回答中未出现 B 的标记推断服务商实际收到的全部字节。请求正文隔离另由本地模型测试验证。

如果失败，请保留报告和最后的错误码；不要在同一轮再发第二次。修正设置后，从干净测试快照重新开始，用新的报告路径。测试结束后移出报告、还原快照，并按需撤销临时密钥。开发机回环问答和 Inspect 都不能签收真实模型。

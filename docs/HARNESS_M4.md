# M4 · 在远程目录提问

在已启用 Harness 的 Windows 开发构建或 [M5 候选包](HARNESS_M5.md)的内置 SSH 工作区，可以选择 SFTP 面板中的文本文件，核对快照后发起独立问答。服务器 A 与 B 即使都有 `/docs/same.md`，也分别保存任务。切到其他服务器、文件夹或网页，不会把已提交的回答投到当前聊天。

## 使用

1. 按 [M1](HARNESS_M1.md) 配置模型，使用**内置 SSH**核对主机指纹并登录。使用兼容 OpenSSH 终端时，请另开内置 SFTP 连接；程序不会读取终端屏幕或替你输入命令来猜目录。
2. 在远程文件面板选中 1–3 个普通 UTF-8 TXT 或 Markdown 文件，点击 **在此远程目录提问 → 预览所选文件**。确认账户、主机、端口、路径和指纹，再检查完整正文、采集时间、服务地址和模型。不选文件也可以打开此目录的历史。
3. 输入问题，点 **将以上快照发送给模型**。仅问题、远程目录、文件名与正文、采集时间进入模型请求；账户、主机地址、指纹、SSH 密码、私钥、终端输出和其他文件不作为附加上下文。若正文本身包含这些信息，仍会随选区发送。模型没有文件、终端或网络操作工具。
4. 在同一远程目录再次打开面板可查看回答；断开连接后，也可从「文件任务 → 查看所有目录」找回。列表显示快照所属的服务器。已经提交的任务允许在断线后完成，会标注 **来自断线前的快照**。固定的本地 Agent 项目不会被改成远程项目。

## 哪些变化会使预览失效

| 变化 | 结果 |
| --- | --- |
| 刷新远程列表、改目录、换一条连接或重新登录 | 原列表凭证不能用于新的读取或提交。重新选择并预览。 |
| 采集中断线，或采集后、提交前断线 | 不能提交该快照；不自动重连或重发。 |
| 在采集后编辑了原文件，但连接和目录没变 | 提交的是预览中的文字；程序不在发送时重新读取远端文件。 |
| 在同一地址遇到新主机指纹 | 复用旧信任的登录会失败。单独核验并接受新指纹后，新主机不会得到旧主机历史；旧连接上未提交的授权也随信任更新而失效。 |
| WebView 或应用退出 | 未提交的预览不恢复。已登记的问答可在本机查阅；重启不重发无法确认的请求。 |

## 读取边界

每个文件最多 32 KiB，合计最多 64 KiB；只能读取本次列表中出现的名字。宿主在已认证的 SFTP 连接上检查规范路径、祖先目录、文件类型、所有者、大小与修改时间，并在读取前后核对同一打开句柄的属性。拒绝链接、特殊文件、不稳定或缺少必要属性的来源，以及 `.ssh`、`.git`、`.dalizi` 目录。一处校验失败，整份预览失败。

本实现面向可信 SFTP 服务导出的私有目录：需要服务端提供 POSIX 风格权限、UID/GID 和句柄属性。目录由 root 或该账户登录目录的所有者控制，组用户和其他用户不得写入；文件同样不能允许组或其他用户写入。共享目录、仅提供简化元数据的设备及部分 Windows SFTP 配置可能无法预览，仍可使用手动 SFTP。SFTP v3 不提供可移植的 inode 身份或相对目录句柄的原子打开；这里核对服务端报告的属性，不承诺防范不可信的服务器或特权账户蓄意替换内容。不要求为了 Agent 放宽服务器权限。

每个工作区的身份由规范主机名、端口、账户、已核验指纹、连接配置的系统模式及区分大小写的远程根目录生成。连接凭证不写进任务记录。M4 使用本机 `HarnessTasks/tasks-v4.json`，按 v3、v2、v1 的顺序导入已有索引；旧索引保留，旧程序看不到新任务。保存问题、回答、来源元数据、文件名和采集时的 SHA-256 内容摘要，不单独保存快照正文；回答可能引用正文。

协议依据：[SFTP v3 文件属性](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02#section-5)和[打开文件的请求格式](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02#section-6.3)。这是 v3 协议草案，特定服务器可能支持额外扩展。

## 开发与验收

**真实服务器复验（M5 RC2，Windows 11）。** 在两台独立的 Alpine Linux 3.23.4 虚拟机上部署 OpenSSH 10.2p1。两台使用不同主机密钥和地址，但用户名、端口、目录 `/home/alpine/private` 和文件名 `notes.md` 相同。Windows 桌面通过内置 SSH 使用公钥登录，真正执行 OpenSSH 的 SFTP 操作；运行时和模型工具清单的检查仍使用随包组件和本机测试模型。

| 操作 | 实测结果 |
| --- | --- |
| 在 A 选取文件、提交问题；等待时打开 B 的同名目录，断开 A | 测试模型只收到 A 的选中文本，一次请求、零工具。B 和本地项目没有 A 的任务，重启后从 A 的历史找回了断线前快照的回答。 |
| 在 B 使用 A 的目录凭证；再用 B 自己的预览 | 前者被拒绝，后者只读到 B 的内容。B 的服务只允许 SFTP；交互终端关闭后仍可浏览和预览。 |
| 在 `Paper` 和 `paper` 间切换；选择链接或共享可写目录里的文件 | 两个目录不共用身份，切换之前的预览不能提交。对链接和共享可写目录的预览被拒绝，均未发送模型请求。 |

三轮测试各自启动了两台新虚拟机。最后一轮还在应用重启后核对了 A 唯一一条任务的原始 ID、回答正文、离线标记和选中文件摘要；B 和本地历史仍为空，模型没有被再次调用。每轮结束均核对两台虚拟机已停止、临时私钥及磁盘已移除、两条临时主机信任已删除。详见[双 OpenSSH 实测记录](verification/harness-openssh-windows11.json)。这是标准 Linux OpenSSH 部署的实测，不代表所有生产堡垒机、ACL、Windows SFTP 或第三方设备。

**开发机复跑：** 需 Windows x64、VMware Workstation（已有 VMnet1 仅主机网络和 DHCP）、Python 3.11+、项目的 Rust/Node 开发依赖。无需管理员权限来部署测试 sshd，无需已有远程账户。脚本从[上游发行目录](https://dl-cdn.alpinelinux.org/alpine/v3.23/releases/cloud/)取固定 NoCloud 镜像，按发布的 SHA-512 核对；初次下载约 176 MiB，两台临时机合计配置 1.5 GiB 内存。下载缓存和测试环境均在 `src-tauri/target` 内。VMware 仅供开发验收，普通用户使用 SSH 不需要安装。

~~~powershell
# 从仓库根目录运行；内层 ZIP 保持原样。
$component = (Get-ChildItem dist/*harness-m5-rc3/components/*.zip).FullName
.\tools\verify_harness_openssh.ps1 -Component $component
~~~

下列原生夹具仍保留，用于反复注入真实服务器不易稳定复现的读取中断线、异常文件属性和主机密钥轮换。

- [SFTP 快照与身份](../src-tauri/src/ssh_task_snapshot.rs)、[远程目录列表](../src-tauri/src/ssh_files.rs)、[问答宿主](../src-tauri/src/harness_tasks.rs)和[任务面板](../ui/harness-tasks.js)。
- [双主机原生场景](../tools/harness_m4_checks.cjs)使用独立应用配置、两台临时回环 SSH/SFTP 服务及一个回环模型。用真实 Tauri、WebView2 和 dsh 验证同名文件、原生面板预览、读取过程中断线、提交后断线、重连、主机密钥轮换及重启。夹具模拟 POSIX 属性，没有接触日常服务器，不代表所有真实服务器、ACL 或云端模型均已验收。
- 测试用 Python 依赖不随桌面程序分发。在仓库根目录运行以下命令；已有包含相同版本 Paramiko 的环境时，也可设置 `DALIZI_PYTHON` 直接使用。

```powershell
python -m venv src-tauri/target/m4-venv
& ./src-tauri/target/m4-venv/Scripts/python.exe -m pip install ((Get-Content tools/requirements-dev.txt) -match '^paramiko==')
.\tools\verify_harness_desktop.ps1 -Toolchain stable-x86_64-pc-windows-msvc
# 上一行生成独立测试程序后，可快速单独重跑 M4：
node tools/harness_m1_smoke.cjs src-tauri/target/harness-m1/debug/harness-m1-fixture.exe --m4
```

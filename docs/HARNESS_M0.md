# 在 Windows 验证呆梨的 Harness 客户端

这是[集成方案](HARNESS_WORKBENCH_DEVELOPMENT.md)的 M0 开发入口。协议客户端是独立的小型 Rust crate，无需先编译完整 Tauri 应用。测试不需要模型账号，每次在新的临时目录中启动 dsh。桌面开发版的入口和后续验证见 [M1 本地只读任务](HARNESS_M1.md)。

| 组件 | 本次选型 |
| --- | --- |
| 上游源码基线 | `39163dd30f703a79079e2d2446545cff3c453738` |
| 运行时 | npm 包 `@deepseek-ai/dsh@0.2.2-rc.3`，Node ≥ 24.9；测试机使用 Node 24.22.1 |
| 协议 | `deepseek-harness-sdk-runtime`，握手版本 `0.0.1`（与 npm 发布版本不同） |
| 配置 | `sdk-minimal` + [snapshot-only.yml](../resources/harness/snapshot-only.yml)，禁用 shell、文件工具、工作目录工具和 MCP 资源，文件策略设为只读 |
| 用户输入 | 测试仅提交一份内存中的合成文本。应用数据、SSH 连接和实际用户目录不参与。 |

在呆梨项目根目录运行。安装前端测试依赖用根目录的 `npm ci`；安装 dsh 时另选本机开发目录，不写入呆梨的 npm 依赖：

```powershell
$rt = Join-Path $env:LOCALAPPDATA 'DaliziDev/runtime-0.2.2-rc.3'
npm install --prefix $rt --save-exact --no-audit --no-fund '@deepseek-ai/dsh@0.2.2-rc.3'
$manifest = 'src-tauri/harness-client/Cargo.toml'
cargo test --locked --manifest-path $manifest
cargo build --locked --manifest-path $manifest --example m0
node tools/harness_m0.cjs src-tauri/harness-client/target/debug/examples/m0.exe $rt
```

完整桌面程序使用 [MSVC 和 Windows SDK](DEVELOPMENT.md)。仅测试这个 crate 时，也可以安装 Windows GNU 主机工具链并提供 MinGW-w64 的链接器与汇编器，在以上 Cargo 命令的 `cargo` 后添加 `+stable-x86_64-pc-windows-gnu`，无需改变桌面项目的默认工具链。使用自定义 `CARGO_TARGET_DIR` 时，相应调整示例程序路径。

安装好上述依赖后，本机可直接执行 `.\tools\verify_harness.ps1 -Toolchain stable-x86_64-pc-windows-gnu`。该脚本自动定位 Cargo 和本机开发用的 Node，可用 `-NodeExe` 或 `-RuntimePrefix` 指向其他安装。

[Rust 客户端](../src-tauri/harness-client/src/lib.rs) 校验逐行 JSON-RPC 帧、协议身份、会话与入队回执。真实 dsh 可能先发布 inbox 事件，再返回 `session/prompt` 的回执；客户端按 session 保留有上限的早到通知。只有看到对应输入、已提交的助手文本、成功的 turn/end、空闲和关闭回执，诊断程序才返回答案。缺失回执、错误 session、提前断流和超大帧见[离线回放测试](../src-tauri/harness-client/tests/replay.rs)及[合成协议样本](../src-tauri/harness-client/tests/snapshot-only.jsonl)。

[联调脚本](../tools/harness_m0.cjs) 在回环地址模拟模型，使用一次性的假密钥，核对真实请求只包含选中的标记、工具清单为空、项目内未选文件和 AGENTS.md 的标记均未上传，并检查提交的回答与子进程退出状态。这验证了固定配置的一轮文本任务；不等价于操作系统沙箱或发行包验证。运行时包、锁文件和依赖留在本机测试前缀，不能把该前缀直接当作发行清单。

M1 已接入按目录持久化的独立任务、停止和 Windows Job Object 回收。多轮会话恢复、版本化发行清单及完整性校验仍待实现。本页的 M0 诊断程序只允许连接本机模拟模型。

## 本机实测记录（2026-11-16）

Windows 上以 Rust/Cargo 1.100.0 的 GNU 工具链编译示例，使用 w64devkit 的汇编器和 Rust 自带的链接库。六项协议回放、格式检查和 Clippy（警告视为错误）通过。真实 dsh 加本机模拟模型返回一次已提交回答，工具清单为空，未选文件和项目指令标记未进入模型请求，进程退出码为 0。未调用云端模型。

同时验证了旧面板的目标选择修正：跟随模式进入网页或 SSH 不再退回收件箱；固定项目进入网页不再附带后台文件选择。273 项 Node 测试及 Edge 无头工作台、标签页检查通过。本记录不包含完整 Tauri/MSVC 编译、安装包或真实 SSH 服务器验收。

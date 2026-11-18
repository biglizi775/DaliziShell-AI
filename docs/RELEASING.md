# GitHub 发布指南

未公开的 Harness M5 候选包有独立的[构建、核验及回退流程](HARNESS_M5.md)。外层 ZIP 包含生产标识主程序、已核验的独立组件、Rust/前端许可与可离线运行的验收夹具；没有两种干净 Windows 的实测记录前，不将其作为正式版本发布。

## 源码范围

提交 Rust/前端源码、测试、开发工具、内置技能、文档、GitHub 配置、`Cargo.lock`、`package-lock.json` 和 `ui/vendor/` 的离线资源与许可证。

不要上传整个工作目录或 `src-tauri/target/`。构建程序、调试符号、缓存、测试截图/解析结果、个人 `.dalizi/` 记忆、浏览器配置和本机 Cargo 镜像配置都在 `.gitignore` 中排除。第三方运行资源不是下载缓存，`ui/vendor/` 必须保留。

## 首次提交与推送

项目可先在本机初始化 Git，再由维护者选择仓库地址、可见性和提交身份。已经初始化时跳过 `git init`：

```powershell
git init -b main
npm ci
npm run check
npm test
git status --short
git add .
git diff --cached --stat
git diff --cached
git commit -m "Initial Dalizi Files source"
```

在 GitHub 创建空仓库后，将以下示例地址替换成自己的真实地址再运行：

```powershell
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

仓库已有 README/提交时，先核对并合并远端历史；不要使用强制推送覆盖。此整理步骤不会代替维护者创建远端仓库、选择公开可见性或执行推送。

## 生成干净的源码包

在本地 Git 仓库中运行：

```powershell
python tools/package_source.py
```

打包工具先运行仓库检查，再按源码目录和文件类型选取 Git 可见的文件。已修改和新建的源码都取工作目录里的实际字节。应用、Harness 客户端、前端离线资源、测试、锁文件和许可均随包；宣传片保留制作源码，不打包截图、托管信息或成片。遇到未知类型的应用文件会中止并指出路径，维护者应先核对是否需要更新 `tools/package_source.py`。

默认输出到 `dist/`，可用 `--output-dir` 指定别处。ZIP 名称含其 SHA-256 前 16 位；同目录另附完整摘要（`.sha256`）及逐文件摘要与相对路径（`.files.txt`）。同一打包环境中，只有源文件时间变化不会生成另一份包；已有同名产物内容不符则报错。先用 `Get-FileHash -Algorithm SHA256 <源码包路径>` 对照完整摘要，再解压到新目录。无需初始化 Git 即可构建：

~~~powershell
cd <解压后的项目目录>\src-tauri
cargo build --locked --release --bin dalizi-files
~~~

依赖已缓存时可加 `--offline`；首次构建需准备[开发工具链](DEVELOPMENT.md)和锁定依赖。这个步骤生成桌面 EXE；离线 Harness 运行组件按 [M5](HARNESS_M5.md) 另行核验和装配。若要从解压目录运行 `node tools/check_repo.cjs`，先在项目根运行 `git init`。Windows CI 也从解压的源码包构建 release。

## Windows 发行版

1. 同步 `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `package.json` 的版本并更新锁文件；补充发布说明，区分新增、修复和已知限制。
2. 执行开发指南中的常规检查、预览与相关原生验证；在目标 Windows 10/11 和 WebView2 环境实际试运行。
3. 在 `src-tauri/` 执行 `cargo build --locked --release --bin dalizi-files`。退出同名旧程序后重新构建，不能将复制的旧程序误当作新版本。
4. Windows 可执行文件通过 GitHub Releases 附件分发，源码仓库不提交 exe、pdb 或整个 target。发布包需随附本项目 LICENSE、第三方声明和实际分发组件的许可文本；Rust 依赖范围以锁文件和构建目标为准。
5. 发布说明注明版本、Windows 架构、WebView2 要求及 OpenSSH 仅为兼容模式所需、预览限制和已知问题。浏览器登录数据、用户技能配置及 `.dalizi` 记忆不应随包分发。

当前 `tauri.conf.json` 的安装包构建关闭；普通 `cargo build` 只生成应用程序，不生成安装器。可选便携配置将通用偏好、AI 接口参数、网页收藏与历史保存在 EXE 同级的 `DaliziData/`。发布包与源码包不得携带这个个人数据目录（已加入忽略与仓库检查）。技能、索引、浏览器登录和系统凭据仍使用本机存储，不能宣传为完整数据便携。


## 可重复打包与校验

Harness 的 Windows 候选包还需收齐三个独立的报告：两台[干净 Windows 客机](WINDOWS_TEST_GUESTS.md)运行旧版和候选版的原始 EXE；另一次[联网测试账户的真实问答](WINDOWS_CLOUD_QA.md)。以 RC7 为例，开发机运行：

~~~powershell
python tools/check_harness_release_gates.py --release rc7 --windows10 D:\QA\win10.json --windows11 D:\QA\win11.json --cloud D:\QA\cloud.json
~~~

只给 `--release rc7` 可先核对本地候选 ZIP。没有提供、验证失败、格式或批次不符的报告分别显示 `missing`、`failed`、`invalid`；三份均符合时退出码才是 0。结果只复核输入文件，不能代替测试人员记录实际快照来源或授权，也不会自动发布。云端工具独立打包：`python tools/package_cloud_check.py --release rc7 --output-dir <新目录>`。

完成测试、同步版本并提交源码后，运行 `python tools/package_windows.py --licenses <已核对的许可证目录>`。许可证目录需包含 `frontend/`、`rust/`；可复用依赖版本完全一致的上一发行包，工具逐项核对当前 Windows 依赖树与许可证目录，缺失时拒绝打包。依赖变化时先补齐对应上游许可。

工具核对 EXE 的版本资源，只复制 EXE、许可文本、使用说明、版本说明与历史更新记录；生成 `BUILDINFO.json`、逐文件 SHA-256、ZIP 校验文件，并验证压缩包可解压且内容一致。同名包不会覆盖；已有本地预览包时，可使用 `--output-dir dist/github-release-<版本号>` 输出正式包，保留旧文件。`BUILDINFO.json` 记录提交与 `dirty` 状态；正式发布应在干净提交后打包，`dirty` 为 `false`。上传 GitHub 草稿 Release 后核对附件大小与摘要，全部验证完成再公开；源码标签应指向 BUILDINFO 记录的提交。

每次发布同步项目首页的版本、下载链接和历史功能表，更新 `docs/CHANGELOG.md`、`docs/USER_GUIDE.md`、`docs/README.md` 与对应 `docs/RELEASE_<版本号>.md`。历史记录保留旧版测试与限制，不改写为当前能力；只为实际公开发行的版本添加 Release 链接。发布后核对 GitHub `releases/latest` 指向新版本，并验证下载附件的摘要。

冻结 RC 后继续开发时，用 `tools/package_windows.py --preview workspace-history` 加上原有的 `--exe`、`--licenses`、`--component` 参数生成独立预览。它要求对应的 `docs/PREVIEW_<名称>.md`，包名含 EXE 摘要前 12 位，清单的 `candidate` 为空。该包不能用于签收已经冻结的 RC。

从 RC7 起，工作树或 CI 中直接用 `--component` 装配的 ZIP 名称包含 `harness-integration`，清单含 `kind: integration`。要重做已冻结的候选包，使用冻结时的交付工具与说明，在 `dist` 放入验证记录所列的编译用源码 ZIP 和预览 ZIP，按 [RC7 冻结命令](HARNESS_M5.md)输出到新目录。工具逐字节沿用预览中的 EXE、组件和许可，生成可复核的 `BUILDINFO.json` 与文件清单，再和已登记的候选 ZIP 摘要比对。即便生产 EXE 相同，单独修改包内说明也会改变 ZIP 摘要。干净系统和云端验收均需拿同一批次的原始 ZIP。

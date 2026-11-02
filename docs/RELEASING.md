# GitHub 发布指南

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

打包工具先运行 `npm run check` 对应的仓库检查，再从 Git 已跟踪和未忽略的文件中生成 ZIP；包含当前未提交修改。它不使用整个目录递归打包，不包含 `.git/`、`target/`、本机配置或私人记忆。输出位于 `dist/`，同名产物不会被覆盖。源码包附带 SHA-256 文本和文件清单，可用于检查上传内容；若要发布某个精确提交，提交后使用 `git archive`。

源码包只包含项目源文件，不包含当前用户的 Excel、聊天记录或诊断输出。解压后若尚无 Git 仓库，先运行 `git init`，再执行仓库检查。

## Windows 发行版

1. 同步 `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `package.json` 的版本并更新锁文件；补充发布说明，区分新增、修复和已知限制。
2. 执行开发指南中的常规检查、预览与相关原生验证；在目标 Windows 10/11 和 WebView2 环境实际试运行。
3. 在 `src-tauri/` 执行 `cargo build --locked --release --bin dalizi-files`。退出同名旧程序后重新构建，不能将复制的旧程序误当作新版本。
4. Windows 可执行文件通过 GitHub Releases 附件分发，源码仓库不提交 exe、pdb 或整个 target。发布包需随附本项目 LICENSE、第三方声明和实际分发组件的许可文本；Rust 依赖范围以锁文件和构建目标为准。
5. 发布说明注明版本、Windows 架构、WebView2 要求及 OpenSSH 仅为兼容模式所需、预览限制和已知问题。浏览器登录数据、用户技能配置及 `.dalizi` 记忆不应随包分发。

当前 `tauri.conf.json` 的安装包构建关闭；普通 `cargo build` 只生成应用程序，不生成安装器。程序仍使用本机应用数据目录，不能将“复制 exe 可运行”宣传为完整便携数据模式。

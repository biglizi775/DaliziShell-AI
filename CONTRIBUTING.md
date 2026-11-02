# 参与开发

项目保持 **Rust + Tauri 2 + 原生 HTML/CSS/JavaScript**。Windows 是当前原生代码和集成验证的目标平台。

1. 按 [开发指南](docs/DEVELOPMENT.md) 配置环境。
2. 新建分支，围绕一个问题提交改动；不要顺带重排无关代码或替换框架。
3. 运行 `npm run check`、`npm test` 和主程序 Rust 测试。界面行为变化运行 `npm run test:ui`；原生功能按开发指南选择对应集成检查。
4. PR 描述说明问题、修改后的行为和实际验证结果。新增权限、数据格式或迁移逻辑需说明边界与失败恢复方式。

代码目录与模块职责见开发指南。应用前端不经过 npm 打包，Node/Python 仅用于开发和测试；新增资源应说明来源，保留第三方许可证。请提交 `Cargo.lock` 与 `package-lock.json`，不要提交构建缓存、用户记忆、浏览器配置、API Key 或 SSH 私钥。

功能建议请先查阅 [开发规划](docs/AGENT_WORKBENCH_DEVELOPMENT.md)，区分已实现功能与规划能力。缺陷报告请附 Windows/WebView2 版本、复现步骤及去除私人信息的日志或最小样本。

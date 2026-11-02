# 第三方组件声明

Dalizi Files 自有代码采用 [MIT License](LICENSE)。下列离线前端资源随源码与应用分发，保留各自许可证；本项目的 MIT 许可不替代它们的条款。

| 组件 | 版本与来源 | 本地许可/说明 |
| --- | --- | --- |
| xterm.js | 5.3.0，[上游](https://github.com/xtermjs/xterm.js/tree/5.3.0) | [MIT](ui/vendor/LICENSE.xterm)，[本地视口释放补丁](ui/vendor/xterm-patches.md) |
| xterm-addon-fit | 0.8.0，[npm](https://www.npmjs.com/package/xterm-addon-fit/v/0.8.0) | [MIT](ui/vendor/LICENSE.xterm-addon-fit)；未修改 addon 实现 |
| PDF.js / pdfjs-dist | 6.4.299，[Mozilla 上游](https://github.com/mozilla/pdf.js) | [Apache-2.0](ui/vendor/pdfjs/LICENSE)，[来源与归档校验值](ui/vendor/pdfjs/README.md) |
| PDF.js CMaps 与字体 | 随上述 pdfjs-dist 分发 | [CMaps](ui/vendor/pdfjs/cmaps/LICENSE)、[Foxit 字体](ui/vendor/pdfjs/standard_fonts/LICENSE_FOXIT)、[Liberation 字体](ui/vendor/pdfjs/standard_fonts/LICENSE_LIBERATION) |
| PDF.js 图像解码与色彩资源 | 随上述 pdfjs-dist 分发 | `ui/vendor/pdfjs/wasm/` 下的 LICENSE 文件及 [ICC 声明](ui/vendor/pdfjs/iccs/LICENSE) |

`xterm.min.js` 与 `xterm-addon-fit.min.js` 文件头记录了原始 npm 版本；`xterm.css` 也保留许可头。升级这些资源时应同时更新来源、版本、校验信息和许可文件，并复核本地补丁。

Rust 依赖及其精确版本记录在 [Cargo.lock](src-tauri/Cargo.lock)，由 Cargo 获取，不将注册表源码复制到仓库。开发检查依赖记录在 [package-lock.json](package-lock.json) 和 [Python 工具依赖](tools/requirements-dev.txt)。开发依赖不等同于应用运行依赖；发布二进制时还应核对对应构建实际使用的传递依赖声明。

内置 SSH 使用锁定的 russh、russh-sftp 及其加密依赖，密码保存调用 Windows Credential Manager；相关许可随二进制发布包收集。WebView2、PowerShell 和兼容模式的 OpenSSH 使用目标机器安装的运行时/程序，未将它们的安装包内嵌到本仓库。

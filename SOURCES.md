# 来源与构建 / Sources and builds

Proxy V2Route 代码采用 GPL-3.0-or-later，第三方组件保留各自许可与署名。浏览器源码为可读 JavaScript、HTML、CSS，直接复制到扩展包。

V2Route-authored code uses GPL-3.0-or-later. Third-party components retain their licenses and notices. Readable browser sources are copied directly into extension packages.

## 来源 / Attribution

- ZeroOmega / SwitchyOmega 集成参考来自 ZeroOmega 3.5.2，提交 `c367db220e2a3af1c65e5afffa4cf42c949f2908`，保留原作者及 GPL 声明。Historical integration reference, with original author and GPL notices retained. [ZeroOmega](https://github.com/zero-peak/ZeroOmega)
- v2rayN 为可选本机节点来源。转换器曾参考 7.25.6 的 `V2rayOutboundService.cs`，当前适配器使用独立规范化模型与协议编译器，此前源码参考记载保留于本项目。Optional local node source and acknowledged adapter reference. [v2rayN](https://github.com/2dust/v2rayN)
- 界面、品牌与连接图标由本项目制作。UI, branding and connection icons are project-authored.

## 依赖 / Dependencies

| 组件 / Component | 版本 / Version | 许可 / License |
| --- | --- | --- |
| flag-icons | 7.6.0 | MIT，`assets/FLAG-ICONS-LICENSE` · [Source](https://github.com/lipis/flag-icons) |
| CPython embedded, Windows amd64 | 3.13.17 | PSF 及随包第三方许可，`licenses/python` · [Distribution](https://www.python.org/ftp/python/3.13.17/) |
| Xray-core, Windows64 | v26.10.31 | MPL-2.0，`licenses/xray` · [Source](https://github.com/XTLS/Xray-core/releases/tag/v26.10.31) |
| parse5 / entities | 7.3.0 / 6.0.1 | MIT，`v2route-ui/vendor/HTML-PARSER-LICENSE.txt` · [Build recipe](vendor-html/README.md) |
| PyYAML | 6.0.3 | MIT，`licenses/pyyaml` · [Source](https://github.com/yaml/pyyaml/tree/6.0.3) |

Python 与 Xray 下载包经 SHA-256 校验。Xray 对应源码、链接模块声明、Go 工具链声明及 SBOM 位于 `licenses/xray`，适配器范围见[出站配置说明](docs/OUTBOUND-ADAPTER.md)。

Python and Xray archives are SHA-256 verified. Xray source references, linked-module notices, Go notices and the SBOM are included under `licenses/xray`. See the outbound adapter guide for supported inputs.

订阅解析使用未修改的 PyYAML 纯 Python 源码；来源、压缩包及逐文件 SHA-256 记录于 `licenses/pyyaml/PROVENANCE.json`，打包时逐项核验。只加载受限节点数据，不执行 YAML 标签、外部提供器或脚本。

The unchanged pure-Python PyYAML sources are vendored and verified against the provenance manifest on every package build. Subscription parsing accepts bounded node data and does not execute YAML constructors, external providers or scripts.

## 构建 / Build

使用 Windows 10/11 x64、Python 3.13 和 Windows .NET Framework C# 编译器，在可写源码目录运行下列命令。构建会下载固定官方依赖。

Use Windows 10/11 x64, Python 3.13 and the Windows .NET Framework C# compiler. Run these commands in a writable source folder to fetch pinned dependencies and build matching packages.

```powershell
python build_runtime.py
python build_core.py
python collect_core_notices.py
python build_host.py
python build_setup.py
python prepare_source_bundle.py
python pack_portable.py --output V2Route-local.zip --store-dir browser-packages
```

每次使用新的输出路径。Firefox 永久安装需 Mozilla 签名；HTML 解析器的固定版本重建步骤见 `vendor-html/README.md`。

Use fresh output paths. Permanent Firefox installation requires Mozilla signing. The pinned HTML parser rebuild instructions are in `vendor-html/README.md`.

# V2Route — notices / 版权与许可声明

Copyright 2026 V2Route contributors. V2Route frontend, controller and local integration source is licensed under GPL-3.0-or-later. See LICENSE and COPYING for the full terms, including the warranty disclaimer. Third-party components retain their own licenses. / V2Route 前端、控制器与本地集成源码以 GPL-3.0-or-later 提供，完整条款及无担保声明见 LICENSE、COPYING；第三方组件保留各自许可。

## Source acknowledgments / 来源致谢
The project originated in local integrations with ZeroOmega 3.5.2 and SwitchyOmega. Their original AUTHORS and GPL notices are retained. AUTHORS describes historical contributors and dependencies, not the current runtime dependency list. The current browser package uses readable V2Route code and does not include the earlier Angular/ZeroOmega engine. / 项目源自 ZeroOmega 3.5.2 / SwitchyOmega 的本地集成，保留其原 AUTHORS 和 GPL 声明。AUTHORS 记录历史贡献者与依赖，不是当前运行依赖清单；当前浏览器包使用可读 V2Route 源码，不包含旧 Angular/ZeroOmega 引擎。

The local companion builds on earlier locally developed route-switching components. Its interoperability work referenced v2rayN 7.25.6 and the public Xray configuration contracts. The current adapter has separate normalization, protocol, transport and security compilation. See SOURCES.md and docs/OUTBOUND-ADAPTER.md in the matching companion source. / 本地组件沿用此前自建线路切换组件；互操作开发曾参考 v2rayN 7.25.6 与公开 Xray 配置规范。当前适配器分别处理规范化、协议、传输和安全配置，来源与接口详见配套源码说明。

## Components / 组件
- flag-icons 7.6.0: country flags and country-name data, MIT; https://github.com/lipis/flag-icons. Full license: zero-assets/FLAG-ICONS-LICENSE. / 国旗与国家名称数据，保留 MIT 许可。
- V2Route interface artwork, including the neutral follow-source icon, is supplied under GPL-3.0-or-later. / V2Route 界面图形及通用跟随标识按 GPL-3.0-or-later 提供。
- The separately installed Windows companion includes CPython and Xray-core under their respective licenses, with linked dependency notices and corresponding sources. These executables are not included in the browser extension. / 独立 Windows 组件包含各自许可下的 CPython、Xray-core，附依赖声明与对应源码；浏览器扩展不包含这些程序。

Redistributions must retain applicable notices and provide matching source as required by the licenses. V2Route is independent of v2rayN, Google and Mozilla. / 再分发须按许可保留适用声明并提供对应源码；V2Route 与 v2rayN、Google、Mozilla 无隶属关系。

HTML report parsing: parse5 7.3.0 and entities 6.0.1, MIT. See v2route-ui/vendor/HTML-PARSER-LICENSE.txt and the matching vendor-html build recipe in the source distribution.

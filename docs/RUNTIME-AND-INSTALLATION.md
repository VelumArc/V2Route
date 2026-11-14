# 运行环境 / Runtime requirements

Proxy V2Route 1.2.43

| 项目 / Component | 要求 / Requirement |
| --- | --- |
| Windows | 10 / 11 x64 |
| .NET Framework | 4.5.2+ |
| Chrome | 120+ |
| Firefox | 140+，当前测试包临时加载 / Temporary loading for the unsigned test package |

完整 Windows 包包含 Python、Xray 和 `local.v2route` Native Messaging 宿主。组件按 Windows 用户注册，扩展身份需与宿主白名单匹配，安装目录需长期保留且可写。

The complete Windows package includes Python, Xray and the `local.v2route` Native Messaging host. Registration is per Windows account, the extension identity must match the host allowlist, and the installation folder must remain writable and available.

导入节点通过随包核心运行。“跟随 v2rayN”需要其本地代理正在运行；可在“设置”选择 v2rayN 文件夹或重新扫描。

Imported nodes run through the bundled core. Follow v2rayN requires its running local proxy. Settings provides folder selection and rescan controls.

安装、升级、扩展加载与停用见[安装说明](../INSTALL.md)。See the installation guide for setup, upgrades and removal.

Tool dialog cleanup: Chrome requires `browsingData` to remove only HTTP/CacheStorage caches for configured provider origins on close. Reopening waits for pending deletion. Login cookies and persistent user stores remain; unrelated origins are excluded. Firefox reports scoped deletion as unsupported rather than clearing browser-wide cache. The extension update may request the added Chrome permission.

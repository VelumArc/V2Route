# Proxy V2Route

浏览器独立选线，无需切换 v2rayN 主线路。  
Independent browser routes, with local v2rayN nodes or your own proxies.

**当前版本 1.2.43** · Windows 10/11 x64 · Chrome 120+ / Firefox 140+  
浏览器商店待提交，Firefox 测试包未签名。Store submission pending, Firefox test package unsigned.

## 功能 / Features

- 保存情景，长按拖动排序，从工具栏切换节点、跟随 v2rayN、直连或系统代理。Save, reorder and switch profiles from the toolbar.
- 节点分组、搜索与导入，支持多层代理、逐层检测与网站分流。Import nodes, configure multi-hop chains and diagnose each path boundary.
- 单节点和分组批量测速，查看 HTTP 延迟、实时下载／上传与最终平均值。Test individual nodes or groups through their own routes.
- 本地分组和订阅导入，可自定义自动更新时间，代理优先、失败再直连。Local groups and subscriptions with optional scheduled refresh and proxy-first fallback.
- 自动检测出口 IP、读取已授权的 Ping0 公开报告。Check the exit IP and load Ping0 reports with permission.
- 持续 Ping、TCPing、MTR，以及实时下载／上传测速、HTTP 延迟与 52 个分类网站连通检测。Live download/upload, HTTP latency and 52 categorized website checks.
- 中英文界面与深浅主题。Chinese/English and light/dark themes.

## 安装 / Install

1. 运行配套 Windows 包中的 `V2Route-Setup.exe`，点击安装。Run the matching Windows companion setup.
2. 启用 Chrome 解压版扩展或 Firefox 临时测试包。Load the Chrome unpacked extension or Firefox temporary add-on.
3. 选择线路或导入节点，保存并切换到情景。Choose a route, save a profile and apply it.

安装与升级步骤见[安装说明](INSTALL.md)，源码构建步骤见[来源与构建](SOURCES.md)。  
See the installation and source-build guides for detailed steps.

## 使用说明 / Guides

- [节点导入 / Proxy imports](docs/NODE-IMPORT.md)
- [IP 与网络测试 / IP and network tests](docs/IP-TOOLS.md)
- [权限 / Permissions](docs/PERMISSIONS.md) · [隐私 / Privacy](docs/PRIVACY.md)

反馈请通过 [Issues](https://github.com/VelumArc/V2Route/issues) 或 1313333@gmail.com。  
Support via Issues or email.

## 许可 / License

[GPL-3.0-or-later](LICENSE-GPL-3.0.txt)。第三方来源与许可见 [SOURCES.md](SOURCES.md)。  
Third-party attribution and licenses are listed in the source guide.

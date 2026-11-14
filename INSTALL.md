# 安装与升级 / Installation

**Proxy V2Route 1.2.43** · Windows 10/11 x64 · .NET Framework 4.5.2+ · Chrome 120+ / Firefox 140+

本地验收包包含配套 Windows 组件及浏览器扩展。公开仓库提供当前源码；需要自行生成安装包时，请按[来源与构建](SOURCES.md)操作。

The local acceptance package includes the matching Windows companion and browser extensions. The public repository provides current source; follow the [build guide](SOURCES.md) to produce packages yourself.

## 本地组件 / Windows companion

1. 运行配套 `V2Route-Setup.exe`。独立安装器解压至选择的新空文件夹，完整 ZIP 内的入口直接注册当前目录。
2. 点击“安装”，为当前 Windows 用户注册组件。完整包包含 Python 与 Xray。
3. 在扩展“设置”中检查连接。需要读取 v2rayN 时，可重新扫描或选择其文件夹。

Run the matching setup, choose a permanent writable folder and click Install. The complete package includes Python and Xray. Use extension Settings to check the connection or locate v2rayN. Imported nodes run through the companion independently of v2rayN.

## 浏览器扩展 / Browser extension

### Chrome

解压 `Proxy-V2Route-Chrome-1.2.43.zip`，在 `chrome://extensions` 开启开发者模式，点击“加载已解压的扩展程序”，选择含 `manifest.json` 的目录。完整安装包中对应 `chrome-extension`。

Extract the Chrome ZIP to a permanent folder. Enable Developer mode at `chrome://extensions`, choose **Load unpacked** and select the directory containing `manifest.json`.

### Firefox

当前测试包未签名。进入 `about:debugging` →“此 Firefox”→“临时载入附加组件”，选择 `Proxy-V2Route-Firefox-1.2.43-unsigned.xpi` 或 `firefox-extension/manifest.json`。临时加载在浏览器重启后失效，永久安装需要 Mozilla 签名。

Load the unsigned test XPI through `about:debugging` → **This Firefox** → **Load Temporary Add-on**. Temporary loading lasts until Firefox restarts. Permanent installation requires Mozilla signing.

每个浏览器用户需分别启用扩展，无痕访问需在扩展详情中允许。

Enable the extension separately in each browser profile and allow private-window access when needed.

## 升级 / Upgrade

将匹配的新完整包装入新空文件夹，运行安装器并确认升级。安装器校验已有安装归属，迁移组件设置、导入节点、线路绑定及端口，仅重启已验证的本地组件。随后更新浏览器扩展，保留相同扩展身份并重新加载。

Install the matching complete package into a new empty folder and confirm the verified upgrade. Setup preserves companion settings, imported nodes, route bindings and ports, then restarts the verified companion. Update and reload the browser extension with the same identity.

扩展会尝试恢复已保存的线路；节点已移除时回退到“跟随 v2rayN”。仍不可用时，在情景的“线路选择区”中重新选择。

The extension recovers saved routes where possible and falls back to Follow v2rayN when a node has been removed. Reselect an unavailable route under **route selector**.

## 情景与线路 / Profiles

- 在“情景模式”新建情景，或从“节点库”点击“创建情景”。Choose **New profile** or **Create profile** in Node Library.
- 新建情景默认只选落地节点。需要前置或多层代理时，使用标题区的“设置前置代理”或“多层链式代理”；再次点击已启用的模式可回到仅出口。New profiles start with an exit node; use the header mode buttons for a predecessor or multiple hops. Click the active mode again to return to exit-only routing.
- 保存后点击“切换到此情景”，也可从工具栏切换。Save, then apply the profile from its editor or the toolbar.
- “跟随 v2rayN”使用其正在运行的本地入口。Follow v2rayN uses its running local endpoint.

## 备份与停用 / Backup and removal

“设置”可导出浏览器情景。导入节点凭据另存于组件的 `private` 目录，个人备份需妥善保管。停用组件前切换至“直连”或“系统”，再运行 `uninstall.cmd` 解除宿主注册。

Export browser profiles in Settings. Imported credentials are stored separately in the companion’s `private` folder. Keep personal backups private. Switch to Direct or System before running `uninstall.cmd` to unregister the companion.

# Import proxies / 导入代理

Open **Node Library → Import proxies**. The Windows companion and bundled Xray run imported proxies without an installed or running v2rayN.
从 **节点库 → 导入代理** 开始。Windows 本地组件与随包 Xray 负责连接，无需安装或运行 v2rayN。

| Format / 格式 | Supported input / 支持内容 |
| --- | --- |
| VMess / VLESS | vmess:// Base64 JSON; vless:// UUID links. RAW/TCP, WS, gRPC, HTTPUpgrade, XHTTP and applicable TLS/Reality. VLESS URI uses encryption=none; other supported encryption requires Xray JSON. / 其他核心支持的加密参数使用 Xray JSON。 |
| HTTP / HTTPS / SOCKS5 | URI with optional percent-encoded username/password. / 可带 URL 编码账号密码。 |
| Trojan | trojan://password@host:port with supported TLS/Reality and transport parameters. / 支持对应的安全与传输参数。 |
| Shadowsocks | SIP002 or legacy Base64 ss://; cipher checked by Xray. External plugins are not bundled. / 支持 SIP002 与旧 Base64，不含独立插件运行时。 |
| Hysteria2 | hysteria2:// or hy2://, TLS and optional Salamander. Unsupported port-hopping/bandwidth link options report errors. / 支持 TLS、Salamander，未适配的跳跃或带宽参数明确报错。 |
| WireGuard | wireguard:// / wg:// or Xray outbound JSON. Userspace, no system TUN. / 用户态核心，不创建系统 TUN。 |
| MASQUE | Xray outbound JSON with protocol masque and corresponding transport/TLS. / 核心出站 JSON。 |
| Account lines / 账密行 | host:port:user:password, user:password@host:port, or host:port defaults to HTTP; explicitly use socks5:// for SOCKS. / 无前缀默认 HTTP，SOCKS 请明确填写协议。 |
| JSON / Base64 | One outbound, arrays, outbounds/proxies arrays, simple HTTP/SOCKS5 account JSON, or a Base64 link list. / 单出站、数组、常见账密对象或 Base64 链接列表。 |

```text
http://user:password@proxy.example:8080#Office
https://user:password@proxy.example:443
socks5://user:password@proxy.example:1080
proxy.example:8080:user:password
trojan://password@proxy.example:443?sni=proxy.example
hy2://password@proxy.example:443?sni=proxy.example
```

URL-encode special characters in credentials. Each import accepts up to 500 proxies / 256 KiB. The whole batch is parsed and checked by Xray before saving. Configuration validation does not prove the remote server is online.
账号密码特殊字符须做 URL 编码。每次最多 500 个代理、256 KiB，整批解析和核心校验通过后才保存；校验通过不代表远端在线。

SOCKS4 is available as a browser manual proxy without authentication; the bundled core uses SOCKS5. TUIC, AnyTLS, Naive and separate plugin runtimes are not bundled. Imports are node data, not full system configuration. Local file/external outbound references and unsupported account/security fields are rejected. Independent import support differs from v2rayN database-record compatibility; see [adapter scope](OUTBOUND-ADAPTER.md).
SOCKS4 可作为无认证浏览器手动代理，随包核心使用 SOCKS5。不包含 TUIC、AnyTLS、Naive 或外部插件运行时。导入节点不接受完整系统配置、本地文件或外部线路引用；不支持的账密、安全字段明确报错。独立导入与 v2rayN 数据库记录适配是不同入口，范围见适配说明。

## Subscriptions and groups / 订阅与分组

Use the separate **Subscription link** tab to fetch an HTTP/HTTPS subscription URL; paste ordinary HTTP proxy links in the proxy-content tab. Create a local group before importing or choose a group when saving the subscription. Supported subscription bodies include plain/Base64 proxy lists, Xray outbound JSON, SIP008 and supported Clash/Mihomo `proxies` entries. Unsupported protocols or fields fail the whole update with a clear result, preserving the previous nodes.

订阅链接使用独立的“订阅链接”入口，HTTP 代理链接仍在“代理内容”中粘贴。可先新建本地分组，或保存订阅时选择分组。兼容明文／Base64 节点列表、Xray 出站 JSON、SIP008 和已适配的 Clash/Mihomo `proxies` 节点；不支持的协议、字段会使整次更新失败，保留上次有效节点。

Automatic refresh is optional and off by default. Set an interval from 5 minutes to 30 days. **Proxy first** uses the current browser route; a successful fetch, parse and validation ends the update. Only failure triggers a direct attempt. Proxy-only and direct-only are also available. Inline PAC scripts cannot be resolved by this fetcher: proxy-only reports unavailable, while proxy-first may fall back to direct. The browser and Windows companion must be available; the next browser session resumes overdue enabled subscriptions.

自动更新默认关闭，间隔可设为 5 分钟至 30 天。“优先通过代理”按当前浏览器线路请求，获取、解析及校验成功后立即结束；失败才直连重试，也可选择只走代理或只直连。内联 PAC 无法由此下载器求值：仅代理时提示不可用，代理优先时可回退直连。更新需要浏览器及本地组件可用，下次浏览器会话会继续处理已启用的到期订阅。

Subscription responses are bounded to 1 MiB and validated before an atomic commit. URLs, tokens and credentials stay in the private companion store. Node identities remain stable across group renames and refreshes. Nodes still referenced by saved profiles or chains are retained when a provider removes them. Removing a subscription through the UI keeps its nodes.

订阅响应上限 1 MiB，校验通过后才整批写入。链接、令牌和账密仅存于本地组件私有库。改分组名及刷新保持节点标识稳定；服务商删掉但仍被已保存情景或链路引用的节点会保留。界面删除订阅时保留其节点。

## Node measurements / 节点测速

The library measures individual nodes, selected nodes or the current group. Quick tests measure HTTP latency. Full tests add download and upload with separate live rates and completed averages. Tests run through each selected node and its inherited group predecessor chain using temporary authenticated local cores. They do not apply a browser profile or change v2rayN's active route. Quick tests allow up to three concurrent nodes; full tests run sequentially to avoid bandwidth contention. The displayed traffic budget is per direction and includes all selected targets; extra latency requests are small. Stop, page closure and native-session loss cancel the owned test cores.

节点库支持单节点、已选节点和当前分组检测。快速检测测 HTTP 延迟，完整测速增加下载、上传实时速率及完成后的平均值。每个节点经其自身及继承的分组前置链路测试，使用临时认证本地核心，不切换浏览器情景或 v2rayN 主线路。快速检测最多三个节点并发，完整测速逐个执行，避免相互争抢带宽。流量预算按每个方向和全部目标计算，另有少量延迟请求；停止、关闭页面或本地会话断开会取消所属测试核心。

## Private storage / 私有存储

Imported credentials stay in the companion’s private node database, restricted to the Windows user and SYSTEM. Browser catalogs expose labels and route metadata, not passwords or raw links. Manual proxy credentials are also saved in browser-local profiles and profile exports. Protect exports and backups. The developer receives none of these credentials. [Privacy](PRIVACY.md).
导入凭据保存在组件私有节点库，仅限当前 Windows 用户与 SYSTEM 访问；节点列表不返回密码或原始链接。手动代理账密还保存于浏览器本地情景及其导出文件，请妥善保管。开发者不接收这些凭据。

Reassign all bindings before deleting an imported node. Removing a profile releases its own port without changing v2rayN’s main route.
删除导入节点前须解除所有绑定；删除情景只释放自己的端口，不改变 v2rayN 主线路。

SOCKS URI userinfo accepts plain percent-encoded user:password or Base64(user:password), including URL-safe encoding and omitted padding. URI schemes are case-insensitive. In Base64 form the first colon separates user and password; use percent-encoded plain userinfo for a username containing a colon. / SOCKS 链接支持转义后的明文账密或 Base64 账密，兼容 URL-safe 和省略补位。协议名不区分大小写。Base64 以第一个冒号分隔账号与密码；账号本身含冒号时应使用百分号转义的明文链接。

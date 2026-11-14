# Privacy / 隐私

Proxy V2Route keeps node links, credentials and route settings in the local companion. It does not send these records to the developer. Browser traffic follows the applied browser proxy. No analytics or result history is collected by the extension.

节点、账密和线路配置保存在本机配套组件中，不上传给开发者。浏览器流量经过所选代理；扩展不收集统计，也不保留检测历史。

Opening the popup or IP workspace performs a bounded ipify exit-IP check. Ping0 reports require optional site access. IP tools pre-fill the current browser exit IP; Globalping sends the displayed target to up to three probes in the selected region only after Start, including a China option. Probe availability varies; ICMP loss alone does not establish filtering. Domain checks use GreatFire. FAST.com is a separate embedded speed provider. Each provider receives normal connection data and handles it under its own privacy policy.

弹窗或 IP 工具页会进行有时限的 ipify 出口检测。Ping0 报告需允许对应站点访问。IP 工具默认填写当前出口 IP；Globalping 点击开始才向所选区域的最多三个探针发送目标，支持选择中国；可用探针会变化，ICMP 丢包本身不能证明被墙。域名检测使用 GreatFire，FAST.com 为独立嵌入测速站点。服务商会接收常规连接信息，并按自身政策处理。

Website tests contact only selected, visible public homepages/icons after Start, with four concurrent credential-free requests at most. A response confirms browser reachability, not account access, HTTP success or regional unlocking. Timeouts and browser restrictions may produce an unconfirmed result.

网站列表点击开始后才检测当前分类中勾选的地址，最多四个并发请求、不携带账号凭据。收到响应不代表账号可用、HTTP 成功或地区解锁；超时和浏览器限制都可能导致无法确认。

Cloudflare speed tests use small HTTP latency samples and selected 10/50/100 MiB download/upload limits. Both mode transfers up to the selected size in each direction. Per-second rates and final results remain in dialog memory. Closing or hiding the page cancels local tests; already submitted remote measurements may finish at the provider.

Cloudflare 测速包含少量 HTTP 延迟样本，以及每项 10/50/100 MiB 的下载、上传上限。双向模式每个方向各使用所选流量。每秒速率和结果只保存在弹窗内存；关闭或隐藏页面会取消本地测试，已提交的远端测量可能仍在服务商处完成。

Optional scripting access is confined to user-opened Ping0 tool frames. It adds secure embedded-partition attributes to provider-created session cookies without solving challenges, logging tokens or exporting cookie values. Verification remains user-controlled. A single bounded reload may recover a stalled Ping0 transition. Frame and security policies remain in force.

可选脚本权限仅用于本人打开的 Ping0 工具框，为网站自己创建的会话 Cookie 补充安全分区属性，不代答验证、不记录或导出令牌。Ping0 过渡卡住时最多补一次重载；网站的嵌入和安全策略仍有效。

A failed popup connectivity check does not prove the selected node is offline: the check endpoint, current browser proxy setting or browser restrictions may fail independently. 弹窗检测失败不等于节点离线，也可能是检测端点、浏览器代理设置或浏览器限制导致。

Per-layer chain diagnostics run a separate temporary local core only after Test is clicked. They contact api.ipify.org through each cumulative path, do not change the active route and delete temporary credentials/configuration after each bounded probe. Results identify a failed path boundary, not proof that a single server is offline.

逐层链路检测仅在点击检测后启动临时本地核心，通过各段累积路径访问 api.ipify.org；不更改当前使用线路，每次有时限的探测结束即清理临时配置和凭据。失败表示该路径边界未连通，不能单凭它断定某台服务器离线。

Node-library tests contact Cloudflare through the selected node and inherited predecessor chain. Full tests transfer the selected 10/25/50/100 MiB in each direction; group totals are shown before starting. Results stay in the open workspace. Temporary authenticated test cores and configuration are removed when the owned native session closes. Node lists and proxy credentials are not sent as test payloads.

节点库测速通过所选节点及其继承前置链路访问 Cloudflare。完整测速每个方向使用所选 10/25/50/100 MiB，开始前显示分组总量；结果仅保存在当前工作区内存。所属本地会话关闭时回收临时认证核心和配置；不会把节点列表或代理账密作为测速内容发送。

Subscription URLs and tokens are saved only in the private companion database. The extension stores only whether user-enabled updates exist and a shared browser alarm. Refresh contacts the subscription provider using the chosen policy; proxy-first attempts direct access only after the proxy attempt fails. The provider receives normal request information, including its subscription token and the network address used to reach it. No Windows or Codex recurring task is created.

订阅链接及令牌只保存于组件私有库；扩展只缓存是否启用自动更新并使用一个共享浏览器定时器。更新按所选策略请求订阅服务商，代理优先仅在代理失败后直连；服务商会接收其订阅令牌、请求信息和访问来源地址。不创建 Windows 或 Codex 循环任务。

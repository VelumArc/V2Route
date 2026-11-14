# Outbound adapter / 出站配置适配器

`outbound_adapter.py` converts supported node records into Xray outbound configuration. It separates record normalization from protocol, transport and security compilation. The caller handles database access, process startup and route-chain assembly.

`outbound_adapter.py` 将支持的节点记录转换为 Xray 出站配置，将记录规范化与协议、传输、安全配置生成分离。数据库访问、进程启动及线路链组装由调用方处理。

## Structure / 结构

- `normalize_record()` produces the internal `Node`, `Transport` and `Security` models. / 将外部记录转换为内部节点、传输及安全模型。
- Protocol compilers support VMess, VLESS, Shadowsocks, HTTP(S), SOCKS5 and Trojan v2rayN records. Independent imports additionally support Hysteria2, WireGuard and MASQUE; see NODE-IMPORT.md. / 记录转换支持 VMess、VLESS、Shadowsocks、HTTP(S)、SOCKS5、Trojan；独立导入另支持 Hysteria2、WireGuard、MASQUE，见节点导入说明。
- Transport builders support RAW/TCP, WebSocket, HTTPUpgrade, gRPC and XHTTP, with separate TLS and Reality builders. / 支持 RAW/TCP、WebSocket、HTTPUpgrade、gRPC、XHTTP，TLS 与 Reality 单独生成。
- `routes.build_choice()` assembles supported group predecessor chains, including the XHTTP download leg. / 组装支持的分组前置链，包括 XHTTP 下载侧前置。

Credentials enter the private core configuration, not the browser catalog. Default model representations omit credentials and option objects. / 凭据仅进入私有核心配置，不返回浏览器节点目录；模型默认调试表示省略凭据及参数对象。

## Compatibility rules / 兼容规则

- External fields such as `ConfigType`, `ProtoExtra` and `TransportExtra` are treated as a versioned input contract. / `ConfigType`、`ProtoExtra`、`TransportExtra` 等外部字段作为输入兼容契约。
- Known inactive defaults are tolerated: VMess `auto`, VLESS `none`, WireGuard MTU `1280`, RAW/KCP header `none`, gRPC `gun`, XHTTP `auto`. Unsupported nondefault options are rejected. / 兼容这些未启用分支中的已知默认值，不支持的非默认参数会报错。
- Explicit `Sni` takes precedence. If absent, the saved HTTP authority is used as a TLS server-name compatibility fallback; otherwise Xray uses its endpoint-domain fallback. Node addresses are not inferred from country names. / 显式 `Sni` 优先，否则以已保存的 HTTP authority 兼容作为 TLS 服务器名，再由 Xray 使用地址域名回退；不会按国家名猜测节点地址。
- Supported gRPC keepalive and application fields use validated numeric or boolean values, including `0` and `False`. / 支持的 gRPC 保活与应用字段验证数字、布尔类型，保留 `0` 与 `False`。
- XHTTP `extra` supports the pinned core’s documented top-level, multiplexing and supported download TLS/Reality/socket fields. Unknown fields, custom `h2Params` and unsupported nested internals are rejected. Xray `-test` also validates generated configurations before startup. / XHTTP `extra` 支持固定核心的顶层、复用及规定的下载侧字段；未知字段、自定义 `h2Params` 和不支持的嵌套结构会报错，启动前另由 Xray 校验配置。
- Full-node extra/final-mask/custom-certificate settings, disabled certificate verification, node-local Mux and nonzero legacy VMess AlterId are unsupported. / 不支持整节点额外配置、final-mask、自定义证书、关闭证书校验、节点 Mux 或非零旧 VMess AlterId。
- TLS `echConfigList` is preserved; `echForceQuery` is not emitted because it is absent from the pinned core schema. / 保留 TLS `echConfigList`，固定核心结构不存在的 `echForceQuery` 不输出。
- Hysteria2/TUIC v2rayN database records are outside this adapter. Independent Hysteria2 links and core JSON use a separate importer. Unsupported nodes remain visible with an explanation. / 数据库记录适配器未覆盖 Hysteria2/TUIC；独立 Hysteria2 链接及核心 JSON 使用单独导入流程；不支持的节点仍显示原因。

## References and provenance / 参考与来源

The adapter uses project-authored normalization and protocol compilers against the supported external record contract and public Xray configuration schema. An earlier translator referenced v2rayN 7.25.6 `V2rayOutboundService.cs`; that prior source exposure remains acknowledged. This is not a strict clean-room claim. Project and dependency attribution is in [SOURCES.md](../SOURCES.md).

适配器按外部记录契约与公开 Xray 结构编写规范化和协议编译器。此前转换器曾参考 v2rayN 7.25.6 的 `V2rayOutboundService.cs`，保留此前接触源码的事实，不宣称严格隔离开发。项目及依赖归因见来源说明。

Official configuration references / 官方配置参考：

- [VMess](https://xtls.github.io/en/config/outbounds/vmess.html), [VLESS](https://xtls.github.io/en/config/outbounds/vless.html), [Shadowsocks](https://xtls.github.io/en/config/outbounds/shadowsocks.html), [SOCKS](https://xtls.github.io/en/config/outbounds/socks.html), [Trojan](https://xtls.github.io/en/config/outbounds/trojan.html).
- [Transport](https://xtls.github.io/en/config/transport.html), [TLS](https://xtls.github.io/en/config/transports/tls.html), [Reality](https://xtls.github.io/en/config/transports/reality.html).
- [WebSocket](https://xtls.github.io/en/config/transports/websocket.html), [HTTPUpgrade](https://xtls.github.io/en/config/transports/httpupgrade.html), [gRPC](https://xtls.github.io/en/config/transports/grpc.html), [XHTTP](https://github.com/XTLS/Xray-core/discussions/4113).

The target schema is Xray v26.10.31, including `infra/conf/transport_method.go`, `transport_security.go`, `transport_internet.go` and `transport_sockopt.go`. Xray remains a separately licensed third-party core.

目标结构为 Xray v26.10.31，包括上述配置定义文件。Xray 作为独立许可的第三方核心使用。

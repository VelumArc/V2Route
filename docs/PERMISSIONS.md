# Permissions / 权限

- `proxy`: apply the selected browser route / 应用所选浏览器代理。
- `storage`: save browser profiles and UI preferences locally / 本地保存情景和界面偏好。
- `nativeMessaging`: connect to the local Windows companion / 连接本机 Windows 配套组件。
- `alarms`: one shared browser alarm refreshes subscriptions only after automatic updates are enabled for a subscription. Custom intervals and disabled state are respected; no Windows or Codex scheduled task is created. / 仅为本人启用自动更新的订阅使用一个共享浏览器定时器，遵循自定义间隔；不创建 Windows 或 Codex 定时任务。
- Chrome-only `browsingData`: clear HTTP cache and CacheStorage for an allowlisted tool origin after its dialog closes. It never clears browser-wide caches, other origins or cookies/login stores. Firefox omits this permission because it cannot safely scope cache removal. / Chrome 关闭工具弹窗后清理对应来源的缓存，不清其他网站或登录信息；Firefox 无法安全限定范围，因此不使用该权限。
- Optional `scripting`, `https://ping0.cc/*`: only after site permission is granted, preserve provider-created embedded sessions and adapt Ping0 report presentation. No cookie/token export, challenge automation or global cookie-setting changes. / 可选站点与脚本权限仅用于对应工具的嵌入会话和报告展示，不导出 Cookie、不代答验证、不改变全局 Cookie 设置。

Other public tools use ordinary browser requests or contained frames, loaded only after user action. No node-list or credential upload is performed by these tools. / 其他公开工具仅在本人操作后发送普通请求或加载嵌入页，不上传节点列表或账密。

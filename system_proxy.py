"""Read the current user's Windows proxy without changing it or starting a route.

WinHttpGetIEProxyConfigForCurrentUser reads the active WinINET connection, unlike
the machine WinHTTP default or a guessed registry location. PAC/WPAD resolution
is per URL and cannot be represented by this fixed-settings snapshot.
"""
import ctypes
import ipaddress
import os
import re


class SystemProxyError(ValueError):
    pass


def fail(en, zh):
    raise SystemProxyError(en + ' / ' + zh)


class _IEConfig(ctypes.Structure):
    _fields_ = [('auto', ctypes.c_int), ('pac', ctypes.c_void_p),
                ('proxy', ctypes.c_void_p), ('bypass', ctypes.c_void_p)]


def read_windows_config(query=None, free=None, last_error=None):
    """The injectable OS boundary also permits tests without reading user data."""
    if query is None:
        if os.name != 'nt':
            fail('System rules require the Windows companion', '系统代理规则需要 Windows 本地组件')
        winhttp = ctypes.WinDLL('winhttp', use_last_error=True)
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        query = winhttp.WinHttpGetIEProxyConfigForCurrentUser
        query.argtypes = [ctypes.POINTER(_IEConfig)]
        query.restype = ctypes.c_int
        free = kernel.GlobalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        last_error = ctypes.get_last_error
    value = _IEConfig()
    try:
        if not query(ctypes.byref(value)):
            # ERROR_FILE_NOT_FOUND explicitly means no IE/WinINET settings.
            if last_error() == 2:
                return {'autoDetect': False, 'pacUrl': '', 'proxy': '', 'bypass': ''}
            fail('Cannot read Windows system proxy settings', '无法读取 Windows 系统代理设置')
        return {'autoDetect': bool(value.auto),
                **{key: ctypes.wstring_at(ptr) if ptr else '' for key, ptr in
                   [('pacUrl', value.pac), ('proxy', value.proxy), ('bypass', value.bypass)]}}
    finally:
        # Keep pointer addresses (not c_wchar_p-converted strings) for GlobalFree.
        for ptr in (value.pac, value.proxy, value.bypass):
            if ptr:
                free(ptr)


def _host(value):
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        if ':' in value or '%' in value:
            fail('Unsupported system proxy host', '系统代理主机格式不受支持')
    # Python's legacy IDNA codec differs from browser UTS46 for some names.
    # Require explicit ASCII/punycode instead of silently choosing another host.
    if not value.isascii():
        fail('Use an ASCII or punycode system proxy host', '系统代理主机请使用 ASCII 或 Punycode 地址')
    name = value.lower()
    if len(name) > 253 or not all(re.fullmatch(r'[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?', v)
                                  for v in name.rstrip('.').split('.')):
        fail('Invalid system proxy host', '系统代理主机无效')
    return name


def _port(value):
    if not re.fullmatch(r'[0-9]{1,5}', value) or not 1 <= int(value) <= 65535:
        fail('Invalid system proxy port', '系统代理端口无效')
    return int(value)


def _endpoint(value, default='http'):
    scheme = default
    if '://' in value:
        scheme, value = value.split('://', 1)
        scheme = scheme.lower()
    if scheme not in ('http', 'https', 'socks4', 'socks5'):
        fail('Unsupported system proxy transport', '系统代理传输协议不受支持')
    if not value or value.endswith(':') or re.search(r'[\s/@?#\\;,]', value):
        fail('Unsupported system proxy address or authentication', '系统代理地址或认证格式不受支持')
    default_port = {'http': 80, 'https': 443, 'socks4': 1080, 'socks5': 1080}[scheme]
    match = re.fullmatch(r'\[([^\]]+)\](?::([0-9]+))?', value)
    if value.startswith('['):
        if not match:
            fail('Invalid system proxy IPv6 address', '系统代理 IPv6 地址无效')
        host, port = match.groups()
        try:
            host = str(ipaddress.IPv6Address(host))
        except ValueError:
            fail('Invalid system proxy IPv6 address', '系统代理 IPv6 地址无效')
    else:
        if value.count(':') > 1:
            fail('Bracket the system proxy IPv6 address', '请为系统代理 IPv6 地址添加方括号')
        host, _, port = value.partition(':')
    return {'scheme': scheme, 'host': _host(host), 'port': _port(port) if port else default_port}


def _proxies(value):
    parts = [part.strip() for part in value.split(';') if part.strip()]
    if not parts:
        fail('Invalid system proxy configuration', '系统代理配置无效')
    if len(parts) == 1 and '=' not in parts[0]:
        return {'fallback': _endpoint(parts[0])}
    out = {}
    for part in parts:
        key, sep, endpoint = part.partition('=')
        key = key.strip().lower()
        if not sep or key not in ('http', 'https', 'ftp', 'socks'):
            fail('Unsupported system proxy mapping', '系统代理映射格式不受支持')
        target = 'fallback' if key == 'socks' else key
        if target in out:
            fail('Duplicate system proxy mapping', '系统代理映射重复')
        out[target] = _endpoint(endpoint.strip(), 'socks4' if key == 'socks' else 'http')
    return out


def _bypass(value):
    out = []
    for token in re.split(r'[;,\s]+', value.strip()):
        if not token:
            continue
        if token.lower() == '<local>':
            out.append({'kind': 'local'})
            continue
        if token.endswith(':'):
            fail('Invalid system proxy bypass port', '系统代理绕过端口无效')
        # In particular <-loopback> cannot undo Chrome's implicit PAC bypass.
        if '<' in token or '>' in token or '/' in token.replace('://', ''):
            fail('Unsupported system proxy bypass rule', '系统代理绕过规则不受支持')
        record = {}
        if '://' in token:
            scheme, token = token.split('://', 1)
            if scheme.lower() not in ('http', 'https', 'ftp', 'ws', 'wss'):
                fail('Unsupported system proxy bypass scheme', '系统代理绕过协议不受支持')
            record['scheme'] = scheme.lower()
        if token.startswith('['):
            match = re.fullmatch(r'\[([^\]]+)\](?::([0-9]+))?', token)
            if not match:
                fail('Invalid system proxy IPv6 bypass', '系统代理 IPv6 绕过规则无效')
            host, port = match.groups()
            try:
                address = ipaddress.IPv6Address(host)
            except ValueError:
                fail('Invalid system proxy IPv6 bypass', '系统代理 IPv6 绕过规则无效')
            record.update(kind='ip', host=address.exploded.replace(':', ''))
        else:
            if token.count(':') > 1:
                # Unbracketed IPv6 is accepted only without a port.
                try:
                    address = ipaddress.IPv6Address(token)
                except ValueError:
                    fail('Invalid system proxy bypass', '系统代理绕过规则无效')
                record.update(kind='ip', host=address.exploded.replace(':', ''))
                port = None
            else:
                host, _, port = token.partition(':')
                try:
                    address = ipaddress.IPv4Address(host)
                    record.update(kind='ip', host=str(address))
                except ValueError:
                    if host.startswith('.'):
                        host = '*' + host
                    if not host or len(host) > 253 or re.search(r'[^A-Za-z0-9_.*-]', host):
                        fail('Unsupported system proxy bypass host', '系统代理绕过主机格式不受支持')
                    record.update(kind='host', host=host.lower())
        if port:
            record['port'] = _port(port)
        out.append(record)
    if len(out) > 500:
        fail('Too many system proxy bypass rules', '系统代理绕过规则过多')
    return out


def get_system_proxy(reader=None):
    try:
        raw = (reader or read_windows_config)()
    except SystemProxyError:
        raise
    except Exception:
        fail('Cannot read Windows system proxy settings', '无法读取 Windows 系统代理设置')
    if not isinstance(raw, dict) or type(raw.get('autoDetect')) is not bool:
        fail('Invalid Windows system proxy response', 'Windows 系统代理返回无效')
    for key in ('pacUrl', 'proxy', 'bypass'):
        item = raw.get(key)
        if not isinstance(item, str) or len(item) > 32768 or '\x00' in item:
            fail('Invalid Windows system proxy response', 'Windows 系统代理返回无效')
    if raw['autoDetect'] or raw['pacUrl'].strip():
        fail('System PAC/WPAD cannot be embedded in automatic rules; use the System profile directly',
             '系统 PAC/WPAD 不能嵌入自动规则，请直接切换到系统代理情景')
    proxy = raw['proxy'].strip()
    if not proxy:
        return {'version': 1, 'mode': 'direct', 'proxies': {}, 'bypass': []}
    return {'version': 1, 'mode': 'fixed', 'proxies': _proxies(proxy), 'bypass': _bypass(raw['bypass'])}

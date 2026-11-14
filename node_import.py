"""Validated proxy ingestion. Credentials never enter catalog replies."""
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit, parse_qsl, unquote
import uuid

ROOT = Path(__file__).resolve().parent
STORE = ROOT / 'private/imported-nodes.json'
MAX_TEXT = 256 * 1024
MAX_NODES = 500

def error(message):
    raise ValueError(message)

def text(value, field, maximum=2048):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        error('Invalid field / 字段无效: ' + field)
    return value

def host(value):
    value = text(value, 'server', 253).strip()
    if not value or any(c in value for c in '/\\@?#% '):
        error('Invalid server address / 服务器地址无效')
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        try:
            normalized = value.encode('idna').decode('ascii').lower()
        except UnicodeError:
            error('Invalid server address / 服务器地址无效')
        if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part) for part in normalized.rstrip('.').split('.')):
            error('Invalid server address / 服务器地址无效')
        return normalized

def integer(value, field, minimum, maximum):
    if isinstance(value, bool) or not re.fullmatch(r'\d+', str(value)):
        error('Invalid number / 数值无效: ' + field)
    value = int(value)
    if not minimum <= value <= maximum:
        error('Number out of range / 数值超出范围: ' + field)
    return value

def canonical_uuid(value):
    try:
        if not isinstance(value, str): raise ValueError()
        return str(uuid.UUID(value))
    except ValueError:
        error('Invalid node UUID / 节点 UUID 无效')

def b64(value):
    try:
        return base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True).decode('utf-8')
    except (ValueError, UnicodeError):
        error('Invalid VMess Base64 / VMess Base64 编码无效')

def unknown_fields(data, allowed):
    unknown = sorted(k for k in data if k not in allowed)
    if unknown:
        error('Unsupported link fields / 尚未支持的链接字段: ' + ', '.join(unknown))

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result: error('Duplicate VMess fields / VMess 参数重复')
        result[key] = value
    return result

def make_node(protocol, address, port, ident, label, options):
    network = options.get('type') or 'tcp'
    if network == 'tcp': network = 'raw'
    if network not in ('raw', 'ws', 'grpc', 'httpupgrade', 'xhttp'):
        error('Unsupported transport / 尚未支持此传输类型')
    security = options.get('security') or 'none'
    if security not in ('none', 'tls', 'reality'):
        error('Unsupported transport security / 尚未支持此传输加密')
    if protocol == 'vmess' and security == 'reality':
        error('VMess Reality is not supported / 尚未支持 VMess Reality')
    header = options.get('headerType', 'none')
    if header not in ('', 'none'):
        error('Header camouflage is unsupported / 尚未支持头部伪装')
    if network == 'raw' and any(options.get(k) for k in ('host', 'path', 'serviceName', 'authority', 'mode')):
        error('RAW transport cannot use HTTP/gRPC fields / RAW 传输不接受 HTTP/gRPC 字段')
    if network != 'grpc' and any(options.get(k) for k in ('serviceName', 'authority')):
        error('gRPC fields require gRPC transport / gRPC 字段需要 gRPC 传输')
    if network == 'grpc' and any(options.get(k) for k in ('path', 'host')):
        error('Use serviceName/authority for gRPC / gRPC 请使用 serviceName/authority')
    if network not in ('grpc', 'xhttp') and options.get('mode'):
        error('Unsupported transport mode / 此传输不支持 mode 参数')
    if security == 'none' and any(options.get(k) for k in ('sni', 'fp', 'alpn', 'pbk', 'sid', 'spx')):
        error('TLS fields require TLS or Reality / TLS 字段需要 TLS 或 Reality')
    if security != 'reality' and any(options.get(k) for k in ('pbk', 'sid', 'spx')):
        error('Reality fields require Reality / Reality 字段需要 Reality')
    fp = options.get('fp', '')
    if fp not in ('', 'chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized'):
        error('Unsupported TLS fingerprint / 不支持此 TLS 指纹')
    flow = options.get('flow', '')
    if flow not in ('', 'xtls-rprx-vision') or (flow and (protocol != 'vless' or network != 'raw' or security == 'none')):
        error('Unsupported VLESS flow / VLESS flow 配置不支持')
    if options.get('encryption', 'none') != 'none':
        error('This importer supports VLESS encryption=none only / 此导入器目前只支持 VLESS encryption=none')
    if security == 'reality':
        try:
            key = base64.b64decode(options.get('pbk', '') + '=' * (-len(options.get('pbk', '')) % 4), altchars=b'-_', validate=True)
        except ValueError:
            error('Invalid Reality public key / Reality 公钥无效')
        if len(key) != 32 or not options.get('sni') or not re.fullmatch(r'(?:[0-9a-fA-F]{2}){0,8}', options.get('sid', '')):
            error('Invalid Reality settings / Reality 参数无效')
    alpn = options.get('alpn', '')
    if alpn and any(not re.fullmatch(r'[A-Za-z0-9./-]{1,64}', p) for p in alpn.split(',')):
        error('Invalid ALPN / ALPN 无效')
    mode = options.get('mode', '')
    if network == 'grpc' and mode not in ('', 'gun', 'multi'):
        error('Unsupported gRPC mode / gRPC mode 无效')
    if network == 'xhttp' and mode not in ('', 'auto', 'packet-up', 'stream-up', 'stream-one'):
        error('Unsupported XHTTP mode / XHTTP mode 无效')
    transport = {'Host': options.get('host', ''), 'Path': options.get('path', ''),
                 'GrpcAuthority': options.get('authority', ''), 'GrpcServiceName': options.get('serviceName', ''),
                 'GrpcMode': mode if network == 'grpc' else '', 'XhttpMode': mode if network == 'xhttp' else ''}
    proto = {'VlessEncryption': 'none', 'Flow': flow} if protocol == 'vless' else {
        'AlterId': integer(options.get('aid', 0), 'aid', 0, 65535), 'VmessSecurity': options.get('scy') or 'auto'}
    if protocol == 'vmess' and proto['VmessSecurity'] not in ('auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', 'zero'):
        error('Unsupported VMess security / VMess 加密配置不支持')
    node = {'IndexId': '', 'ConfigType': 1 if protocol == 'vmess' else 5, 'Address': host(address),
            'Port': integer(port, 'port', 1, 65535), 'Password': canonical_uuid(ident), 'Username': '',
            'Remarks': text(label or protocol.upper() + ' node', 'name', 200), 'Subid': 'local-imports',
            'Network': network, 'StreamSecurity': security, 'Sni': options.get('sni', ''),
            'Fingerprint': fp, 'PublicKey': options.get('pbk', ''), 'ShortId': options.get('sid', ''),
            'SpiderX': options.get('spx', ''), 'Alpn': alpn,
            'ProtoExtra': json.dumps(proto), 'TransportExtra': json.dumps(transport), '_source': 'local'}
    identity = {k: v for k, v in node.items() if k not in ('IndexId', 'Remarks')}
    node['IndexId'] = 'local-' + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:32]
    return node

def parse_link(link):
    if not isinstance(link, str):
        error('Expected a proxy link or JSON object / 请提供代理链接或 JSON 对象')
    from proxy_import_formats import normalize_socks_uri
    link=normalize_socks_uri(link)
    if link.startswith('vmess://'):
        try:
            value = json.loads(b64(link[8:]), object_pairs_hook=unique_object)
        except json.JSONDecodeError:
            error('Invalid VMess JSON / VMess JSON 无效')
        if not isinstance(value, dict): error('Invalid VMess object / VMess 对象无效')
        unknown_fields(value, {'v', 'ps', 'add', 'port', 'id', 'aid', 'scy', 'net', 'type', 'host', 'path', 'tls', 'sni', 'alpn', 'fp'})
        if value.get('v') not in (None, '', 2, '2'): error('Unsupported VMess link version / VMess 分享版本不支持')
        options = {'type': value.get('net') or 'tcp', 'security': value.get('tls') or 'none',
                   'headerType': value.get('type') or 'none', 'aid': value.get('aid') or 0, 'scy': value.get('scy') or 'auto'}
        for name in ('host', 'path', 'sni', 'alpn', 'fp'):
            options[name] = text(value.get(name) or '', name)
        # VMess v2 share links encode gRPC serviceName in path and mode in type.
        if options['type'] == 'grpc':
            options['serviceName'] = options.pop('path')
            options['authority'] = options.pop('host')
            options['mode'] = options.pop('headerType')
            if options['mode'] == 'none': options['mode'] = ''
        return make_node('vmess', value.get('add'), value.get('port'), value.get('id'), value.get('ps'), options)
    if link.startswith('vless://'):
        try:
            url = urlsplit(link)
            if url.password is not None or not url.username or not url.hostname or not url.port or url.path not in ('', '/'):
                error('Invalid VLESS authority / VLESS 地址结构无效')
            pairs = parse_qsl(url.query, keep_blank_values=True, strict_parsing=True)
            if len({k for k, _ in pairs}) != len(pairs): error('Duplicate VLESS fields / VLESS 参数重复')
            options = {k: text(v, k) for k, v in pairs}
            unknown_fields(options, {'encryption', 'flow', 'security', 'type', 'sni', 'fp', 'pbk', 'sid', 'spx', 'alpn', 'host', 'path', 'serviceName', 'mode', 'authority', 'headerType'})
            return make_node('vless', url.hostname, url.port, unquote(url.username), unquote(url.fragment), options)
        except ValueError as exc:
            # URL parser may include sensitive text in exceptions; only our bilingual errors pass through.
            if ' / ' in str(exc): raise
            error('Invalid VLESS URI / VLESS 链接无效')
    from proxy_import_formats import parse_uri
    return parse_uri(link)

def parse_links(value):
    if not isinstance(value, str) or len(value.encode('utf-8')) > MAX_TEXT:
        error('Import exceeds 256 KiB / 导入内容超过 256 KiB')
    from proxy_import_formats import parse_document, parse_object
    lines = parse_document(value)
    if not lines or len(lines) > MAX_NODES: error('Import requires 1–500 links / 每次需导入 1–500 条链接')
    result = {}
    for index, line in enumerate(lines, 1):
        try: node = parse_object(line) if isinstance(line,dict) else parse_link(line)
        except (TypeError, KeyError, ValueError) as exc:
            detail = str(exc) if isinstance(exc, ValueError) and ' / ' in str(exc) else 'Invalid node fields / 节点字段无效'
            raise ValueError(f'Line {index} / 第 {index} 行: {detail}') from None
        result[node['IndexId']] = node
    return result

def load():
    from library_store import read
    return read()['nodes']

def save(nodes):
    from library_store import locked, read, write
    with locked():
        value = read()
        value['nodes'] = nodes
        write(value)

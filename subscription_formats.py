"""Parse bounded subscription data into the existing allowlisted node records."""
import base64
import json
import re
from urllib.parse import quote, urlencode
import node_import
import proxy_import_formats as formats
from subscription_fetch import MAX_BYTES


class FormatError(ValueError):
    def __init__(self, code='INVALID_CONTENT', line=None):
        self.code, self.line = code, line
        super().__init__(code)


def _bounded(value, depth=0, budget=None, seen=None):
    budget = budget if budget is not None else [0, 0]
    seen = seen if seen is not None else set()
    budget[0] += 1
    if depth > 24 or budget[0] > 30000:
        raise FormatError('DOCUMENT_TOO_COMPLEX')
    if isinstance(value, (dict, list)):
        ident = id(value)
        if ident in seen:
            raise FormatError('DOCUMENT_TOO_COMPLEX')
        seen.add(ident)
        for child in (list(value.keys()) + list(value.values()) if isinstance(value, dict) else value):
            _bounded(child, depth + 1, budget, seen)
        seen.remove(ident)
    elif isinstance(value, str):
        budget[1] += len(value)
        if budget[1] > MAX_BYTES * 4:
            raise FormatError('DOCUMENT_TOO_COMPLEX')
    elif value is not None and type(value) not in (int, bool, float):
        raise FormatError('INVALID_CONTENT')


def _yaml(value):
    import vendor_yaml as yaml
    class Loader(yaml.SafeLoader):
        def __init__(self, stream):
            self.level = self.total = self.aliases = 0
            super().__init__(stream)
        def compose_node(self, parent, index):
            self.level += 1
            self.total += 1
            if self.check_event(yaml.AliasEvent):
                self.aliases += 1
            if self.level > 24 or self.total > 30000 or self.aliases > 32:
                raise FormatError('DOCUMENT_TOO_COMPLEX')
            try:
                return super().compose_node(parent, index)
            finally:
                self.level -= 1
        def get_single_data(self):
            node = self.get_single_node()
            if node is None:
                return None
            budget = [0, 0]
            def walk(item, seen, depth=0):
                budget[0] += 1
                if depth > 24 or budget[0] > 30000 or id(item) in seen:
                    raise FormatError('DOCUMENT_TOO_COMPLEX')
                if isinstance(item, yaml.ScalarNode):
                    budget[1] += len(item.value)
                    if budget[1] > MAX_BYTES * 4:
                        raise FormatError('DOCUMENT_TOO_COMPLEX')
                    return
                seen = seen | {id(item)}
                if isinstance(item, yaml.MappingNode):
                    keys = set()
                    for key, child in item.value:
                        if not isinstance(key, yaml.ScalarNode) or key.value in keys:
                            raise FormatError('INVALID_CONTENT')
                        keys.add(key.value)
                        walk(key, seen, depth + 1)
                        walk(child, seen, depth + 1)
                else:
                    for child in item.value:
                        walk(child, seen, depth + 1)
            walk(node, set())
            return self.construct_document(node)
    try:
        return yaml.load(value, Loader=Loader)
    except FormatError:
        raise
    except (yaml.YAMLError, ValueError, TypeError, RecursionError):
        raise FormatError('INVALID_CONTENT') from None


def _fields(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise FormatError('UNSUPPORTED_OPTIONS')


def _clash(value):
    kind = value.get('type')
    if kind in ('ssr', 'tuic', 'anytls', 'snell', 'hysteria', 'naive'):
        raise FormatError('UNSUPPORTED_PROTOCOL')
    if kind in ('http', 'https', 'socks', 'socks5', 'ss', 'shadowsocks'):
        return formats.parse_object(value)
    shared = {'name', 'type', 'server', 'port', 'udp', 'network', 'tls', 'servername', 'sni',
              'client-fingerprint', 'alpn', 'skip-cert-verify', 'ws-opts', 'grpc-opts'}
    if value.get('skip-cert-verify'):
        raise FormatError('UNSUPPORTED_OPTIONS')
    address = node_import.host(value.get('server'))
    port = node_import.integer(value.get('port'), 'port', 1, 65535)
    label = node_import.text(value.get('name') or str(kind).upper() + ' proxy', 'name', 200)
    options = {'type': value.get('network') or 'tcp', 'security': 'tls' if value.get('tls') else 'none'}
    if value.get('servername') or value.get('sni'):
        options['sni'] = value.get('servername') or value['sni']
    if value.get('client-fingerprint'):
        options['fp'] = value['client-fingerprint']
    if value.get('alpn'):
        if not isinstance(value['alpn'], list) or any(not isinstance(x, str) for x in value['alpn']):
            raise FormatError()
        options['alpn'] = ','.join(value['alpn'])
    if 'ws-opts' in value:
        data = value['ws-opts']
        _fields(data, {'path', 'headers'})
        headers = data.get('headers', {})
        _fields(headers, {'Host', 'host'})
        options.update(path=data.get('path', ''), host=headers.get('Host', headers.get('host', '')))
        if options['type'] != 'ws':
            raise FormatError('UNSUPPORTED_OPTIONS')
    if 'grpc-opts' in value:
        data = value['grpc-opts']
        _fields(data, {'grpc-service-name'})
        if options['type'] != 'grpc':
            raise FormatError('UNSUPPORTED_OPTIONS')
        options['serviceName'] = data.get('grpc-service-name', '')
    if kind in ('vmess', 'vless'):
        _fields(value, shared | {'uuid', 'alterId', 'cipher', 'flow', 'reality-opts'})
        if kind == 'vmess':
            if value.get('flow') or value.get('reality-opts'):
                raise FormatError('UNSUPPORTED_OPTIONS')
            options.update(aid=value.get('alterId', 0), scy=value.get('cipher', 'auto'))
        else:
            if value.get('alterId') or value.get('cipher'):
                raise FormatError('UNSUPPORTED_OPTIONS')
            options['flow'] = value.get('flow', '')
        if value.get('reality-opts'):
            reality = value['reality-opts']
            _fields(reality, {'public-key', 'short-id'})
            options.update(security='reality', pbk=reality.get('public-key', ''), sid=reality.get('short-id', ''))
        return node_import.make_node(kind, address, port, value.get('uuid'), label, options)
    if kind == 'trojan':
        _fields(value, shared | {'password'})
        options['security'] = 'tls'
        secret = node_import.text(value.get('password'), 'password', 8192)
    elif kind in ('hysteria2', 'hy2'):
        _fields(value, {'name', 'type', 'server', 'port', 'password', 'sni', 'skip-cert-verify', 'alpn', 'obfs', 'obfs-password', 'udp'})
        options = {key: value[key] for key in ('sni', 'obfs', 'obfs-password') if value.get(key)}
        if value.get('alpn'):
            options['alpn'] = ','.join(value['alpn'])
        secret = node_import.text(value.get('password'), 'password', 8192)
    elif kind == 'wireguard':
        _fields(value, {'name', 'type', 'server', 'port', 'ip', 'ipv6', 'private-key', 'public-key', 'pre-shared-key', 'reserved', 'mtu', 'udp'})
        options = {'publicKey': value.get('public-key', '')}
        if value.get('pre-shared-key'):
            options['preSharedKey'] = value['pre-shared-key']
        ips = [str(value[key]) for key in ('ip', 'ipv6') if value.get(key)]
        if ips:
            options['address'] = ','.join(ips)
        if value.get('reserved'):
            if not isinstance(value['reserved'], list):
                raise FormatError()
            options['reserved'] = ','.join(str(x) for x in value['reserved'])
        if value.get('mtu'):
            options['mtu'] = value['mtu']
        secret = node_import.text(value.get('private-key'), 'private-key', 8192)
    else:
        raise FormatError('UNSUPPORTED_PROTOCOL')
    authority = '[' + address + ']' if ':' in address else address
    return node_import.parse_link(kind + '://' + quote(secret, safe='') + '@' + authority + ':' + str(port) + '?' + urlencode(options) + '#' + quote(label, safe=''))


def parse(value):
    if not isinstance(value, str) or len(value.encode('utf-8')) > MAX_BYTES:
        raise FormatError('BODY_TOO_LARGE')
    value = value.lstrip('\ufeff').strip()
    for _ in range(2):
        if '://' in value or not re.fullmatch(r'[A-Za-z0-9_+/=\s-]+', value):
            break
        try:
            decoded = base64.b64decode(re.sub(r'\s', '', value) + '=' * (-len(re.sub(r'\s', '', value)) % 4), altchars=b'-_', validate=True).decode('utf-8-sig').strip()
        except (ValueError, UnicodeError):
            break
        if not decoded or decoded == value:
            break
        value = decoded
    if value.startswith('```'):
        value = re.sub(r'^```(?:json|ya?ml|text)?\s*\n', '', value, flags=re.I)
        value = re.sub(r'\n```\s*$', '', value).strip()
    try:
        if value.startswith(('{', '[')):
            data = json.loads(value, object_pairs_hook=node_import.unique_object, parse_constant=lambda _: (_ for _ in ()).throw(FormatError()))
        elif re.search(r'(?m)^\s*(?:proxies|proxy-providers)\s*:', value):
            data = _yaml(value)
        else:
            data = [line.strip() for line in value.splitlines() if line.strip() and not line.lstrip().startswith(('#', ';'))]
        _bounded(data)
        sip008 = isinstance(data, dict) and 'servers' in data
        if sip008:
            if data.get('version') != 1:
                raise FormatError('UNSUPPORTED_FORMAT')
            data = data['servers']
        elif isinstance(data, dict) and 'outbounds' in data:
            data = data['outbounds']
        elif isinstance(data, dict) and 'proxies' in data:
            data = data['proxies']
        elif isinstance(data, dict) and 'proxy-providers' in data:
            raise FormatError('PROVIDER_ONLY')
        values = data if isinstance(data, list) else [data]
        values = [item for item in values if not isinstance(item, dict) or item.get('protocol') not in ('freedom', 'blackhole', 'dns', 'loopback')]
        if not 1 <= len(values) <= node_import.MAX_NODES:
            raise FormatError('NODE_LIMIT')
        nodes = {}
        for index, item in enumerate(values, 1):
            try:
                if sip008:
                    _fields(item, {'id', 'remarks', 'server', 'server_port', 'password', 'method', 'plugin', 'plugin_opts'})
                    if item.get('plugin') or item.get('plugin_opts'):
                        raise FormatError('UNSUPPORTED_OPTIONS')
                    item = {key: item[key] for key in ('remarks', 'server', 'server_port', 'password', 'method') if key in item}
                    item['type'] = 'ss'
                if isinstance(item, str):
                    if item.lower().startswith(('ssr://', 'tuic://', 'anytls://', 'v2rayn://')):
                        raise FormatError('UNSUPPORTED_PROTOCOL')
                    node = node_import.parse_link(item)
                elif isinstance(item, dict):
                    node = _clash(item) if 'type' in item else formats.parse_object(item)
                else:
                    raise FormatError()
                nodes[node['IndexId']] = node
            except FormatError as exc:
                raise FormatError(exc.code, index) from None
            except (ValueError, TypeError, KeyError):
                raise FormatError('UNSUPPORTED_OPTIONS', index) from None
        return nodes
    except FormatError:
        raise
    except (ValueError, TypeError, KeyError, RecursionError):
        raise FormatError('INVALID_CONTENT') from None

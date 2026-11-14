"""V2Route node normalization and Xray outbound compiler.

Only the record boundary knows v2rayN column names. Protocol, transport and TLS
builders consume normalized values. See docs/OUTBOUND-ADAPTER.md for the public
schema references, accepted compatibility defaults, and implementation history.
"""
from copy import deepcopy
from dataclasses import dataclass, field
import ipaddress
import json
import re


PROTOCOL_BY_ID = {1: 'vmess', 3: 'shadowsocks', 4: 'socks', 5: 'vless', 6: 'trojan', 10: 'http'}
PROTOCOL_FIELDS = {
    'vmess': {'AlterId', 'VmessSecurity'},
    'vless': {'VlessEncryption', 'Flow'},
    'shadowsocks': {'SsMethod', 'Uot'},
    'socks': set(), 'trojan': set(), 'http': set(),
}
TRANSPORT_FIELDS = {
    'raw': {'RawHeaderType'},
    'ws': {'Host', 'Path'},
    'httpupgrade': {'Host', 'Path'},
    'grpc': {'GrpcAuthority', 'GrpcServiceName', 'GrpcMode'},
    'xhttp': {'Host', 'Path', 'XhttpMode', 'XhttpExtra'},
}
# v2rayN may persist defaults for inactive members of its shared option object.
# These exact defaults have no effect on the selected protocol/transport.
INACTIVE_DEFAULTS = {
    'AlterId': (0, '0'), 'VmessSecurity': ('auto',), 'VlessEncryption': ('none',),
    'SsMethod': ('none',), 'WgMtu': (1280, '1280'),
    'RawHeaderType': ('none',), 'KcpHeaderType': ('none',),
    'XhttpMode': ('auto',), 'GrpcMode': ('gun',),
}
XHTTP_KEYS = set('host path mode headers xPaddingBytes xPaddingObfsMode xPaddingKey '
    'xPaddingHeader xPaddingPlacement xPaddingMethod uplinkHTTPMethod '
    'sessionIDPlacement sessionIDKey sessionIDTable sessionIDLength seqPlacement '
    'seqKey uplinkDataPlacement uplinkDataKey uplinkChunkSize noGRPCHeader '
    'noSSEHeader scMaxEachPostBytes scMinPostsIntervalMs scMaxBufferedPosts '
    'scStreamUpServerSecs serverMaxHeaderBytes xmux downloadSettings h2Params'.split())
DOWNLOAD_KEYS = {'address', 'port', 'method', 'network', 'security', 'tlsSettings',
    'realitySettings', 'xhttpSettings', 'sockopt'}
XMUX_KEYS = set('maxConcurrency maxConnections cMaxReuseTimes hMaxRequestTimes hMaxReusableSecs hKeepAlivePeriod'.split())
TLS_CLIENT_KEYS = set('serverName alpn enableSessionResumption disableSystemRoot minVersion maxVersion '
    'cipherSuites fingerprint curvePreferences pinnedPeerCertSha256 verifyPeerCertByName '
    'echConfigList echSockopt useSystemCA'.split())
REALITY_CLIENT_KEYS = set('show fingerprint serverName password publicKey shortId mldsa65Verify spiderX'.split())
SOCKOPT_KEYS = set('mark tcpFastOpen tproxy acceptProxyProtocol domainStrategy dialerProxy '
    'tcpKeepAliveInterval tcpKeepAliveIdle tcpCongestion tcpWindowClamp tcpMaxSeg penetrate '
    'tcpUserTimeout v6only interface tcpMptcp addressPortStrategy trustedXForwardedFor'.split())


def invalid(field, explanation='Invalid or unsupported setting'):
    # Do not put user values, credentials, or an entire JSON parse error in logs.
    raise ValueError(f'{explanation}: {field} / 配置无效或尚未支持：{field}')


def string(value, field, *, required=False, limit=8192):
    if value is None:
        value = ''
    if (not isinstance(value, str) or len(value) > limit or
            any(ord(ch) < 32 or ord(ch) == 127 for ch in value)):
        invalid(field)
    if required and not value:
        invalid(field, 'Required setting is missing')
    return value


def integer(value, field, minimum=0, maximum=2**31 - 1):
    if isinstance(value, bool) or not re.fullmatch(r'\d+', str(value)):
        invalid(field)
    number = int(value)
    if not minimum <= number <= maximum:
        invalid(field)
    return number


def inactive(value):
    return value in (None, '', False, 0, [], {})


def _pairs(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            invalid('JSON', 'Duplicate setting')
        obj[key] = value
    return obj


def object_value(value, field):
    if value is None or value == '':
        return {}
    if isinstance(value, str):
        if len(value) > 262144:
            invalid(field)
        try:
            value = json.loads(value, object_pairs_hook=_pairs,
                               parse_constant=lambda _: invalid(field))
        except (ValueError, RecursionError):
            invalid(field, 'Invalid JSON object')
    if not isinstance(value, dict):
        invalid(field, 'Expected an object')
    return deepcopy(value)


def options_for(value, accepted, field):
    """Reject configured options that the selected variant cannot implement."""
    result = object_value(value, field)
    for key, item in result.items():
        if key not in accepted and not inactive(item) and item not in INACTIVE_DEFAULTS.get(key, ()):
            invalid(field, 'Unsupported nondefault option')
    return {key: result[key] for key in accepted if key in result}


def endpoint_address(value):
    value = string(value, 'server', required=True, limit=253)
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        try:
            ascii_name = value.encode('idna').decode('ascii').lower()
        except UnicodeError:
            invalid('server')
        if not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part)
                   for part in ascii_name.rstrip('.').split('.')):
            invalid('server')
        return ascii_name


@dataclass(frozen=True)
class Transport:
    kind: str
    options: dict = field(repr=False)
    user_agent: str
    grpc_defaults: dict


@dataclass(frozen=True)
class Security:
    kind: str
    options: dict = field(repr=False)


@dataclass(frozen=True)
class Node:
    protocol: str
    address: str
    port: int
    credential: str = field(repr=False)
    username: str = field(repr=False)
    options: dict = field(repr=False)
    transport: Transport
    security: Security


def normalize_record(record, application=None):
    """Adapt external records once; compiler functions never read DB columns."""
    if not isinstance(record, dict):
        invalid('node')
    kind = record.get('ConfigType')
    if type(kind) is not int or kind not in PROTOCOL_BY_ID:
        invalid('protocol')
    protocol = PROTOCOL_BY_ID[kind]
    if application is None:
        application = {}
    if not isinstance(application, dict):
        invalid('application defaults')
    basic = object_value(application.get('CoreBasicItem'), 'application defaults')
    for key in ('Extra', 'Finalmask', 'Cert'):
        if not inactive(record.get(key)):
            invalid(key)
    for key in ('AllowInsecure', 'MuxEnabled'):
        if record.get(key) not in (None, '', False, 0, 'false', 'False', '0'):
            invalid(key)
    raw_network = record.get('Network')
    if raw_network is not None and not isinstance(raw_network, str):
        invalid('transport')
    network = raw_network or 'raw'
    network = 'raw' if network == 'tcp' else network
    if not isinstance(network, str) or network not in TRANSPORT_FIELDS:
        invalid('transport')
    transport_options = options_for(record.get('TransportExtra'), TRANSPORT_FIELDS[network], 'transport options')
    transport = Transport(network, transport_options,
        string(basic.get('DefUserAgent'), 'user agent'),
        object_value(application.get('GrpcItem'), 'gRPC defaults') if network == 'grpc' else {})
    raw_security = record.get('StreamSecurity')
    if raw_security is not None and not isinstance(raw_security, str):
        invalid('transport security')
    security_kind = raw_security or 'none'
    if security_kind not in ('none', 'tls', 'reality'):
        invalid('transport security')
    values = {key: string(record.get(source), key) for key, source in {
        'server_name': 'Sni', 'fingerprint': 'Fingerprint', 'alpn': 'Alpn',
        'public_key': 'PublicKey', 'short_id': 'ShortId', 'spider': 'SpiderX',
        'mldsa_verify': 'Mldsa65Verify', 'cert_pin': 'CertSha',
        'ech': 'EchConfigList', 'verify_name': 'VerifyPeerCertByName',
    }.items()}
    if security_kind == 'none' and any(values.values()):
        invalid('TLS/Reality fields without transport security')
    reality_only = ('public_key', 'short_id', 'spider', 'mldsa_verify')
    tls_only = ('alpn', 'cert_pin', 'ech', 'verify_name')
    if security_kind == 'tls' and any(values[k] for k in reality_only):
        invalid('Reality fields with TLS')
    if security_kind == 'reality' and any(values[k] for k in tls_only):
        invalid('TLS-only fields with Reality')
    if security_kind != 'none':
        values['fingerprint'] = values['fingerprint'] or string(basic.get('DefFingerprint'), 'fingerprint') or 'chrome'
        # Explicit compatibility policy: saved HTTP authority is the fallback SNI
        # only when the source record has no explicit Sni. Never override Sni.
        authority = transport_options.get('GrpcAuthority' if network == 'grpc' else 'Host')
        if security_kind == 'tls' and not values['server_name'] and authority:
            values['server_name'] = string(authority, 'HTTP authority').split(',')[0]
    node = Node(protocol, endpoint_address(record.get('Address')),
        integer(record.get('Port'), 'port', 1, 65535),
        string(record.get('Password'), 'credential'), string(record.get('Username'), 'username'),
        options_for(record.get('ProtoExtra'), PROTOCOL_FIELDS[protocol], 'protocol options'),
        transport, Security(security_kind, values))
    return node


def _required_credential(node):
    return string(node.credential, 'credential', required=True)


def vmess_settings(node):
    # Legacy AlterId is not implemented by the pinned AEAD-only Xray core.
    if integer(node.options.get('AlterId') or 0, 'VMess AlterId') != 0:
        invalid('VMess AlterId', 'Legacy nonzero AlterId is unsupported')
    cipher = node.options.get('VmessSecurity') or 'auto'
    if cipher not in ('auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', 'zero'):
        invalid('VMess cipher')
    return {'id': _required_credential(node), 'security': cipher}


def vless_settings(node):
    encryption = string(node.options.get('VlessEncryption') or 'none', 'VLESS encryption')
    flow = string(node.options.get('Flow'), 'VLESS flow')
    if flow not in ('', 'xtls-rprx-vision', 'xtls-rprx-vision-udp443'):
        invalid('VLESS flow')
    if flow and (node.transport.kind != 'raw' or node.security.kind == 'none'):
        invalid('VLESS flow/transport combination')
    if encryption == 'none' and node.security.kind == 'none':
        try:
            private = ipaddress.ip_address(node.address).is_private
        except ValueError:
            private = node.address == 'localhost' or node.address.endswith('.localhost')
        if not private:
            invalid('public VLESS without transport security')
    config = {'id': _required_credential(node), 'encryption': encryption}
    if flow:
        config['flow'] = flow
    return config


def shadowsocks_settings(node):
    if not inactive(node.options.get('Uot')):
        invalid('Shadowsocks UoT')
    return {'method': string(node.options.get('SsMethod') or 'none', 'Shadowsocks cipher'),
            'password': _required_credential(node)}


def socks_settings(node):
    if bool(node.username) != bool(node.credential):
        invalid('SOCKS authentication', 'Both username and password are required')
    return {'user': node.username, 'pass': node.credential} if node.username else {}


def trojan_settings(node):
    return {'password': _required_credential(node)}


PROTOCOL_COMPILERS = {'vmess': vmess_settings, 'vless': vless_settings,
    'shadowsocks': shadowsocks_settings, 'socks': socks_settings, 'trojan': trojan_settings, 'http': socks_settings}


def http_transport(transport):
    detail = {}
    for source, target in (('Host', 'host'), ('Path', 'path')):
        value = string(transport.options.get(source), target)
        if value:
            detail[target] = value
    if transport.user_agent:
        detail['headers'] = {'User-Agent': transport.user_agent}
    return detail


def grpc_transport(transport):
    mode = transport.options.get('GrpcMode') or 'gun'
    if mode not in ('gun', 'multi'):
        invalid('gRPC mode')
    detail = {'serviceName': string(transport.options.get('GrpcServiceName'), 'gRPC service'),
              'multiMode': mode == 'multi'}
    authority = string(transport.options.get('GrpcAuthority'), 'gRPC authority')
    if authority:
        detail['authority'] = authority
    settings = transport.grpc_defaults
    mapping = {'IdleTimeout': 'idle_timeout', 'HealthCheckTimeout': 'health_check_timeout',
               'InitialWindowsSize': 'initial_windows_size', 'PermitWithoutStream': 'permit_without_stream'}
    if any(key not in mapping and not inactive(value) for key, value in settings.items()):
        invalid('gRPC defaults')
    for source, target in mapping.items():
        if settings.get(source) is None:
            continue
        value = settings[source]
        if source == 'PermitWithoutStream':
            if not isinstance(value, bool):
                invalid('gRPC keepalive flag')
            detail[target] = value
        else:
            detail[target] = integer(value, 'gRPC numeric setting')
    return detail


def _core_object(value, allowed, area):
    detail = object_value(value, area)
    if set(detail) - allowed:
        invalid(area, 'Unsupported core option')
    return detail


def xhttp_options(value, depth=0):
    """Validate supported core-native subobjects without rewriting their values."""
    if depth > 4:
        invalid('XHTTP nesting')
    extra = _core_object(value, XHTTP_KEYS, 'XHTTP options')
    if 'headers' in extra:
        headers = object_value(extra['headers'], 'XHTTP headers')
        for key, item in headers.items():
            string(key, 'header name', required=True, limit=256)
            string(item, 'header value')
    if 'xmux' in extra:
        extra['xmux'] = _core_object(extra['xmux'], XMUX_KEYS, 'XHTTP multiplexing')
    if not inactive(extra.get('h2Params')):
        invalid('XHTTP h2Params', 'Custom HTTP/2 internals are not yet supported')
    if 'downloadSettings' not in extra:
        return extra
    download = _core_object(extra['downloadSettings'], DOWNLOAD_KEYS, 'XHTTP download settings')
    for key, allowed in (('tlsSettings', TLS_CLIENT_KEYS), ('realitySettings', REALITY_CLIENT_KEYS), ('sockopt', SOCKOPT_KEYS)):
        if key in download:
            download[key] = _core_object(download[key], allowed, 'XHTTP download ' + key)
    if 'tlsSettings' in download and 'echSockopt' in download['tlsSettings']:
        download['tlsSettings']['echSockopt'] = _core_object(download['tlsSettings']['echSockopt'], SOCKOPT_KEYS, 'ECH socket options')
    if 'xhttpSettings' in download:
        download['xhttpSettings'] = xhttp_options(download['xhttpSettings'], depth + 1)
    extra['downloadSettings'] = download
    return extra


def xhttp_transport(transport):
    detail = {target: string(transport.options[source], target)
              for source, target in (('Host', 'host'), ('Path', 'path'))
              if transport.options.get(source)}
    mode = transport.options.get('XhttpMode') or 'auto'
    if mode not in ('auto', 'packet-up', 'stream-up', 'stream-one'):
        invalid('XHTTP mode')
    detail['mode'] = mode
    extra = xhttp_options(transport.options.get('XhttpExtra'))
    if extra:
        # Explicit core-native options: copied losslessly, never translated by
        # ad-hoc v2rayN branches. Xray -test validates the resulting config.
        detail['extra'] = extra
    return detail


def compile_transport(transport):
    if transport.kind == 'raw':
        if transport.options.get('RawHeaderType') not in (None, '', 'none'):
            invalid('RAW header')
        return {'network': 'raw'}
    compiler = {'ws': http_transport, 'httpupgrade': http_transport,
                'grpc': grpc_transport, 'xhttp': xhttp_transport}[transport.kind]
    return {'network': transport.kind, transport.kind + 'Settings': compiler(transport)}


def tls_settings(security):
    values = security.options
    detail = {'fingerprint': values['fingerprint']}
    for source, target in (('server_name', 'serverName'), ('cert_pin', 'pinnedPeerCertSha256'),
                           ('ech', 'echConfigList'), ('verify_name', 'verifyPeerCertByName')):
        if values[source]:
            detail[target] = values[source]
    if values['alpn']:
        alpn = [part.strip() for part in values['alpn'].split(',')]
        if not all(alpn):
            invalid('TLS ALPN')
        detail['alpn'] = alpn
    # Do not emit legacy echForceQuery: it is not a field in the pinned core.
    return detail


def reality_settings(security):
    values = security.options
    if not values['public_key'] or not values['server_name']:
        invalid('Reality public key/server name', 'Required setting is missing')
    if not re.fullmatch(r'(?:[a-fA-F0-9]{2}){0,8}', values['short_id']):
        invalid('Reality short ID')
    detail = {'serverName': values['server_name'], 'fingerprint': values['fingerprint'],
              'publicKey': values['public_key'], 'shortId': values['short_id'], 'show': False}
    if values['spider']:
        detail['spiderX'] = values['spider']
    if values['mldsa_verify']:
        detail['mldsa65Verify'] = values['mldsa_verify']
    return detail


def compile_node(node, tag):
    """Build one outbound from the internal model; no DB or filesystem access."""
    settings = {'address': node.address, 'port': node.port,
                **PROTOCOL_COMPILERS[node.protocol](node)}
    stream = compile_transport(node.transport)
    if node.security.kind != 'none':
        compiler = {'tls': tls_settings, 'reality': reality_settings}[node.security.kind]
        stream['security'] = node.security.kind
        stream[node.security.kind + 'Settings'] = compiler(node.security)
    return {'tag': string(tag, 'outbound tag', required=True, limit=256),
            'protocol': node.protocol, 'settings': settings, 'streamSettings': stream}


def compile_record(record, tag, application=None):
    return compile_node(normalize_record(record, application), tag)

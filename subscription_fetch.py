"""Bounded subscription HTTP transport. Never changes browser/system proxy settings."""
import http.client
import io
import ipaddress
import queue
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit, urljoin, urlunsplit, quote

MAX_BYTES = 1024 * 1024
MAX_REDIRECTS = 3
_DNS_SLOTS = threading.BoundedSemaphore(4)


class FetchError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def validate_url(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 8192 or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        raise FetchError('INVALID_URL')
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.fragment:
            raise ValueError()
        from node_import import host
        hostname = host(parsed.hostname)
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        if not 1 <= port <= 65535:
            raise ValueError()
        if hostname.rstrip('.').lower() in ('localhost', 'localhost.localdomain') or hostname.rstrip('.').lower().endswith(('.localhost', '.local')):
            raise FetchError('PRIVATE_TARGET')
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            address = None
        if address and not address.is_global:
            raise FetchError('PRIVATE_TARGET')
        authority = ('[' + hostname + ']' if ':' in hostname else hostname) + (':' + str(port) if parsed.port is not None else '')
        return urlunsplit((parsed.scheme, authority, quote(parsed.path or '/', safe="/:@-._~!$&'()*+,;=%"), quote(parsed.query, safe="/?@:!$&'()*+,;=-._~%"), ''))
    except FetchError:
        raise
    except (ValueError, TypeError, UnicodeError):
        raise FetchError('INVALID_URL') from None


def _resolve(host, port, timeout, public):
    result = queue.Queue(maxsize=1)
    if not _DNS_SLOTS.acquire(blocking=False):
        raise FetchError('DNS_BUSY')
    def lookup():
        try:
            result.put(socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM))
        except OSError:
            result.put(None)
        finally:
            _DNS_SLOTS.release()
    threading.Thread(target=lookup, daemon=True).start()
    try:
        values = result.get(timeout=min(4, max(.1, timeout)))
    except queue.Empty:
        raise FetchError('DNS_FAILED') from None
    if not values:
        raise FetchError('DNS_FAILED')
    addresses = []
    for value in values:
        address = ipaddress.ip_address(value[4][0])
        if public and not address.is_global:
            raise FetchError('PRIVATE_TARGET')
        if str(address) not in addresses:
            addresses.append(str(address))
    return addresses


def resolve_public(host, port, timeout):
    """Resolve once, validate every answer, then connect to that exact address."""
    return _resolve(host, port, timeout, True)


def validate_transport(value):
    if not isinstance(value, dict) or set(value) - {'kind', 'host', 'port', 'reason'}:
        raise FetchError('INVALID_TRANSPORT')
    kind = value.get('kind')
    if kind in ('direct', 'unavailable'):
        if 'host' in value or 'port' in value:
            raise FetchError('INVALID_TRANSPORT')
        return {'kind': kind}
    if kind not in ('socks5', 'http', 'https'):
        raise FetchError('INVALID_TRANSPORT')
    try:
        from node_import import host, integer
        return {'kind': kind, 'host': host(value.get('host')), 'port': integer(value.get('port'), 'port', 1, 65535)}
    except ValueError:
        raise FetchError('INVALID_TRANSPORT') from None


def receive(sock, count):
    data = bytearray()
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise FetchError('PROXY_FAILED')
        data.extend(chunk)
    return bytes(data)


class _SocketReader(io.RawIOBase):
    def __init__(self, stream):
        self.stream = stream
    def readable(self):
        return True
    def readinto(self, buffer):
        data = self.stream.recv(len(buffer))
        buffer[:len(data)] = data
        return len(data)


class _DeadlineStream:
    """An absolute deadline also covers slow headers, CONNECT and TLS handshakes."""
    def __init__(self, stream, deadline):
        self.stream, self.deadline, self.timeout = stream, deadline, 6
    def _prepare(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Subscription deadline')
        self.stream.settimeout(min(self.timeout, remaining))
    def recv(self, count):
        self._prepare()
        return self.stream.recv(count)
    def sendall(self, data):
        self._prepare()
        self.stream.sendall(data)
    def settimeout(self, value):
        self.timeout = value
    def makefile(self, mode):
        return io.BufferedReader(_SocketReader(self))
    def close(self):
        self.stream.close()


class _TLSStream:
    """TLS over a socket or over another TLS stream (HTTPS CONNECT proxy)."""
    def __init__(self, stream, hostname):
        self.stream = stream
        self.incoming, self.outgoing = ssl.MemoryBIO(), ssl.MemoryBIO()
        self.ssl = ssl.create_default_context().wrap_bio(self.incoming, self.outgoing, server_side=False, server_hostname=hostname)
        self._call(self.ssl.do_handshake)
    def _flush(self):
        while self.outgoing.pending:
            self.stream.sendall(self.outgoing.read())
    def _call(self, function, *args):
        while True:
            try:
                result = function(*args)
                self._flush()
                return result
            except ssl.SSLWantWriteError:
                self._flush()
            except ssl.SSLWantReadError:
                self._flush()
                data = self.stream.recv(16384)
                if data:
                    self.incoming.write(data)
                else:
                    self.incoming.write_eof()
    def sendall(self, data):
        view = memoryview(data)
        while view:
            count = self._call(self.ssl.write, view)
            view = view[count:]
    def recv(self, count):
        try:
            return self._call(self.ssl.read, count)
        except (ssl.SSLZeroReturnError, ssl.SSLEOFError):
            return b''
    def makefile(self, mode):
        return io.BufferedReader(_SocketReader(self))
    def settimeout(self, value):
        self.stream.settimeout(value)
    def close(self):
        self.stream.close()


def _connect(address, port, transport, hostname, secure, timeout):
    deadline = time.monotonic() + timeout
    kind = transport['kind']
    if kind == 'unavailable':
        raise FetchError('PROXY_UNAVAILABLE')
    endpoint = (address, port) if kind == 'direct' else (_resolve(transport['host'], transport['port'], min(4, timeout), False)[0], transport['port'])
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise FetchError('TIMEOUT')
    stream = _DeadlineStream(socket.create_connection(endpoint, timeout=min(6, remaining)), deadline)
    try:
        stream.settimeout(timeout)
        if kind == 'https':
            stream = _TLSStream(stream, transport['host'])
        if kind == 'socks5':
            stream.sendall(b'\x05\x01\x00')
            if receive(stream, 2) != b'\x05\x00':
                raise FetchError('PROXY_AUTH_REQUIRED')
            ip = ipaddress.ip_address(address)
            stream.sendall(b'\x05\x01\x00' + (b'\x01' if ip.version == 4 else b'\x04') + ip.packed + port.to_bytes(2, 'big'))
            head = receive(stream, 4)
            if head[:3] != b'\x05\x00\x00':
                raise FetchError('PROXY_FAILED')
            size = {1: 4, 4: 16}.get(head[3])
            if head[3] == 3:
                size = receive(stream, 1)[0]
            if size is None:
                raise FetchError('PROXY_FAILED')
            receive(stream, size + 2)
        elif kind in ('http', 'https'):
            authority = ('[' + address + ']' if ':' in address else address) + ':' + str(port)
            stream.sendall(('CONNECT ' + authority + ' HTTP/1.1\r\nHost: ' + authority + '\r\n\r\n').encode('ascii'))
            header = bytearray()
            while not header.endswith(b'\r\n\r\n'):
                if len(header) >= 16384:
                    raise FetchError('PROXY_FAILED')
                header.extend(receive(stream, 1))
            first = bytes(header).split(b'\r\n', 1)[0].split()
            if len(first) < 2 or first[1] != b'200':
                raise FetchError('PROXY_AUTH_REQUIRED' if len(first) > 1 and first[1] == b'407' else 'PROXY_FAILED')
        if secure:
            stream = _TLSStream(stream, hostname)
        return stream
    except BaseException:
        stream.close()
        raise


def fetch(url, transport, deadline=None, resolver=resolve_public, connector=_connect):
    """Return UTF-8 plain data only. No cookies, implicit proxies, auth or raw errors."""
    transport = validate_transport(transport)
    deadline = deadline or time.monotonic() + 18
    current = validate_url(url)
    for redirect in range(MAX_REDIRECTS + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise FetchError('TIMEOUT')
        parsed = urlsplit(current)
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        addresses = resolver(parsed.hostname, port, remaining)
        stream = None
        try:
            # DNS is pinned for both direct and proxied connections. The original
            # hostname is still used for SNI, certificate verification and Host.
            connection_error = 'PROXY_FAILED' if transport['kind'] != 'direct' else 'NETWORK_FAILED'
            for address in addresses[:4]:
                try:
                    stream = connector(address, port, transport, parsed.hostname, parsed.scheme == 'https', max(.1, deadline - time.monotonic()))
                    break
                except (OSError, FetchError) as exc:
                    connection_error = exc.code if isinstance(exc, FetchError) else 'TLS_FAILED' if isinstance(exc, ssl.SSLError) else connection_error
                    if time.monotonic() >= deadline:
                        raise FetchError('TIMEOUT') from None
            if stream is None:
                raise FetchError(connection_error)
            target = (parsed.path or '/') + ('?' + parsed.query if parsed.query else '')
            stream.sendall(('GET ' + target + ' HTTP/1.1\r\nHost: ' + parsed.netloc + '\r\nUser-Agent: Proxy-V2Route-Subscription/1\r\nAccept: application/json, application/yaml, text/yaml, text/plain, */*\r\nAccept-Encoding: identity\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n').encode('ascii'))
            response = http.client.HTTPResponse(stream)
            response.begin()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader('Location')
                if not location or redirect >= MAX_REDIRECTS:
                    raise FetchError('REDIRECT_LIMIT')
                next_url = validate_url(urljoin(current, location))
                if parsed.scheme == 'https' and urlsplit(next_url).scheme != 'https':
                    raise FetchError('TLS_DOWNGRADE')
                current = next_url
                continue
            if response.status != 200:
                raise FetchError('HTTP_' + str(response.status))
            if response.getheader('Content-Encoding', 'identity').lower() not in ('', 'identity'):
                raise FetchError('ENCODING_UNSUPPORTED')
            length = response.getheader('Content-Length')
            if length and (not length.isdigit() or int(length) > MAX_BYTES):
                raise FetchError('BODY_TOO_LARGE')
            content = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise FetchError('TIMEOUT')
                stream.settimeout(min(4, remaining))
                chunk = response.read1(min(32768, MAX_BYTES + 1 - len(content)))
                if not chunk:
                    break
                content.extend(chunk)
                if len(content) > MAX_BYTES:
                    raise FetchError('BODY_TOO_LARGE')
            if response.length not in (None, 0):
                raise FetchError('INCOMPLETE_RESPONSE')
            try:
                text = bytes(content).decode('utf-8-sig')
            except UnicodeError:
                raise FetchError('INVALID_ENCODING') from None
            if not text.strip() or text.lstrip().startswith('<') or 'text/html' in response.getheader('Content-Type', '').lower():
                raise FetchError('INVALID_CONTENT')
            return text
        except FetchError:
            raise
        except (TimeoutError, socket.timeout):
            raise FetchError('TIMEOUT') from None
        except ssl.SSLError:
            raise FetchError('TLS_FAILED') from None
        except (OSError, ValueError, UnicodeError, http.client.HTTPException):
            raise FetchError('NETWORK_FAILED') from None
        finally:
            if stream is not None:
                stream.close()
    raise FetchError('REDIRECT_LIMIT')

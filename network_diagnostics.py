"""User-triggered bounded endpoint diagnostics. No shell or proxy mutation."""
import ctypes
import os
import socket
import time
import ipaddress
import queue
import threading
from concurrent.futures import ThreadPoolExecutor

TARGETS={'ali':('223.5.5.5',443),'tencent':('119.29.29.29',443),
         'cloudflare':('1.1.1.1',443),'google':('8.8.8.8',443)}
MTR_MAX_HOPS=24
MTR_TIMEOUT_MS=700
MTR_WORKERS=6
MTR_DESTINATION_TTL=64
IP_SUCCESS=0
IP_REQ_TIMED_OUT=11010
IP_TTL_EXPIRED_TRANSIT=11013
IP_UNREACHABLE={11002,11003,11004,11005}
# Status codes representing network messages, as opposed to local API failures.
IP_REPLY_STATUSES={IP_SUCCESS,*IP_UNREACHABLE,11009,11013,11014,11015,11016}
_DNS_SLOTS=threading.BoundedSemaphore(2)

# ICMP_ECHO_REPLY32 is the IcmpParseReplies layout. IcmpSendEcho's synchronous
# reply buffer must instead fit native ICMP_ECHO_REPLY (40 bytes on Win64).
# https://learn.microsoft.com/windows/win32/api/icmpapi/nf-icmpapi-icmpsendecho
class IP_OPTION_INFORMATION32(ctypes.Structure):
    _fields_=[('Ttl',ctypes.c_uint8),('Tos',ctypes.c_uint8),('Flags',ctypes.c_uint8),
              ('OptionsSize',ctypes.c_uint8),('OptionsData',ctypes.c_uint32)]

class ICMP_ECHO_REPLY32(ctypes.Structure):
    _fields_=[('Address',ctypes.c_uint32),('Status',ctypes.c_uint32),('RoundTripTime',ctypes.c_uint32),
              ('DataSize',ctypes.c_uint16),('Reserved',ctypes.c_uint16),('Data',ctypes.c_uint32),
              ('Options',IP_OPTION_INFORMATION32)]

class IP_OPTION_INFORMATION(ctypes.Structure):
    _fields_=[('Ttl',ctypes.c_uint8),('Tos',ctypes.c_uint8),('Flags',ctypes.c_uint8),
              ('OptionsSize',ctypes.c_uint8),('OptionsData',ctypes.c_void_p)]

class ICMP_ECHO_REPLY(ctypes.Structure):
    _fields_=[('Address',ctypes.c_uint32),('Status',ctypes.c_uint32),('RoundTripTime',ctypes.c_uint32),
              ('DataSize',ctypes.c_uint16),('Reserved',ctypes.c_uint16),('Data',ctypes.c_void_p),
              ('Options',IP_OPTION_INFORMATION)]

class ICMPError(OSError):
    def __init__(self,status):
        self.status=int(status)
        super().__init__('ICMP diagnostic error ('+str(self.status)+')')

def _icmp_library():
    if os.name!='nt':raise RuntimeError('ICMP requires Windows / ICMP 需要 Windows')
    from ctypes import wintypes
    lib=ctypes.WinDLL('iphlpapi.dll',use_last_error=True)
    lib.IcmpCreateFile.argtypes=[]
    lib.IcmpCreateFile.restype=wintypes.HANDLE
    lib.IcmpCloseHandle.argtypes=[wintypes.HANDLE]
    lib.IcmpCloseHandle.restype=wintypes.BOOL
    lib.IcmpSendEcho.argtypes=[wintypes.HANDLE,wintypes.ULONG,ctypes.c_void_p,wintypes.WORD,ctypes.POINTER(IP_OPTION_INFORMATION32),ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD]
    lib.IcmpSendEcho.restype=wintypes.DWORD
    return lib


def _icmp_reply(host,timeout_ms=1200,ttl=None):
    """One synchronous IPv4 echo, including the actual replying router address.

    IcmpSendEcho uses IP_OPTION_INFORMATION32 for request options on Win64,
    but its synchronous reply buffer must fit native ICMP_ECHO_REPLY. Never
    dereference embedded reply pointers or read a reply after a zero return.
    """
    if type(timeout_ms) is not int or not 1<=timeout_ms<=1500:
        raise ValueError('Invalid ICMP timeout / ICMP 超时参数无效')
    if ttl is not None and (type(ttl) is not int or not 1<=ttl<=255):
        raise ValueError('Invalid ICMP TTL / ICMP TTL 参数无效')
    try:address=int.from_bytes(ipaddress.IPv4Address(host).packed,'little')
    except ipaddress.AddressValueError:
        raise ValueError('ICMP requires an IPv4 address / ICMP 需要 IPv4 地址') from None
    lib=_icmp_library()
    handle=lib.IcmpCreateFile()
    if handle in (None,0,ctypes.c_void_p(-1).value):raise ICMPError(ctypes.get_last_error())
    try:
        payload=ctypes.create_string_buffer(b'V2Route diagnostic')
        reply=ctypes.create_string_buffer(ctypes.sizeof(ICMP_ECHO_REPLY)+len(payload.value)+8)
        options=IP_OPTION_INFORMATION32()
        if ttl is not None:options.Ttl=ttl
        ctypes.set_last_error(0)
        started=time.perf_counter()
        count=lib.IcmpSendEcho(handle,address,payload,len(payload.value),
            ctypes.byref(options) if ttl is not None else None,reply,len(reply),timeout_ms)
        elapsed=(time.perf_counter()-started)*1000
        status=ctypes.get_last_error() if not count else int(ICMP_ECHO_REPLY.from_buffer(reply).Status)
        source=None;duration=None
        if count:
            value=ICMP_ECHO_REPLY.from_buffer(reply)
            if value.Address:source=socket.inet_ntoa(int(value.Address).to_bytes(4,'little'))
            if source and status in IP_REPLY_STATUSES:
                # Error replies may have no RoundTripTime populated by Windows.
                # Time the synchronous response wait instead, without queue time.
                duration=float(value.RoundTripTime) if status==IP_SUCCESS else elapsed
        received=bool(count and source and status in IP_REPLY_STATUSES)
        return {'statusCode':status,'address':source if received else None,
                'durationMs':round(max(0,duration),2) if duration is not None else None,
                'sent':int((bool(count) and status==IP_SUCCESS) or
                           status in IP_REPLY_STATUSES-{IP_SUCCESS} or status==IP_REQ_TIMED_OUT),
                'received':int(received)}
    finally:lib.IcmpCloseHandle(handle)


def _icmp(host,timeout_ms=1200):
    value=_icmp_reply(host,timeout_ms)
    if value['statusCode']==IP_REQ_TIMED_OUT:raise TimeoutError('ICMP timeout / ICMP 超时')
    if value['statusCode'] or not value['received']:raise ICMPError(value['statusCode'])
    return value['durationMs']

def current_endpoint(choice, predecessor='inherit'):
    import routes
    gui,nodes,groups=routes.snapshot()
    if choice=='follow':
        ident=gui.get('IndexId') or gui.get('indexId')
        node=nodes.get(str(ident))
    elif isinstance(choice,str) and choice.startswith('node:'):
        node=nodes.get(choice[5:])
    else:node=None
    if not node:
        raise ValueError('Select a node or manual proxy profile, or enter a custom target / 请先切换到节点或手动代理情景，或填写自定义目标')
    # Deliberately test the selected final node directly. A predecessor is not
    # dialled by system TCP/ICMP; the response explicitly reports this boundary.
    return node.get('Address'),node.get('Port')


def validate_target(request):
    if not isinstance(request,dict) or request.get('kind') not in ('tcp','ping','mtr') or request.get('target') not in (*TARGETS,'current','custom'):
        raise ValueError('Unsupported diagnostic target / 不支持的检测目标')
    target=request['target']
    allowed={'kind','target','count'}|({'host','port','route','predecessor'} if target=='current' else {'host','port'} if target=='custom' else set())
    if set(request)-allowed:raise ValueError('Unexpected diagnostic fields / 检测参数无效')
    count=request.get('count',3)
    if type(count) is not int or not 1<=count<=5:raise ValueError('Invalid probe count / 探测次数无效')
    if target in TARGETS:return TARGETS[target]
    if target=='current' and 'route' in request:
        if 'host' in request or 'port' in request:raise ValueError('Ambiguous diagnostic target / 检测目标冲突')
        host,port=current_endpoint(request['route'],request.get('predecessor','inherit'))
    else:host,port=request.get('host'),request.get('port',443)
    try:
        from node_import import host as validate_host,integer
        host=validate_host(host);port=integer(port,'port',1,65535)
    except (ValueError,TypeError):raise ValueError('Invalid diagnostic host or port / 检测地址或端口无效') from None
    return host,port


def resolve_bounded(host,port,kind):
    try:
        addr=ipaddress.ip_address(host)
        if addr.version==6 and kind in ('ping','mtr'):
            raise ValueError('IPv6 Ping/MTR is not available; use TCPing / 暂不支持 IPv6 Ping/MTR，请使用 TCPing')
        return str(addr)
    except ValueError as exc:
        if ' / ' in str(exc):raise
    if not _DNS_SLOTS.acquire(blocking=False):
        raise ValueError('DNS lookup busy; retry later / 地址解析正忙，请稍后重试')
    results=queue.Queue(maxsize=1)
    def lookup():
        try:results.put(socket.getaddrinfo(host,port,socket.AF_INET if kind in ('ping','mtr') else socket.AF_UNSPEC,socket.SOCK_STREAM))
        except OSError:results.put(None)
        finally:_DNS_SLOTS.release()
    try:threading.Thread(target=lookup,daemon=True).start()
    except (OSError,RuntimeError):
        _DNS_SLOTS.release()
        raise ValueError('Cannot start DNS lookup / 无法启动地址解析') from None
    try:addresses=results.get(timeout=3)
    except queue.Empty:addresses=None
    if not addresses:
        if kind in ('ping','mtr'):raise ValueError('No IPv4 address or DNS lookup timed out / 无可用 IPv4 地址或解析超时')
        raise ValueError('DNS lookup failed or timed out / 地址解析失败或超时')
    return addresses[0][4][0]


def _mtr_probe(address,ttl,timeout_ms):
    try:
        result=_icmp_reply(address,timeout_ms,ttl)
    except ICMPError as exc:
        result={'statusCode':exc.status,'address':None,'durationMs':None,'sent':0,'received':0}
    except (OSError,RuntimeError):
        result={'statusCode':None,'address':None,'durationMs':None,'sent':0,'received':0}
    code=result['statusCode']
    destination=bool(code==IP_SUCCESS and result['received'] and result['address']==address)
    if destination:status='reached'
    elif code==IP_TTL_EXPIRED_TRANSIT:status='ttl-expired'
    elif code==IP_REQ_TIMED_OUT:status='timeout'
    elif code in IP_UNREACHABLE:status='unreachable'
    else:status='error'
    return {**result,'ttl':ttl,'status':status,'destination':destination}


def _endpoint_context(request,host,address,port=None):
    target=request['target']
    return {'kind':request['kind'],'target':target,'host':host,'address':address,'port':port,
            'scope':'system-direct','usesProxyChain':False,
            'endpointRole':('selected-node' if 'route' in request else 'manual-proxy') if target=='current' else target}


def _mtr_round(request,host,address,probe,clock):
    try:destination=ipaddress.IPv4Address(address)
    except ipaddress.AddressValueError:
        raise ValueError('MTR requires an IPv4 address; use TCPing for IPv6 / MTR 需要 IPv4 地址，IPv6 请使用 TCPing') from None
    if destination.is_multicast or destination.is_unspecified or int(destination)==0xffffffff:
        raise ValueError('MTR requires a unicast IPv4 target / MTR 需要单播 IPv4 目标')
    address=str(destination);started=clock();hops=[];sent=0;destination_ttl=None
    # Fixed limits are not caller-supplied. One native request is a single round;
    # only the visible UI decides whether to request another. Batches stop after
    # a confirmed destination and bound overshoot to five already-running probes.
    with ThreadPoolExecutor(max_workers=MTR_WORKERS,thread_name_prefix='v2route-mtr') as pool:
        endpoint=pool.submit(probe,address,MTR_DESTINATION_TTL,MTR_TIMEOUT_MS)
        for start in range(1,MTR_MAX_HOPS+1,MTR_WORKERS):
            futures=[pool.submit(probe,address,ttl,MTR_TIMEOUT_MS)
                     for ttl in range(start,min(start+MTR_WORKERS,MTR_MAX_HOPS+1))]
            batch=[future.result() for future in futures]
            sent+=sum(hop['sent'] for hop in batch)
            hops.extend(batch)
            reached=[hop['ttl'] for hop in batch if hop['destination']]
            if reached:
                destination_ttl=min(reached)
                hops=[hop for hop in hops if hop['ttl']<=destination_ttl]
                break
            if all(hop['status']=='error' and not hop['sent'] for hop in batch):break
        destination_sample=dict(endpoint.result())
    # A separate, fixed-TTL sample provides one endpoint observation per round.
    # Router timeouts/unreachable messages never become destination packet loss.
    destination_sample['replyReceived']=destination_sample['received']
    destination_sample['received']=int(destination_sample['destination'])
    sent+=destination_sample['sent']
    return {**_endpoint_context(request,host,address),'hops':hops,
            'destinationReached':destination_ttl is not None,'destinationTtl':destination_ttl,
            'destinationSample':destination_sample,
            'outcome':'reached' if destination_ttl is not None else 'error' if not sent else 'incomplete',
            'maxHops':MTR_MAX_HOPS,'timeoutMs':MTR_TIMEOUT_MS,'probeCount':sent,
            'roundDurationMs':round(max(0,clock()-started)*1000,2)}


def run_test(request,connect=socket.create_connection,icmp=_icmp,clock=time.perf_counter,resolve=resolve_bounded,mtr_probe=_mtr_probe):
    host,port=validate_target(request)
    kind=request['kind'];target=request['target'];samples=[]
    address=resolve(host,port,kind)
    if kind=='mtr':return _mtr_round(request,host,address,mtr_probe,clock)
    count=request.get('count',3)
    for _ in range(count):
        try:
            if kind=='ping':duration=icmp(address,1200)
            else:
                start=clock()
                with connect((address,port),timeout=1.5):pass
                duration=(clock()-start)*1000
            samples.append({'ok':True,'durationMs':round(max(0,duration),2)})
        except ICMPError as exc:
            samples.append({'ok':False,'errorCode':'icmp-error','statusCode':exc.status,'error':'ICMP diagnostic error / ICMP 诊断出错'})
        except (OSError,RuntimeError,TimeoutError):
            samples.append({'ok':False,'errorCode':'icmp-no-reply' if kind=='ping' else 'tcp-connect-failed',
                'error':'No ICMP reply / 未收到 ICMP 回应' if kind=='ping' else 'TCP connection failed / TCP 连接失败'})
    successful=[v['durationMs'] for v in samples if v['ok']]
    return {**_endpoint_context(request,host,address,port if kind=='tcp' else None),'successCount':len(successful),
            'outcome':'success' if len(successful)==count else 'partial' if successful else 'error' if any(s.get('errorCode')=='icmp-error' for s in samples) else 'no-reply' if kind=='ping' else 'unreachable',
            'samples':samples,'averageMs':round(sum(successful)/len(successful),2) if successful else None,
            'lossPercent':round((count-len(successful))*100/count,1)}

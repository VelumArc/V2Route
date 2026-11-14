"""One bounded cumulative-path probe in an isolated, automatically killed core."""
import ctypes as C
from ctypes import wintypes as W
import json,socket,ssl,subprocess,tempfile,time,hashlib,threading
from pathlib import Path
import routes,explicit_chain

ROOT=Path(__file__).resolve().parent

def receive(sock,count):
    parts=[]
    while count:
        value=sock.recv(count)
        if not value:raise OSError('Closed')
        parts.append(value);count-=len(value)
    return b''.join(parts)

def connect(port,host='api.ipify.org',target_port=443,timeout=5):
    sock=socket.create_connection(('127.0.0.1',port),timeout=timeout);sock.settimeout(timeout)
    try:
        sock.sendall(b'\x05\x01\x00')
        if receive(sock,2)!=b'\x05\x00':raise OSError('SOCKS authentication')
        address=host.encode('idna')
        if not 1<=len(address)<=253:raise OSError('Target')
        sock.sendall(b'\x05\x01\x00\x03'+bytes([len(address)])+address+target_port.to_bytes(2,'big'))
        head=receive(sock,4)
        if head[:2]!=b'\x05\x00':raise OSError('SOCKS connection')
        size={1:4,4:16}.get(head[3])
        if head[3]==3:size=receive(sock,1)[0]
        if size is None:raise OSError('SOCKS response')
        receive(sock,size+2);return sock
    except BaseException:sock.close();raise

def request(port,timeout):
    with connect(port,timeout=timeout) as raw:
        with ssl.create_default_context().wrap_socket(raw,server_hostname='api.ipify.org') as stream:
            stream.settimeout(timeout);stream.sendall(b'GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n')
            head=b''
            while b'\r\n' not in head and len(head)<1024:
                part=stream.recv(256)
                if not part:break
                head+=part
            if not head.startswith(b'HTTP/1.1 200') and not head.startswith(b'HTTP/1.0 200'):raise OSError('HTTP response')

def build_config(value,data=None):
    fields={'route','chain','index'}
    if not isinstance(value,dict) or set(value) not in (fields,fields|{'predecessor'}):raise ValueError('Invalid chain probe / 链路探测请求无效')
    route=value['route'];chain=explicit_chain.normalize(route,value['chain']);index=value['index'];choices=chain+[route]
    if type(index) is not int or not 0<=index<len(choices):raise ValueError('Invalid chain index / 链路层号无效')
    # No arbitrary destination, headers, executable or listening address is accepted.
    if 'predecessor' in value:
        predecessor=value['predecessor']
        if not isinstance(predecessor,str) or (predecessor not in ('inherit','none') and not explicit_chain.NODE.fullmatch(predecessor)):
            raise ValueError('Invalid legacy predecessor / 继承模式前置无效')
        config,meta=routes.build_choice(route,data=data,predecessor=predecessor)
        if meta.get('chain_values')!=choices:raise ValueError('Chain changed; refresh before testing / 链路已变化，请刷新后再检测')
        # Legacy compilation owns its socket policy. Keep that exact policy and
        # the original tags when choosing cumulative entry-to-exit prefixes.
        config['outbounds']=config['outbounds'][-(index+1):]
    else:
        config,_=routes.build_choice(choices[index],data=data,predecessor='none',chain=choices[:index])
    return config,index

def run(value,request_impl=request,data=None,core=None,private=None):
    config,index=build_config(value,data)
    started=time.monotonic();child=None;job=None;mutex=None;timer=None;expired=threading.Event()
    kernel=C.WinDLL('kernel32',use_last_error=True)
    kernel.CreateMutexW.argtypes=[C.c_void_p,W.BOOL,W.LPCWSTR];kernel.CreateMutexW.restype=W.HANDLE
    kernel.CloseHandle.argtypes=[W.HANDLE];kernel.ReleaseMutex.argtypes=[W.HANDLE]
    mutex=kernel.CreateMutexW(None,True,'Local\\V2Route-chain-probe-'+hashlib.sha256(str(ROOT).encode()).hexdigest()[:16])
    if not mutex:raise OSError('Probe lock unavailable')
    if C.get_last_error()==183:kernel.CloseHandle(mutex);return {'ok':False,'index':index,'code':'BUSY'}
    try:
        import backend
        job=backend.kernel.CreateJobObjectW(None,None);limits=backend.ExtendedLimits();limits.basic.flags=0x2000
        if not job or not backend.kernel.SetInformationJobObject(job,9,C.byref(limits),C.sizeof(limits)):raise OSError('Probe job unavailable')
        directory=Path(private or ROOT/'private');directory.mkdir(parents=True,exist_ok=True);directory=directory.resolve(strict=True)
        with tempfile.TemporaryDirectory(prefix='chain-probe-',dir=directory) as folder:
            folder=Path(folder);assert folder.resolve(strict=True).parent==directory
            with socket.socket() as available:available.bind(('127.0.0.1',0));port=available.getsockname()[1]
            config['log']={'loglevel':'none'};config['inbounds'][0]['port']=port
            path=folder/'config.json';path.write_text(json.dumps(config),'utf-8');executable=Path(core or routes.core_path())
            child=subprocess.Popen([str(executable),'run','-c',str(path)],cwd=executable.parent,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=0x08000000)
            def timeout():
                expired.set()
                if child.poll() is None:
                    try:child.terminate()
                    except OSError:pass
            timer=threading.Timer(8,timeout);timer.daemon=True;timer.start()
            try:
                if not backend.kernel.AssignProcessToJobObject(job,W.HANDLE(int(child._handle))):raise OSError('Probe ownership failed')
                for _ in range(50):
                    if child.poll() is not None:raise OSError('Probe core startup failed')
                    try:
                        with socket.create_connection(('127.0.0.1',port),timeout=.05):break
                    except OSError:time.sleep(.04)
                else:raise TimeoutError('Probe startup timeout')
                request_impl(port,5)
                return {'ok':True,'index':index,'durationMs':round((time.monotonic()-started)*1000),'code':'REACHABLE'}
            finally:
                if child.poll() is None:child.terminate()
                try:child.wait(timeout=2)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=2)
    except (OSError,ValueError,TimeoutError):
        return {'ok':False,'index':index,'durationMs':round((time.monotonic()-started)*1000),'code':'TIMEOUT' if expired.is_set() else 'PATH_FAILED'}
    finally:
        if timer:timer.cancel()
        if child is not None and child.poll() is None:child.kill();child.wait(timeout=2)
        if job:kernel.CloseHandle(job)
        if mutex:kernel.ReleaseMutex(mutex);kernel.CloseHandle(mutex)

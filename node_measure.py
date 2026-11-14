"""Bounded, session-owned node measurements through isolated inherited routes.

No browser/system proxy calls, route-service requests, saved settings or results.
Only the native session may construct a Manager; JSON cannot choose endpoints,
executables, TLS policies or filesystem paths.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import copy,ctypes,hashlib,http.client,json,os,re,shutil,socket,ssl,subprocess,tempfile,threading,time,uuid
from ctypes import wintypes as W
import routes
import explicit_chain

ROOT=Path(__file__).resolve().parent
MIB=1024*1024
MAX_BUDGET=8*1024*MIB
REQUEST_CHUNK=25*MIB
NODE=re.compile(r'node:[A-Za-z0-9_-]{1,128}')
TERMINAL={'completed','failed','cancelled'}

class MeasureError(Exception):
    def __init__(self,code):self.code=code;super().__init__(code)

def _kernel():
    k=ctypes.WinDLL('kernel32',use_last_error=True)
    signatures={
        'CreateMutexW':([ctypes.c_void_p,W.BOOL,W.LPCWSTR],W.HANDLE),
        'WaitForSingleObject':([W.HANDLE,W.DWORD],W.DWORD),
        'ReleaseMutex':([W.HANDLE],W.BOOL),'CloseHandle':([W.HANDLE],W.BOOL),
        'CreateJobObjectW':([ctypes.c_void_p,W.LPCWSTR],W.HANDLE),
        'SetInformationJobObject':([W.HANDLE,ctypes.c_int,ctypes.c_void_p,W.DWORD],W.BOOL),
        'AssignProcessToJobObject':([W.HANDLE,W.HANDLE],W.BOOL),
        'TerminateJobObject':([W.HANDLE,W.UINT],W.BOOL),
        'TerminateProcess':([W.HANDLE,W.UINT],W.BOOL),
        'GetExitCodeProcess':([W.HANDLE,ctypes.POINTER(W.DWORD)],W.BOOL),
        'ResumeThread':([W.HANDLE],W.DWORD),
    }
    for name,(args,result) in signatures.items():
        f=getattr(k,name);f.argtypes=args;f.restype=result
    return k

class _BasicLimits(ctypes.Structure):
    _fields_=[('process_time',ctypes.c_longlong),('job_time',ctypes.c_longlong),('flags',W.DWORD),
              ('min_ws',ctypes.c_size_t),('max_ws',ctypes.c_size_t),('active',W.DWORD),
              ('affinity',ctypes.c_size_t),('priority',W.DWORD),('schedule',W.DWORD)]
class _ExtendedLimits(ctypes.Structure):
    _fields_=[('basic',_BasicLimits),('io',ctypes.c_ulonglong*6),('process_memory',ctypes.c_size_t),
              ('job_memory',ctypes.c_size_t),('peak_process',ctypes.c_size_t),('peak_job',ctypes.c_size_t)]
class _StartupInfo(ctypes.Structure):
    _fields_=[('cb',W.DWORD),('reserved',W.LPWSTR),('desktop',W.LPWSTR),('title',W.LPWSTR),
              ('x',W.DWORD),('y',W.DWORD),('xsize',W.DWORD),('ysize',W.DWORD),
              ('xchars',W.DWORD),('ychars',W.DWORD),('fill',W.DWORD),('flags',W.DWORD),
              ('show',W.WORD),('reserved2size',W.WORD),('reserved2',ctypes.c_void_p),
              ('stdin',W.HANDLE),('stdout',W.HANDLE),('stderr',W.HANDLE)]
class _ProcessInfo(ctypes.Structure):
    _fields_=[('process',W.HANDLE),('thread',W.HANDLE),('pid',W.DWORD),('tid',W.DWORD)]

class _Core:
    """Create suspended, own in a kill-on-close Job, then allow execution."""
    def __init__(self):
        self.k=_kernel();self.lock=threading.RLock();self.job=None;self.process=None;self.pid=None
    def start(self,executable,config):
        with self.lock:
            self.job=self.k.CreateJobObjectW(None,None)
            limits=_ExtendedLimits();limits.basic.flags=0x2000
            if not self.job or not self.k.SetInformationJobObject(self.job,9,ctypes.byref(limits),ctypes.sizeof(limits)):
                raise MeasureError('CORE_OWNERSHIP_FAILED')
            si=_StartupInfo();si.cb=ctypes.sizeof(si);pi=_ProcessInfo()
            create=self.k.CreateProcessW
            create.argtypes=[W.LPCWSTR,W.LPWSTR,ctypes.c_void_p,ctypes.c_void_p,W.BOOL,W.DWORD,
                             ctypes.c_void_p,W.LPCWSTR,ctypes.POINTER(_StartupInfo),ctypes.POINTER(_ProcessInfo)]
            create.restype=W.BOOL
            command=ctypes.create_unicode_buffer(subprocess.list2cmdline([str(executable),'run','-c',str(config)]))
            if not create(str(executable),command,None,None,False,0x08000000|0x4,None,str(executable.parent),ctypes.byref(si),ctypes.byref(pi)):
                raise MeasureError('CORE_START_FAILED')
            self.process,self.pid=pi.process,int(pi.pid)
            try:
                if not self.k.AssignProcessToJobObject(self.job,self.process):
                    self.k.TerminateProcess(self.process,1)
                    raise MeasureError('CORE_OWNERSHIP_FAILED')
                if self.k.ResumeThread(pi.thread)==0xffffffff:raise MeasureError('CORE_START_FAILED')
            finally:self.k.CloseHandle(pi.thread)
    def alive(self):
        with self.lock:
            code=W.DWORD()
            return bool(self.process and self.k.GetExitCodeProcess(self.process,ctypes.byref(code)) and code.value==259)
    def terminate(self):
        with self.lock:
            if self.job:self.k.TerminateJobObject(self.job,1)
    def close(self):
        with self.lock:
            if self.job:self.k.TerminateJobObject(self.job,1)
            if self.process:
                if self.k.WaitForSingleObject(self.process,2000)==258:
                    self.k.TerminateProcess(self.process,1);self.k.WaitForSingleObject(self.process,2000)
                self.k.CloseHandle(self.process);self.process=None
            if self.job:self.k.CloseHandle(self.job);self.job=None

class _Control:
    def __init__(self):
        self.event=threading.Event();self.lock=threading.RLock();self.sockets=set();self.core=None;self.reason='CANCELLED';self.credentials=(uuid.uuid4().hex,uuid.uuid4().hex)
    def check(self):
        if self.event.is_set():raise MeasureError(self.reason)
    def register(self,sock):
        with self.lock:
            if self.event.is_set():
                sock.close();self.check()
            self.sockets.add(sock)
        return sock
    def discard(self,sock):
        with self.lock:self.sockets.discard(sock)
        try:sock.close()
        except OSError:pass
    def abort(self,reason='CANCELLED'):
        with self.lock:
            if not self.event.is_set():self.reason=reason
            self.event.set();sockets=list(self.sockets);core=self.core
        for sock in sockets:
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            try:sock.close()
            except OSError:pass
        if core:core.terminate()

def _receive(sock,count):
    data=b''
    while len(data)<count:
        part=sock.recv(count-len(data))
        if not part:raise MeasureError('CONNECTION_CLOSED')
        data+=part
    return data

def _tls(port,host,target_port,context,control):
    sock=control.register(socket.socket())
    try:
        sock.settimeout(5);sock.connect(('127.0.0.1',port));control.check()
        sock.sendall(b'\x05\x01\x02')
        if _receive(sock,2)!=b'\x05\x02':raise MeasureError('SOCKS_FAILED')
        user,password=(value.encode('ascii') for value in control.credentials)
        sock.sendall(b'\x01'+bytes([len(user)])+user+bytes([len(password)])+password)
        if _receive(sock,2)!=b'\x01\x00':raise MeasureError('SOCKS_FAILED')
        address=host.encode('idna')
        sock.sendall(b'\x05\x01\x00\x03'+bytes([len(address)])+address+target_port.to_bytes(2,'big'))
        response=_receive(sock,4)
        if response[:2]!=b'\x05\x00':raise MeasureError('SOCKS_FAILED')
        size={1:4,4:16}.get(response[3])
        if response[3]==3:size=_receive(sock,1)[0]
        if size is None:raise MeasureError('SOCKS_FAILED')
        _receive(sock,size+2)
        with control.lock:
            control.check();secured=context.wrap_socket(sock,server_hostname=host,do_handshake_on_connect=False)
            control.sockets.discard(sock);control.sockets.add(secured);sock=secured
        sock.settimeout(5);sock.do_handshake();control.check();return sock
    except BaseException:
        control.discard(sock);raise

def _protected_folder(base):
    base=Path(base)
    resolved_root=ROOT.resolve(strict=True)
    for parent in (base,*base.parents):
        if parent==resolved_root:break
        if parent.exists() and (parent.is_symlink() or getattr(parent.lstat(),'st_file_attributes',0)&0x400):
            raise MeasureError('UNSAFE_TEMP_PATH')
    if not base.resolve().is_relative_to(resolved_root):raise MeasureError('UNSAFE_TEMP_PATH')
    base.mkdir(parents=True,exist_ok=True)
    folder=Path(tempfile.mkdtemp(prefix='node-measure-',dir=base)).resolve(strict=True)
    if folder.parent!=base.resolve(strict=True):raise MeasureError('UNSAFE_TEMP_PATH')
    try:
        import csv
        output=subprocess.check_output(['whoami','/user','/fo','csv','/nh'],creationflags=0x08000000,timeout=2)
        sid=list(csv.reader(output.decode(errors='replace').splitlines()))[-1][-1]
        if not re.fullmatch(r'S-1-[0-9-]+',sid):raise MeasureError('PRIVATE_DIRECTORY_FAILED')
        subprocess.run(['icacls',str(folder),'/inheritance:r','/grant:r',f'*{sid}:(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],
                       check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=0x08000000,timeout=3)
        return folder
    except BaseException:
        _remove_folder(folder,base);raise

def _remove_folder(folder,base):
    folder=Path(folder);base=Path(base).resolve(strict=True)
    if not folder.exists():return
    if folder.is_symlink() or getattr(folder.lstat(),'st_file_attributes',0)&0x400:raise MeasureError('UNSAFE_TEMP_PATH')
    if folder.resolve(strict=True).parent!=base or not folder.name.startswith('node-measure-'):
        raise MeasureError('UNSAFE_TEMP_PATH')
    shutil.rmtree(folder)

class Manager:
    """Per-native-Port owner. Constructor injections are only for local tests."""
    def __init__(self,*,snapshot=None,core=None,private=None,endpoint=None,tls_context=None,phase_timeout=60,latency_timeout=8):
        self._snapshot=snapshot or routes.snapshot;self._core=core or routes.core_path
        self._private=Path(private or ROOT/'private');self._endpoint=endpoint or ('speed.cloudflare.com',443)
        self._context=tls_context or ssl.create_default_context();self._phase_timeout=phase_timeout;self._latency_timeout=latency_timeout
        self.lock=threading.RLock();self.job=None;self.closed=False
    def handle(self,command,settings):
        if not isinstance(settings,dict):raise ValueError('BAD_OPTIONS')
        if command=='nodeMeasureStart':return self._start(settings)
        if command not in ('nodeMeasurePoll','nodeMeasureCancel'):raise ValueError('BAD_COMMAND')
        if set(settings)-{'jobId','afterSeq'}:raise ValueError('BAD_OPTIONS')
        with self.lock:
            job=self.job
            if not job or settings.get('jobId')!=job['id']:raise ValueError('JOB_NOT_FOUND')
            cursor=settings.get('afterSeq',0)
            if type(cursor) is not int or not 0<=cursor<=job['seq']:raise ValueError('BAD_CURSOR')
            if command=='nodeMeasureCancel' and job['state'] not in TERMINAL:
                job['cancel'].set();job['state']='cancelling'
                controls=list(job['controls'].values())
            else:controls=[]
        for control in controls:control.abort()
        return self._result(job,cursor)
    def _start(self,value):
        if set(value)-{'nodeIds','mode','trafficMiB','concurrency'}:raise ValueError('BAD_OPTIONS')
        nodes=value.get('nodeIds');mode=value.get('mode','quick');traffic=value.get('trafficMiB',10)
        concurrency=value.get('concurrency',2 if mode=='quick' else 1)
        if not isinstance(nodes,list) or not 1<=len(nodes)<=1000 or any(not isinstance(n,str) or not NODE.fullmatch(n) for n in nodes) or len(nodes)!=len(set(nodes)):
            raise ValueError('BAD_NODES')
        if mode not in ('quick','full') or type(traffic) is not int or traffic not in (10,25,50,100) or type(concurrency) is not int or not 1<=concurrency<=3:
            raise ValueError('BAD_OPTIONS')
        concurrency=1 if mode=='full' else concurrency
        budget=len(nodes)*2*traffic*MIB if mode=='full' else 0
        if budget>MAX_BUDGET:raise ValueError('BUDGET_EXCEEDED')
        with self.lock:
            if self.closed:raise ValueError('SESSION_CLOSED')
            if self.job and self.job['state'] not in TERMINAL:raise ValueError('BUSY')
            job={'id':uuid.uuid4().hex,'seq':0,'state':'queued','mode':mode,'traffic':traffic,'concurrency':concurrency,'budget':budget,
                 'rows':{},'rowseq':{},'cancel':threading.Event(),'controls':{},'phaseclock':{},'error':None,'thread':None,'started':time.monotonic()}
            for route in nodes:
                job['rows'][route]={'route':route,'state':'queued','phase':'queued','latencyMs':None,'downloadMbps':None,'uploadMbps':None,
                    'downloadAverageMbps':None,'uploadAverageMbps':None,'bytes':{'download':0,'upload':0},
                    'duration':{'startup':0,'latency':0,'download':0,'upload':0,'total':0},'errorCode':None,'chainValues':[]}
                self._changed(job,route)
            self.job=job;worker=threading.Thread(target=self._run,args=(job,),daemon=True,name='node-measure-job');job['thread']=worker;worker.start()
        return self._result(job,0)
    def _changed(self,job,route):
        job['seq']+=1;job['rowseq'][route]=job['seq']
    def _result(self,job,cursor):
        with self.lock:
            changed=sorted((seq,route) for route,seq in job['rowseq'].items() if seq>cursor)
            page=changed[:100];more=len(changed)>100
            seq=page[-1][0] if more else job['seq']
            rows=copy.deepcopy([job['rows'][route] for _,route in page])
            return {'jobId':job['id'],'seq':seq,'state':job['state'],'total':len(job['rows']),
                    'completed':sum(r['state'] in TERMINAL for r in job['rows'].values()),
                    'succeeded':sum(r['state']=='completed' for r in job['rows'].values()),'rows':rows,'hasMore':more,
                    'mode':job['mode'],'trafficMiB':job['traffic'],'concurrency':job['concurrency'],'budgetBytes':job['budget'],'errorCode':job['error']}
    def _run(self,job):
        k=_kernel();mutex=None;owned=False;folder=None;tick_stop=threading.Event();ticker=None
        try:
            name='Local\\V2Route-node-measure-'+hashlib.sha256(str(ROOT.resolve()).encode()).hexdigest()[:16]
            mutex=k.CreateMutexW(None,False,name)
            if not mutex or k.WaitForSingleObject(mutex,0) not in (0,0x80):raise MeasureError('BUSY')
            owned=True
            if job['cancel'].is_set():raise MeasureError('CANCELLED')
            data=copy.deepcopy(self._snapshot());core=Path(self._core()).resolve(strict=True)
            folder=_protected_folder(self._private)
            with self.lock:job['state']='running'
            ticker=threading.Thread(target=self._ticks,args=(job,tick_stop),daemon=True);ticker.start()
            with ThreadPoolExecutor(max_workers=job['concurrency'],thread_name_prefix='node-measure') as pool:
                futures=[pool.submit(self._node,job,route,data,core,folder) for route in job['rows']]
                for future in futures:future.result()
        except Exception as exc:
            code=exc.code if isinstance(exc,MeasureError) else 'PREPARATION_FAILED'
            with self.lock:
                job['error']=code
                for route,row in job['rows'].items():
                    if row['state'] not in TERMINAL:
                        row.update(state='cancelled' if job['cancel'].is_set() else 'failed',errorCode=code,phase='done');self._changed(job,route)
        finally:
            tick_stop.set()
            if ticker:ticker.join(timeout=2)
            if folder:
                try:_remove_folder(folder,self._private)
                except Exception:
                    with self.lock:job['error']='CLEANUP_FAILED'
            if owned:k.ReleaseMutex(mutex)
            if mutex:k.CloseHandle(mutex)
            with self.lock:
                job['state']='cancelled' if job['cancel'].is_set() else 'failed' if job['error'] else 'completed'
    def _ticks(self,job,stop):
        while not stop.wait(1):
            now=time.monotonic()
            with self.lock:
                for route,(phase,started,last,previous) in list(job['phaseclock'].items()):
                    row=job['rows'][route]
                    if row['state']!='running' or row['phase']!=phase:continue
                    current=row['bytes'][phase]
                    row[phase+'Mbps']=round(max(0,current-previous)*8/max(.001,now-last)/1e6,2)
                    row['duration'][phase]=round((now-started)*1000,2)
                    job['phaseclock'][route]=(phase,started,now,current);self._changed(job,route)
    def _node(self,job,route,data,executable,folder):
        control=_Control();core=_Core();control.core=core;started=time.monotonic()
        with self.lock:
            row=job['rows'][route];job['controls'][route]=control
            if job['cancel'].is_set():control.abort()
            row.update(state='running',phase='startup');self._changed(job,route)
        try:
            control.check()
            try:config,meta=routes.build_choice(route,data=data,predecessor='inherit')
            except (ValueError,KeyError,TypeError):raise MeasureError('ROUTE_UNAVAILABLE') from None
            with self.lock:row['chainValues']=list(meta.get('chain_values',[]));self._changed(job,route)
            with socket.socket() as free:
                free.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1);free.bind(('127.0.0.1',0));port=free.getsockname()[1]
            explicit_chain.reject_entrance_loops(config,{port})
            config['log']={'loglevel':'none'};config['inbounds'][0]['port']=port
            user,password=control.credentials
            config['inbounds'][0]['settings']={'auth':'password','accounts':[{'user':user,'pass':password}],'udp':False}
            path=folder/(uuid.uuid4().hex+'.json');path.write_text(json.dumps(config),'utf-8')
            core.start(executable,path)
            deadline=time.monotonic()+3
            while True:
                control.check()
                if not core.alive():raise MeasureError('CORE_START_FAILED')
                try:
                    with socket.create_connection(('127.0.0.1',port),timeout=.05):break
                except OSError:
                    if time.monotonic()>=deadline:raise MeasureError('CORE_START_TIMEOUT')
                    control.event.wait(.025)
            with self.lock:row['duration']['startup']=round((time.monotonic()-started)*1000,2);row['phase']='latency';self._changed(job,route)
            samples=[];latency_started=time.monotonic()
            for _ in range(3):
                control.check();tick=time.monotonic();self._http(port,control,'latency',0,None,self._latency_timeout)
                samples.append((time.monotonic()-tick)*1000)
            with self.lock:
                row['latencyMs']=round(sum(samples)/len(samples),2);row['duration']['latency']=round((time.monotonic()-latency_started)*1000,2);self._changed(job,route)
            if job['mode']=='full':
                for phase in ('download','upload'):
                    control.check();phase_started=time.monotonic()
                    with self.lock:
                        row['phase']=phase;row[phase+'Mbps']=0.0;job['phaseclock'][route]=(phase,phase_started,phase_started,0);self._changed(job,route)
                    def progress(amount):
                        with self.lock:row['bytes'][phase]+=amount
                    # Cloudflare rejects a single 100 MiB request. Keep the
                    # selected phase budget while bounding each HTTP body.
                    remaining=job['traffic']*MIB
                    while remaining:
                        control.check();budget=self._phase_timeout-(time.monotonic()-phase_started)
                        if budget<=0:raise MeasureError('TIMEOUT')
                        amount=min(REQUEST_CHUNK,remaining)
                        self._http(port,control,phase,amount,progress,budget);remaining-=amount
                    control.check();elapsed=max(.001,time.monotonic()-phase_started)
                    with self.lock:
                        job['phaseclock'].pop(route,None);row['duration'][phase]=round(elapsed*1000,2)
                        row[phase+'AverageMbps']=round(row['bytes'][phase]*8/elapsed/1e6,2);row[phase+'Mbps']=None;self._changed(job,route)
            control.check()
            with self.lock:row.update(state='completed',phase='done');self._changed(job,route)
        except Exception as exc:
            code=control.reason if control.event.is_set() else exc.code if isinstance(exc,MeasureError) else 'TLS_FAILED' if isinstance(exc,ssl.SSLError) else 'NETWORK_FAILED'
            with self.lock:
                row.update(state='cancelled' if code=='CANCELLED' else 'failed',phase='done',errorCode=code,downloadMbps=None,uploadMbps=None);self._changed(job,route)
        finally:
            control.abort();core.close()
            with self.lock:
                clock=job['phaseclock'].pop(route,None)
                if clock:row['duration'][clock[0]]=round((time.monotonic()-clock[1])*1000,2)
                job['controls'].pop(route,None)
                row['duration']['total']=round((time.monotonic()-started)*1000,2);self._changed(job,route)
    def _http(self,port,control,phase,size,progress,timeout):
        host,target_port=self._endpoint;sock=None;response=None
        timer=threading.Timer(timeout,control.abort,args=('TIMEOUT',));timer.daemon=True;timer.start()
        try:
            control.check();sock=_tls(port,host,target_port,self._context,control)
            path='/__up' if phase=='upload' else '/__down?bytes='+str(size)+'&_v2r='+uuid.uuid4().hex
            method='POST' if phase=='upload' else 'GET'
            headers=f'{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nAccept-Encoding: identity\r\nCache-Control: no-store\r\n'
            if phase=='upload':headers+=f'Content-Length: {size}\r\nContent-Type: application/octet-stream\r\n'
            sock.sendall((headers+'\r\n').encode('ascii'))
            if phase=='upload':
                sent=0;chunk=b'\x00'*65536
                while sent<size:
                    control.check();part=chunk[:min(len(chunk),size-sent)];sock.sendall(part);sent+=len(part);progress(len(part))
            response=http.client.HTTPResponse(sock);response.begin();control.check()
            if not 200<=response.status<300:raise MeasureError('HTTP_STATUS')
            if response.getheader('Content-Encoding','identity').lower() not in ('','identity'):raise MeasureError('HTTP_ENCODING')
            if phase in ('latency','download'):
                length=response.getheader('Content-Length')
                if length is None or not length.isdecimal() or int(length)!=size or response.chunked:
                    raise MeasureError('HTTP_LENGTH')
            if phase=='download':
                received=0
                while received<size:
                    control.check();chunk=response.read(min(65536,size-received))
                    if not chunk:raise MeasureError('PARTIAL_TRANSFER')
                    received+=len(chunk);progress(len(chunk))
            elif phase=='upload':
                # Read a bounded acknowledgement, never an unbounded response body.
                if len(response.read(65537))>65536:raise MeasureError('HTTP_RESPONSE_TOO_LARGE')
        except (socket.timeout,TimeoutError):raise MeasureError('TIMEOUT') from None
        finally:
            timer.cancel()
            if response:response.close()
            if sock:control.discard(sock)
    def close(self):
        with self.lock:
            self.closed=True;job=self.job
            if not job:return
            job['cancel'].set();controls=list(job['controls'].values());worker=job['thread']
        for control in controls:control.abort()
        if worker and worker is not threading.current_thread():worker.join(timeout=10)

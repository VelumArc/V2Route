"""Persistent independent SOCKS entrances for arbitrary ZeroOmega bindings."""
import argparse
import atexit
import copy
import csv
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
from multiprocessing.connection import Client, Listener
import os
from pathlib import Path
import socket
import sqlite3
import subprocess as S
import sys
import threading
import time
import routes
import discovery

ROOT=Path(__file__).resolve().parent
PRIVATE=ROOT/'private'
# Fresh portable installations allocate every missing entrance dynamically.
# Persisted mappings, including legacy ph/default, are never reassigned.
PORTS={}
NEW_PORT_START=20080
NEW_PORT_END=65535
PIPE=r'\\.\pipe\V2Route-'+hashlib.sha256(str(ROOT).encode()).hexdigest()[:16]
NO_WINDOW=0x08000000
kernel=C.WinDLL('kernel32',use_last_error=True)
kernel.CreateMutexW.argtypes=[C.c_void_p,W.BOOL,W.LPCWSTR];kernel.CreateMutexW.restype=W.HANDLE
kernel.CreateJobObjectW.argtypes=[C.c_void_p,W.LPCWSTR];kernel.CreateJobObjectW.restype=W.HANDLE
kernel.SetInformationJobObject.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD]
kernel.AssignProcessToJobObject.argtypes=[W.HANDLE,W.HANDLE]
kernel.CloseHandle.argtypes=[W.HANDLE]

def atomic_json(path,value):
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(temp,path)

def secure_storage():
    PRIVATE.mkdir(exist_ok=True)
    row=S.check_output(['whoami','/user','/fo','csv','/nh'],creationflags=NO_WINDOW)
    sid=list(csv.reader(row.decode(errors='replace').splitlines()))[-1][-1]
    if not sid.startswith('S-1-5-'):raise RuntimeError('Cannot identify current Windows user')
    S.run(['icacls',str(PRIVATE),'/inheritance:r','/grant:r',f'*{sid}:(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],check=True,stdout=S.DEVNULL,stderr=S.DEVNULL,creationflags=NO_WINDOW)
    key=PRIVATE/'control.key'
    if not key.exists():
        with key.open('xb') as output:output.write(os.urandom(32))
    return key.read_bytes()

def _rename_dialers(value,mapping):
    if isinstance(value,dict):
        for key,item in value.items():
            if key in ('dialerProxy','outboundTag') and isinstance(item,str) and item in mapping:value[key]=mapping[item]
            else:_rename_dialers(item,mapping)
    elif isinstance(value,list):
        for item in value:_rename_dialers(item,mapping)

def allocate_ports(settings):
    """Allocate only missing mappings; never reassign an existing binding."""
    result=copy.deepcopy(settings)
    ports=result.setdefault('ports',{})
    for slot,port in PORTS.items():
        if slot in result['buttons'] and slot not in ports:
            if port in ports.values():raise ValueError('旧线路的固定端口已被其他绑定占用')
            ports[slot]=port
    reserved=set(ports.values())
    next_port=NEW_PORT_START
    for slot in result['buttons']:
        if slot in ports:continue
        while next_port<=NEW_PORT_END:
            port=next_port;next_port+=1
            if port in reserved:continue
            try:
                with socket.socket() as probe:
                    probe.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
                    probe.bind(('127.0.0.1',port))
            except OSError:continue
            ports[slot]=port;reserved.add(port);break
        else:raise ValueError('没有可用的本地线路端口，请释放端口后重试')
    return result

def build_multi(settings=None,allow_invalid=False,strict_slots=None,location=None):
    settings=routes.normalize_settings(settings or routes.load_settings())
    ports=settings['ports']
    if set(ports)!=set(settings['buttons']):raise ValueError('线路尚未分配完整端口')
    location=location or routes.location()
    try:data=routes.snapshot(location['selected'],discover=False)
    except (OSError,ValueError,sqlite3.Error):data=routes.snapshot(discover=False)
    result={'log':{'loglevel':'error','access':'none'},'inbounds':[],'outbounds':[],
            'routing':{'domainStrategy':'AsIs','rules':[]}}
    statuses={}
    for slot,port in ports.items():
        choice=settings['buttons'][slot]['route']
        try:
            config,meta=routes.build_choice(choice,data,settings['buttons'][slot].get('predecessor','inherit'),chain=settings['buttons'][slot].get('chain'))
            if 'chain' in settings['buttons'][slot]:
                import explicit_chain
                explicit_chain.reject_entrance_loops(config,ports.values())
            if meta.get('upstream_port') in ports.values():raise ValueError('V2入口与本工具端口冲突，不能形成代理循环')
            outgoing=config['outbounds']
            state={'ok':True,'error':'','chain':meta.get('chain',[])}
        except (ValueError,KeyError,TypeError) as exc:
            if not allow_invalid or slot in (strict_slots or set()):raise ValueError(f'{settings["buttons"][slot]["label"]}: {exc}') from exc
            outgoing=[{'tag':'exit','protocol':'blackhole','settings':{}}]
            state={'ok':False,'error':str(exc),'chain':[]}
        mapping={item['tag']:slot+'/'+item['tag'] for item in outgoing}
        for item in outgoing:
            item['tag']=mapping[item['tag']];_rename_dialers(item,mapping)
        result['inbounds'].append({'tag':slot,'listen':'127.0.0.1','port':port,'protocol':'socks','settings':{'auth':'noauth','udp':False}})
        result['outbounds'].extend(outgoing)
        result['routing']['rules'].append({'type':'field','inboundTag':[slot],'outboundTag':slot+'/exit'})
        statuses[slot]={**state,'port':port,'route':choice}
    return result,statuses

# Compatibility for local verification scripts; settings must have allocated ports.
build_dual=build_multi

class BasicLimits(C.Structure):
    _fields_=[('process_time',C.c_longlong),('job_time',C.c_longlong),('flags',W.DWORD),('min_ws',C.c_size_t),('max_ws',C.c_size_t),('active',W.DWORD),('affinity',C.c_size_t),('priority',W.DWORD),('schedule',W.DWORD)]
class ExtendedLimits(C.Structure):
    _fields_=[('basic',BasicLimits),('io',C.c_ulonglong*6),('process_memory',C.c_size_t),('job_memory',C.c_size_t),('peak_process',C.c_size_t),('peak_job',C.c_size_t)]

class Controller:
    def __init__(self):
        self.lock=threading.RLock();self.child=None;self.config=None;self.config_core=None;self.slots={};self.error='';self.stopping=False
        saved=routes.load_settings()
        self.ports={**{s:p for s,p in PORTS.items() if s in saved['buttons']},**saved.get('ports',{})}
        self.job=kernel.CreateJobObjectW(None,None)
        limits=ExtendedLimits();limits.basic.flags=0x2000
        if not self.job or not kernel.SetInformationJobObject(self.job,9,C.byref(limits),C.sizeof(limits)):raise C.WinError(C.get_last_error())
        atexit.register(self.close)
    def close(self):
        with self.lock:
            self.stop_child()
            if self.job:kernel.CloseHandle(self.job);self.job=None
    def stop_child(self):
        if self.child is not None:
            if self.child.poll() is None:
                self.child.terminate()
                try:self.child.wait(timeout=5)
                except S.TimeoutExpired:self.child.kill();self.child.wait(timeout=5)
            self.child=None
    def status(self):
        with self.lock:
            running=self.child is not None and self.child.poll() is None
            slots=copy.deepcopy(self.slots)
            idle=not self.ports and not self.error
            issue=self.error or ('' if running or idle else '独立线路后台尚未就绪')
            for slot,port in self.ports.items():
                slots.setdefault(slot,{'ok':False,'error':issue,'port':port,'chain':[]})
                if issue:slots[slot].update(ok=False,error=issue)
            healthy=(running or idle) and not issue and all(slots[s].get('ok',False) for s in self.ports)
            return {'ok':healthy,'running':running,'pid':self.child.pid if self.child else None,
              'helper_pid':os.getpid(),'ports':dict(self.ports),'slots':slots,'error':issue,'idle':idle}
    def combined(self):
        with self.lock:return {'ok':True,'status':self.status(),'catalog':routes.catalog(),'capabilities':{'explicitChains':True,'chainProbe':True}}
    def validate(self,config,core):
        path=PRIVATE/'candidate.json';atomic_json(path,config)
        check=S.run([str(core),'run','-test','-config',str(path)],cwd=core.parent,
          stdout=S.PIPE,stderr=S.STDOUT,timeout=20,creationflags=NO_WINDOW)
        (PRIVATE/'core-test.log').write_bytes(check.stdout)
        if check.returncode:raise ValueError('线路配置未通过核心校验，保留原配置')
    def start_child(self,config,core):
        path=PRIVATE/'active.json';atomic_json(path,config)
        with (PRIVATE/'core.log').open('wb') as log:
            child=S.Popen([str(core),'run','-config',str(path)],cwd=core.parent,
              stdin=S.DEVNULL,stdout=log,stderr=S.STDOUT,creationflags=NO_WINDOW)
        if not kernel.AssignProcessToJobObject(self.job,W.HANDLE(int(child._handle))):
            child.terminate();child.wait(timeout=5);raise RuntimeError('无法安全管理线路核心')
        self.child=child
        for _ in range(60):
            if child.poll() is not None:raise RuntimeError('线路核心启动失败，请查看 private/core.log')
            try:
                for port in (item['port'] for item in config['inbounds']):
                    with socket.create_connection(('127.0.0.1',port),timeout=.15):pass
                return
            except OSError:time.sleep(.05)
        self.stop_child();raise RuntimeError('线路核心启动超时')
    def apply(self,config,slots,core=None):
        if not config['inbounds']:
            self.stop_child();self.config=None;self.config_core=None;self.slots={};self.ports={};self.error='';return
        core=Path(core) if core is not None else routes.core_path()
        if self.config==config and self.config_core==core and self.status()['running']:
            self.slots=slots;self.error='';return
        self.validate(config,core)
        occupied_by_us=set(self.ports.values()) if self.child is not None and self.child.poll() is None else set()
        bound=[]
        try:
            for port in (item['port'] for item in config['inbounds']):
                if port in occupied_by_us:continue
                probe=socket.socket();bound.append(probe)
                probe.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1);probe.bind(('127.0.0.1',port))
        finally:
            for probe in bound:probe.close()
        old=self.config;old_slots=self.slots;old_core=self.config_core
        self.stop_child()
        try:self.start_child(config,core)
        except Exception:
            self.stop_child()
            if old:
                try:self.start_child(old,old_core)
                except Exception:self.error='新核心和原核心均未能恢复';raise
            self.slots=old_slots
            raise
        self.config=config;self.config_core=core;self.slots=slots;self.ports={slot:state['port'] for slot,state in slots.items()};self.error=''
    def release_slot(self,value):
        with self.lock:
            if not isinstance(value,dict) or set(value)!={'id'} or not isinstance(value['id'],str) or not routes.BINDING_ID.fullmatch(value['id']):
                raise ValueError('Invalid binding identifier / 绑定标识无效')
            old=routes.load_settings();ident=value['id']
            if ident not in old['buttons']:return self.combined()
            candidate=routes.normalize_settings({**old,'revision':old['revision']+1,
                'buttons':{k:v for k,v in old['buttons'].items() if k!=ident},
                'ports':{k:v for k,v in old['ports'].items() if k!=ident}})
            location=routes.location()
            config,slots=build_multi(candidate,allow_invalid=True,location=location)
            old_config=copy.deepcopy(self.config);old_slots=copy.deepcopy(self.slots);old_core=self.config_core;old_ports=dict(self.ports)
            try:
                self.apply(config,slots,location['core_path']);atomic_json(routes.SETTINGS,candidate)
            except Exception:
                if old_config:self.apply(old_config,old_slots,old_core)
                else:self.stop_child();self.config=None;self.config_core=None;self.slots=old_slots;self.ports=old_ports
                raise
            return self.combined()
    def host_settings(self,value):
        from core_manager import settings_lock
        with self.lock, settings_lock(routes.HOST_SETTINGS):
            if not isinstance(value,dict) or set(value)-{'v2raynRoot','corePath'} or any(not isinstance(v,str) or len(v)>1024 or '\0' in v for v in value.values()):
                raise ValueError('Invalid companion settings / 本地组件设置无效')
            candidate=json.loads(routes.HOST_SETTINGS.read_text(encoding='utf-8')) if routes.HOST_SETTINGS.exists() else {}
            if value.get('v2raynRoot'):
                checked=discovery.validate_root(value['v2raynRoot'])
                if not checked['valid']:raise ValueError('Invalid v2rayN directory / v2rayN 目录无效')
            if 'corePath' in value:
                if value['corePath']:
                    path=Path(value['corePath']).resolve(strict=True)
                    if path.name.casefold()!='xray.exe' or not path.is_file():raise ValueError('Select xray.exe / 请选择 xray.exe')
                    with path.open('rb') as handle:
                        if handle.read(2)!=b'MZ':raise ValueError('Not a Windows Xray executable / 不是 Windows Xray 程序')
                    candidate['corePath']=str(path)
                else:candidate.pop('corePath',None)
            if value.get('v2raynRoot'):
                result=discovery.select_root(value['v2raynRoot'])
                if not result['ok']:raise ValueError('Cannot save v2rayN directory / 无法保存 v2rayN 目录')
            elif 'v2raynRoot' in value:
                discovery.clear_selection()
            routes.HOST_SETTINGS.parent.mkdir(parents=True,exist_ok=True)
            atomic_json(routes.HOST_SETTINGS,candidate)
            return self.ensure()
    def rescan(self):
        """Refresh discovery/catalog only; never switch active browser/core routes."""
        with self.lock:
            report=discovery.inspect_candidates(force_scan=True)
            result=self.combined()
            # Preserve the full scan diagnostics rather than a later cached view.
            result['catalog']['discovery']=report
            return result
    def ensure(self):
        with self.lock:
            old_config=copy.deepcopy(self.config);old_slots=copy.deepcopy(self.slots);old_ports=dict(self.ports);old_core=self.config_core
            try:
                old=routes.load_settings();settings=allocate_ports(old)
                location=routes.location()
                config,slots=build_multi(settings,allow_invalid=True,location=location)
                self.apply(config,slots,location['core_path'])
                if settings!=old:atomic_json(routes.SETTINGS,settings)
            except Exception as exc:
                if self.config!=old_config or self.config_core!=old_core:
                    if old_config:
                        try:self.apply(old_config,old_slots,old_core)
                        except Exception:pass
                    else:
                        self.stop_child();self.config=None;self.config_core=None;self.slots=old_slots;self.ports=old_ports
                self.error=str(exc)
            return self.combined()
    def configure(self,value):
        with self.lock:
            old=routes.load_settings();submitted=routes.normalize_settings(value)
            if submitted['revision']!=old['revision']:raise ValueError('设置已在另一窗口修改，请重新打开设置')
            old_ports=old.get('ports',{})
            # Browser callers may echo existing records, but cannot choose ports.
            if any(old_ports.get(slot)!=port for slot,port in submitted['ports'].items()):
                raise ValueError('本地线路端口由后台分配，不能在浏览器修改')
            candidate=routes.normalize_settings({**submitted,'buttons':{**old['buttons'],**submitted['buttons']},'ports':old_ports})
            candidate=allocate_ports(candidate)
            changed={slot for slot,item in candidate['buttons'].items() if slot not in old['buttons'] or item['route']!=old['buttons'][slot]['route'] or item.get('predecessor','inherit')!=old['buttons'][slot].get('predecessor','inherit') or item.get('chain')!=old['buttons'][slot].get('chain')}
            location=routes.location()
            config,slots=build_multi(candidate,allow_invalid=True,strict_slots=changed,location=location)
            old_config=copy.deepcopy(self.config);old_slots=copy.deepcopy(self.slots)
            old_runtime_ports=dict(self.ports);old_core=self.config_core
            candidate['revision']+=1
            try:
                self.apply(config,slots,location['core_path'])
                atomic_json(routes.SETTINGS,candidate)
            except Exception:
                if old_config and (self.config!=old_config or self.config_core!=old_core):self.apply(old_config,old_slots,old_core)
                elif old_config is None:
                    self.stop_child();self.config=None;self.config_core=None;self.slots=old_slots;self.ports=old_runtime_ports
                raise
            return self.combined()
    def reorder(self,value):
        with self.lock:
            old=routes.load_settings()
            if not isinstance(value,dict) or value.get('revision')!=old['revision']:raise ValueError('设置已在另一窗口修改，请重新打开设置')
            order=value.get('groups');catalog=routes.catalog();populated={r['group_id'] for r in catalog['routes'] if r['value']!='follow'}
            valid=populated|{g['id'] for g in catalog.get('groups',[])}
            if not isinstance(order,list) or any(not isinstance(g,str) for g in order) or len(order)!=len(set(order)) or not populated.issubset(set(order)) or not set(order).issubset(valid):raise ValueError('分组列表已变化，请重新打开设置后排序')
            # Older pickers only submit populated groups. Keep empty local
            # groups in the shared order without making those pickers fail.
            order=order+[g for g in old.get('group_order',[]) if g in valid and g not in order]+sorted(valid-set(order)-set(old.get('group_order',[])))
            value=routes.normalize_settings({**old,'group_order':order,'revision':old['revision']+1})
            atomic_json(routes.SETTINGS,value)
            return self.combined()

def request(command,settings=None):
    key=(PRIVATE/'control.key').read_bytes()
    with Client(PIPE,family='AF_PIPE',authkey=key) as connection:
        connection.send_bytes(json.dumps({'command':command,'settings':settings}).encode())
        if not connection.poll(65):raise TimeoutError('线路后台没有及时响应')
        return json.loads(connection.recv_bytes(2*1024*1024))

def serve(controller,key,done):
    with Listener(PIPE,family='AF_PIPE',authkey=key) as listener:
        while not controller.stopping:
            try:connection=listener.accept()
            except Exception:
                if controller.stopping:return
                continue
            try:
                with connection:
                    if not connection.poll(5):continue
                    raw=connection.recv_bytes(1024*1024)
                    try:
                        data=json.loads(raw);command=data['command']
                        if command in ('status','getState'):result=controller.combined()
                        elif command=='ensure':result=controller.ensure()
                        elif command=='configure':result=controller.configure(data.get('settings'))
                        elif command=='reorder':result=controller.reorder(data.get('settings'))
                        elif command in ('importLinks','removeNode'):
                            raise ValueError('Use the native library command / 请通过扩展本地节点库操作')
                        elif command=='releaseSlot':result=controller.release_slot(data.get('settings'))
                        elif command=='hostSettings':result=controller.host_settings(data.get('settings'))
                        elif command=='rescan':result=controller.rescan()
                        elif command=='stop':controller.stopping=True;result={'ok':True,'stopped':True}
                        else:raise ValueError('Unsupported command')
                    except Exception as exc:result={'ok':False,'error':str(exc)}
                    connection.send_bytes(json.dumps(result,ensure_ascii=False).encode())
            except (EOFError,OSError):pass
            if controller.stopping:done();return

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--status',action='store_true');parser.add_argument('--stop',action='store_true');parser.add_argument('--headless',action='store_true')
    args=parser.parse_args()
    if args.status or args.stop:
        result=request('stop' if args.stop else 'status')
        if sys.stdout:print(json.dumps(result,ensure_ascii=False))
        return
    mutex=kernel.CreateMutexW(None,False,'Local\\V2Route-'+hashlib.sha256(str(ROOT).encode()).hexdigest()[:16])
    if C.get_last_error()==183:kernel.CloseHandle(mutex);return
    if not mutex:raise C.WinError(C.get_last_error())
    key=secure_storage();controller=Controller()
    try:controller.ensure()
    except Exception as exc:controller.error=str(exc)
    done=threading.Event();threading.Thread(target=serve,args=(controller,key,done.set),daemon=True).start()
    done.wait();controller.close();kernel.CloseHandle(mutex)

if __name__=='__main__':
    try:main()
    except Exception:
        import traceback
        (ROOT/'backend-error.log').write_text(traceback.format_exc(),encoding='utf-8')
        if sys.stdout:raise

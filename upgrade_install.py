"""Explicit, bounded companion upgrades. Never copies browser or v2rayN data."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
import uuid

ROOT=Path(__file__).resolve().parent
NO_WINDOW=0x08000000
STATE_FILES={'settings.json':1024*1024,'private/imported-nodes.json':16*1024*1024,
             'data/host-settings.json':65536,'data/v2-location.json':65536}

def digest(raw):return hashlib.sha256(raw).hexdigest()

def state_file(root,relative):
    """Reject links, aliases and nonregular files within an owned install."""
    root=Path(root).resolve(strict=True);path=root/relative
    for part in (path,*path.parents):
        if part==root:break
        if part.exists() or part.is_symlink():
            info=part.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
                raise RuntimeError('Linked state is not migrated / 不迁移链接状态文件：'+relative)
    if not path.resolve().is_relative_to(root):raise RuntimeError('State path escapes install root')
    if path.exists() and not path.is_file():raise RuntimeError('State path is not a file: '+relative)
    return path

def private_directory(root):
    directory=Path(root)/'private';directory.mkdir(exist_ok=True)
    state_file(root,'private/control.key')
    row=subprocess.check_output(['whoami','/user','/fo','csv','/nh'],creationflags=NO_WINDOW)
    sid=list(csv.reader(row.decode(errors='replace').splitlines()))[-1][-1]
    if not sid.startswith('S-1-5-'):raise RuntimeError('Cannot identify current Windows user')
    subprocess.run(['icacls',str(directory),'/inheritance:r','/grant:r',f'*{sid}:(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],
        check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10,creationflags=NO_WINDOW)

def runtime_check(root):
    result=subprocess.run([str(Path(root)/'runtime/python.exe'),'-I','-c',
        'import ctypes,sqlite3,ssl;print("V2Route runtime ready")'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,
        timeout=15,creationflags=NO_WINDOW)
    if result.returncode or b'V2Route runtime ready' not in result.stdout:
        raise RuntimeError('New runtime check failed / 新版本运行环境检查失败，旧版本未停止。')
    core=Path(root)/'cores/xray/xray.exe'
    result=subprocess.run([str(core),'version'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,creationflags=NO_WINDOW)
    if result.returncode:raise RuntimeError('New proxy core check failed / 新版本代理核心检查失败，旧版本未停止。')

def stop_companion(root):
    # A separate, bounded helper protects setup from a stalled pipe/auth handshake.
    result=subprocess.run([sys.executable,'-I',str(ROOT/'upgrade_install.py'),'--stop-old',str(root)],
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=22,creationflags=NO_WINDOW)
    if result.returncode:raise RuntimeError('Previous V2Route companion could not stop safely / 旧版 V2Route 未能安全停止，未切换安装；请重试。')
    return json.loads(result.stdout.decode('utf-8'))

def probe_companion(root):
    result=subprocess.run([sys.executable,'-I',str(ROOT/'upgrade_install.py'),'--probe-old',str(root)],
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,creationflags=NO_WINDOW)
    if result.returncode:raise RuntimeError('Cannot inspect existing companion safely / 无法安全核实旧版线路状态，未开始升级。')
    return json.loads(result.stdout.decode('utf-8'))

def start_companion(root,baseline=None):
    result=subprocess.run([str(Path(root)/'runtime/python.exe'),'-I',str(ROOT/'upgrade_install.py'),'--start-new',str(root)],
        input=json.dumps(baseline or {}).encode('utf-8'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=55,creationflags=NO_WINDOW)
    if result.returncode:raise RuntimeError('V2Route could not restore its routes / V2Route 未能恢复原有线路，将撤回升级。')
    return json.loads(result.stdout.decode('utf-8'))

def verify_readiness(status,saved,baseline=None):
    expected=saved.get('ports',{});ports=status.get('ports',{})
    if any(ports.get(slot)!=port for slot,port in expected.items()):raise RuntimeError('Existing route ports changed')
    if set(ports)!=set(saved.get('buttons',{})):raise RuntimeError('Some existing bindings were not restored')
    if status.get('error') or not (status.get('running') if ports else status.get('idle')):
        raise RuntimeError('New companion core did not become ready')
    slots=status.get('slots',{})
    if set(slots)!=set(ports):raise RuntimeError('Companion readiness details are incomplete')
    invalid={slot for slot in ports if not slots[slot].get('ok')}
    allowed=set((baseline or {}).get('invalid_slots',[]))
    if invalid-allowed:raise RuntimeError('A previously usable route regressed')
    return {'ok':True,'healthy':not invalid,'baselinePreserved':True,'bindings':len(ports),
            'preexisting_invalid_slots':sorted(invalid)}

def _start_new(root,baseline=None):
    from multiprocessing.connection import Client
    root=Path(root).resolve(strict=True)
    pipe=r'\\.\pipe\V2Route-'+hashlib.sha256(str(root).encode()).hexdigest()[:16]
    saved=json.loads(state_file(root,'settings.json').read_text(encoding='utf-8-sig')) if (root/'settings.json').exists() else {}
    expected=saved.get('ports',{})
    pythonw=root/'runtime/pythonw.exe';backend=root/'backend.py'
    if not pythonw.is_file() or not backend.is_file():raise RuntimeError('Companion runtime incomplete')
    # This command is called only after explicit upgrade authorization. The new
    # backend owns its own job object and reconstructs the preserved bindings.
    subprocess.Popen([str(pythonw),'-I',str(backend),'--headless'],cwd=root,stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=NO_WINDOW|0x200|0x01000000,close_fds=True)
    deadline=time.monotonic()+40
    while time.monotonic()<deadline:
        try:
            key=state_file(root,'private/control.key').read_bytes()
            if len(key)!=32:raise RuntimeError('Invalid new companion key')
            with Client(pipe,family='AF_PIPE',authkey=key) as connection:
                connection.send_bytes(b'{"command":"ensure","settings":null}')
                if not connection.poll(25):raise RuntimeError('New companion readiness timed out')
                response=json.loads(connection.recv_bytes(2*1024*1024));status=response.get('status',{})
            if not response.get('ok'):raise RuntimeError('New companion request failed')
            return verify_readiness(status,saved,baseline)
        except (FileNotFoundError,ConnectionRefusedError):pass
        except OSError as exc:
            if getattr(exc,'winerror',None) not in (2,3,53,231,232,233):raise
        time.sleep(.15)
    raise RuntimeError('New companion startup timed out')

def _stop_old(root,probe=False):
    from multiprocessing.connection import Client
    import ctypes
    from ctypes import wintypes as W
    root=Path(root).resolve(strict=True)
    pipe=r'\\.\pipe\V2Route-'+hashlib.sha256(str(root).encode()).hexdigest()[:16]
    keypath=state_file(root,'private/control.key')
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    if not keypath.exists():
        # A key could have been manually removed while a service still runs.
        # Never switch registrations when its identity can no longer be proven.
        kernel.WaitNamedPipeW.argtypes=[W.LPCWSTR,W.DWORD]
        if kernel.WaitNamedPipeW(pipe,1) or ctypes.get_last_error() not in (2,3):
            raise RuntimeError('Running companion has no authentication key')
        return {'ok':True,'running':False,'available':False}
    key=keypath.read_bytes()
    if len(key)!=32:raise RuntimeError('Invalid companion authentication key')
    kernel.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];kernel.OpenProcess.restype=W.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes=[W.HANDLE,W.DWORD,W.LPWSTR,ctypes.POINTER(W.DWORD)]
    kernel.WaitForSingleObject.argtypes=[W.HANDLE,W.DWORD];kernel.WaitForSingleObject.restype=W.DWORD
    kernel.CloseHandle.argtypes=[W.HANDLE]
    stopped=False;deadline=time.monotonic()+12;handles=[]
    try:
        while time.monotonic()<deadline:
            try:
                with Client(pipe,family='AF_PIPE',authkey=key) as connection:
                    connection.send_bytes(b'{"command":"status","settings":null}')
                    if not connection.poll(8):raise RuntimeError('Status request timed out')
                    response=json.loads(connection.recv_bytes(2*1024*1024))
                    pid=response.get('status',{}).get('helper_pid')
                    if type(pid) is not int or pid<=0:raise RuntimeError('Old companion identity unavailable')
                    handle=kernel.OpenProcess(0x101000,False,pid)
                    if not handle:raise RuntimeError('Cannot verify old companion process')
                    handles.append(handle)
                    size=W.DWORD(32768);buffer=ctypes.create_unicode_buffer(size.value)
                    if not kernel.QueryFullProcessImageNameW(handle,0,buffer,ctypes.byref(size)):raise RuntimeError('Cannot verify old companion path')
                    executable=Path(buffer.value).resolve(strict=True)
                    if executable.parent!=(root/'runtime').resolve() or executable.name.casefold() not in ('python.exe','pythonw.exe'):
                        raise RuntimeError('Old companion process is outside its owned runtime')
                    if probe:
                        status=response['status']
                        return {'ok':True,'available':True,'running':bool(status.get('running')),
                                'error':bool(status.get('error')),'ports':status.get('ports',{}),
                                'slots':{slot:bool(value.get('ok')) for slot,value in status.get('slots',{}).items()}}
                with Client(pipe,family='AF_PIPE',authkey=key) as connection:
                    connection.send_bytes(b'{"command":"stop","settings":null}')
                    if not connection.poll(8):raise RuntimeError('Stop request timed out')
                    response=json.loads(connection.recv_bytes(1024))
                    if response!={'ok':True,'stopped':True}:raise RuntimeError('Stop request refused')
                    stopped=True
                # Pipe closure can precede the core's shutdown. Wait for this exact
                # verified process handle, never a name-based kill or PID reuse.
                if kernel.WaitForSingleObject(handle,6500)!=0:raise RuntimeError('Old companion did not exit')
            except (FileNotFoundError,ConnectionRefusedError):
                return {'ok':True,'running':False,'available':False,'stopped':stopped}
            except OSError as exc:
                if getattr(exc,'winerror',None) in (2,3,53):return {'ok':True,'running':False,'available':False,'stopped':stopped}
                if getattr(exc,'winerror',None) not in (231,232,233):raise
            time.sleep(.15)
        raise RuntimeError('Companion is still running')
    finally:
        for handle in handles:kernel.CloseHandle(handle)

class Upgrade:
    def __init__(self,installer,stop=stop_companion,check=runtime_check,secure=private_directory,start=start_companion,probe=probe_companion):
        self.installer=installer;self.root=installer.root
        self.stop=stop;self.check=check;self.secure=secure;self.start=start;self.probe=probe

    def capture_baseline(self,source):
        import discovery
        import routes
        import sqlite3
        from contextlib import closing
        path=state_file(source,'settings.json')
        raw=path.read_bytes() if path.exists() else None
        saved=routes.normalize_settings(json.loads(raw.decode('utf-8-sig'))) if raw else routes.default_settings()
        live=self.probe(source)
        if live.get('available') and live.get('running') and not live.get('error'):
            if live.get('ports')!=saved['ports'] or set(live.get('slots',{}))!=set(saved['buttons']):
                raise RuntimeError('Existing route state is changing; retry / 原有线路正在变化，请稍后重试升级。')
            invalid=[slot for slot,ok in live['slots'].items() if not ok]
            kind='running-companion'
        else:
            # Offline preflight never launches the old backend or rewrites its
            # cache. Candidate paths and node records are read only.
            gui={'CoreBasicItem':{},'Inbound':[]};nodes={};groups={};selected=None
            cache=state_file(source,'data/v2-location.json')
            cached=json.loads(cache.read_text(encoding='utf-8-sig')) if cache.exists() else {}
            if cached.get('path') and discovery.validate_root(cached['path'])['valid']:selected=cached['path']
            elif not cached.get('manual'):
                engine=discovery.Discovery(cache_path=source/'data/v2-location.json')
                engine._remember=lambda *args:None
                selected=engine.inspect().get('selected')
            if selected:
                folder=Path(selected)
                gui=json.loads((folder/'guiConfigs/guiNConfig.json').read_text(encoding='utf-8-sig'))
                with closing(sqlite3.connect((folder/'guiConfigs/guiNDB.db').as_uri()+'?mode=ro',uri=True)) as db:
                    db.row_factory=sqlite3.Row
                    nodes={str(row['IndexId']):dict(row) for row in db.execute('SELECT * FROM ProfileItem')}
                    groups={str(row['Id']):dict(row) for row in db.execute('SELECT * FROM SubItem')}
            store=state_file(source,'private/imported-nodes.json')
            local=json.loads(store.read_text(encoding='utf-8-sig'))['nodes'] if store.exists() else {}
            if set(local)&set(nodes):raise RuntimeError('Node identifier collision during preflight')
            nodes.update(local)
            if local:groups['local-imports']={'Remarks':'Imported nodes','PrevProfile':'','NextProfile':''}
            invalid=[]
            for slot,value in saved['buttons'].items():
                try:routes.build_choice(value['route'],(gui,nodes,groups),value.get('predecessor','inherit'))
                except (ValueError,KeyError,TypeError):invalid.append(slot)
            kind='offline-graph'
        return {'kind':kind,'invalid_slots':sorted(invalid),'ports':saved['ports'],
                'settings_sha256':digest(raw) if raw is not None else None}

    def _source(self,plan):
        roots=set()
        for views in plan['before'].values():
            for value in views.values():
                if value.get('exists'):roots.add(Path(value['value']).resolve(strict=True).parent.parent)
        if len(roots)>1:raise RuntimeError('Multiple registered V2Route installations / 检测到多个已注册版本，未合并用户数据。')
        return next(iter(roots),None)

    def _validated_data(self,source):
        import discovery
        import routes
        data={};warnings=[];original={}
        for relative,limit in STATE_FILES.items():
            path=state_file(source,relative)
            if not path.exists():continue
            if path.stat().st_size>limit:raise RuntimeError('State exceeds migration limit: '+relative)
            raw=path.read_bytes();original[relative]=digest(raw)
            try:value=json.loads(raw.decode('utf-8-sig'))
            except (ValueError,UnicodeError):raise RuntimeError('Invalid state JSON / 状态文件无效：'+relative) from None
            if relative=='settings.json':
                routes.normalize_settings(value)
            elif relative=='private/imported-nodes.json':
                if not isinstance(value,dict) or value.get('version')!=1 or not isinstance(value.get('nodes'),dict) or len(value['nodes'])>2000:
                    raise RuntimeError('Invalid imported node database / 导入节点库无效')
                for ident,node in value['nodes'].items():
                    if not isinstance(node,dict) or node.get('IndexId')!=ident or node.get('_source')!='local':
                        raise RuntimeError('Invalid imported node record / 导入节点记录无效')
                    try:routes.translate(node,'migration',{'CoreBasicItem':{},'Inbound':[]})
                    except Exception:raise RuntimeError('Imported node is incompatible / 导入节点与新版本不兼容，旧版本未改动。') from None
            elif relative=='data/v2-location.json':
                if not isinstance(value,dict) or not isinstance(value.get('path'),str):raise RuntimeError('Invalid discovery cache')
                if value['path'] and not discovery.validate_root(value['path'])['valid']:
                    warnings.append('Previous v2rayN path is invalid; automatic discovery will run / 旧 v2rayN 路径失效，将重新识别。')
                    continue
            elif relative=='data/host-settings.json':
                if not isinstance(value,dict) or set(value)-{'corePath'}:raise RuntimeError('Invalid companion settings')
                custom=value.get('corePath')
                if custom:
                    if not isinstance(custom,str):raise RuntimeError('Invalid core path')
                    path=Path(custom).resolve()
                    if path.is_relative_to(source):
                        value.pop('corePath');raw=json.dumps(value).encode()
                    elif not path.is_file() or path.name.casefold()!='xray.exe':
                        raise RuntimeError('Custom core is unavailable / 自定义核心失效，请先修正旧版本设置。')
            data[relative]=raw
        return data,original,warnings

    def _plan(self):
        registration=self.installer.plan();source=self._source(registration)
        same=source==self.root
        data,original,warnings=self._validated_data(source) if source and not same else ({},{},[])
        if source and not same:
            for relative in (*STATE_FILES,'private/control.key'):
                if state_file(self.root,relative).exists():raise RuntimeError('Destination already contains state / 新目录已有用户状态，未覆盖：'+relative)
        baseline=self.capture_baseline(source) if source else None
        invalid_count=len((baseline or {}).get('invalid_slots',[]))
        if invalid_count:warnings.append(f'{invalid_count} existing invalid binding(s) will be preserved; reselect those routes in the extension / 原有 {invalid_count} 个失效绑定将保留，请在扩展中重新选择线路。')
        public={'required':source is not None,'source':str(source) if source else None,'target':str(self.root),
                'same_root':same,'restartCompanion':source is not None,'warnings':warnings,
                'preexistingInvalidBindings':invalid_count,
                'files':[{'path':name,'bytes':len(raw),'sha256':digest(raw)} for name,raw in data.items()]}
        return public,source,data,original,registration,baseline

    def plan(self):return self._plan()[0]

    def install(self,explicit=False):
        public,source,data,original,registration,baseline=self._plan()
        if not source:return self.installer.install()
        if not explicit:raise RuntimeError('Existing V2Route detected; use --install --upgrade after reviewing --upgrade-plan / 检测到旧版，请确认升级后重试。')
        self.check(self.root)
        transaction=time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]
        self.secure(self.root)
        stage=self.root/'private/upgrade-staging'/transaction;stage.mkdir(parents=True)
        journal={'product_id':'v2route','transaction':transaction,**public,'state':'staged','original_sha256':original,'baseline':baseline}
        journal_path=self.root/'data/upgrades'/(transaction+'.json')
        from portable_install import atomic_json
        atomic_json(journal_path,journal)
        for relative,raw in data.items():
            staged=stage/relative;staged.parent.mkdir(parents=True,exist_ok=True)
            with staged.open('xb') as output:output.write(raw)
        created=[];registered=False;registration_started=False;old_stopped=False;new_started=False
        try:
            # Registration or source state may have changed while preflight ran.
            if self.installer.snapshot()!=registration['before']:raise RuntimeError('Host registration changed during upgrade')
            self.stop(source);old_stopped=True
            baseline_path=state_file(source,'settings.json')
            stopped_hash=digest(baseline_path.read_bytes()) if baseline_path.exists() else None
            if stopped_hash!=baseline['settings_sha256']:raise RuntimeError('State changed during upgrade; retry / 升级期间状态变化，请重试。')
            if not public['same_root'] and self._validated_data(source)[1]!=original:
                raise RuntimeError('State changed during upgrade; retry / 升级期间状态变化，未切换，请重试。')
            if not public['same_root']:
                # Fresh key is deliberately not inherited from the old service.
                data={**data,'private/control.key':os.urandom(32)}
                for relative,raw in data.items():
                    target=state_file(self.root,relative);target.parent.mkdir(parents=True,exist_ok=True)
                    with target.open('xb') as output:output.write(raw)
                    created.append(target)
                # Do not repoint any browser registration until every copy verifies.
                if any(digest(path.read_bytes())!=digest(data[path.relative_to(self.root).as_posix()]) for path in created):raise RuntimeError('Migration verification failed')
            if self.installer.snapshot()!=registration['before']:raise RuntimeError('Host registration changed before commit')
            registration_started=True
            result=self.installer.install();registered=True
            # An old in-flight native request may have relaunched its companion.
            if not public['same_root']:
                self.stop(source)
                if self._validated_data(source)[1]!=original:
                    raise RuntimeError('Old state changed before registration settled / 旧版请求仍在保存，已撤回升级，请重试。')
            new_started=True
            journal['health']=self.start(self.root,baseline)
            journal['state']='installed';atomic_json(journal_path,journal)
            return {**result,'upgrade':public,'upgrade_receipt':str(journal_path)}
        except Exception:
            rollback_errors=[];may_archive=True
            if registered:
                try:self.installer.restore(rollback=True)
                except Exception:rollback_errors.append('Registration rollback failed; inspect install receipt')
            if self.installer.snapshot()!=registration['before']:
                may_archive=False;rollback_errors.append('Registration is not restored; new state files were preserved')
            # A browser RPC can launch the newly registered host before our own
            # readiness step, including during a partial registration attempt.
            # Repoint registration first so no newly arriving call starts it.
            if new_started or registration_started:
                try:self.stop(self.root)
                except Exception:
                    may_archive=False;rollback_errors.append('New companion could not stop; its state files were preserved')
            if any(not path.exists() or digest(path.read_bytes())!=digest(data[path.relative_to(self.root).as_posix()]) for path in created):
                may_archive=False;rollback_errors.append('New state changed during upgrade; all new state files were preserved')
            # Preserve failed destination copies under the private staging folder.
            # Only exact files created by this transaction can be moved back.
            for path in reversed(created) if may_archive else []:
                relative=path.relative_to(self.root)
                if path.exists() and digest(path.read_bytes())==digest(data[relative.as_posix()]):
                    archived=stage/'rollback'/relative;archived.parent.mkdir(parents=True,exist_ok=True);os.replace(path,archived)
            if old_stopped:
                try:self.start(source,baseline)
                except Exception:rollback_errors.append('Old companion did not become healthy; its source files are preserved')
            journal['state']='failed';journal['rollback_errors']=rollback_errors;atomic_json(journal_path,journal)
            if rollback_errors:raise RuntimeError('Upgrade rollback needs attention / 升级恢复未完成，请保留回执：'+str(journal_path)) from None
            raise

if __name__=='__main__':
    parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--stop-old',type=Path);group.add_argument('--start-new',type=Path);group.add_argument('--probe-old',type=Path);args=parser.parse_args()
    try:
        if args.start_new:
            raw=sys.stdin.buffer.read(1024*1024+1)
            if len(raw)>1024*1024:raise ValueError('Baseline is too large')
            baseline=json.loads(raw.decode('utf-8')) if raw else None
            result=_start_new(args.start_new,baseline)
        else:result=_stop_old(args.stop_old or args.probe_old,probe=bool(args.probe_old))
        print(json.dumps(result))
    except Exception:
        print('Companion stop failed',file=sys.stderr);raise SystemExit(1)

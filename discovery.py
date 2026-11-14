"""Bounded, offline v2rayN discovery. Never reads node rows or updates V2."""
import argparse
from collections import deque
from contextlib import closing
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import sqlite3
import subprocess
import threading
import time
import uuid

ROOT=Path(__file__).resolve().parent
CACHE=ROOT/'data/v2-location.json'
CORE_RELATIVE=('bin/xray/xray.exe','xray.exe','bin/xray.exe')
SKIP={'windows','$recycle.bin','system volume information','node_modules','.git',
      'winsxs','windowsapps','programdata','appdata','.venv','venv','__pycache__'}
CONTAINERS={'tools','apps','programs','program files','program files (x86)',
            'downloads','desktop','portable','software','软件','工具'}

class DiscoveryError(ValueError):
    def __init__(self,report):
        self.report=report
        super().__init__(report.get('error') or '未找到有效的 v2rayN 目录')

def limited_process_paths():
    """Query only image paths, including elevated V2 processes when permitted."""
    if os.name!='nt':return []
    from ctypes import wintypes as W
    class Entry(ctypes.Structure):
        _fields_=[('size',W.DWORD),('usage',W.DWORD),('pid',W.DWORD),
                  ('heap',ctypes.c_size_t),('module',W.DWORD),('threads',W.DWORD),
                  ('parent',W.DWORD),('priority',W.LONG),('flags',W.DWORD),('exe',W.WCHAR*260)]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes=[W.DWORD,W.DWORD];kernel.CreateToolhelp32Snapshot.restype=W.HANDLE
    kernel.Process32FirstW.argtypes=[W.HANDLE,ctypes.POINTER(Entry)]
    kernel.Process32NextW.argtypes=[W.HANDLE,ctypes.POINTER(Entry)]
    kernel.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];kernel.OpenProcess.restype=W.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes=[W.HANDLE,W.DWORD,W.LPWSTR,ctypes.POINTER(W.DWORD)]
    kernel.CloseHandle.argtypes=[W.HANDLE]
    snapshot=kernel.CreateToolhelp32Snapshot(2,0);paths=[]
    if snapshot in (None,ctypes.c_void_p(-1).value):raise OSError('Cannot enumerate executable paths')
    try:
        entry=Entry();entry.size=ctypes.sizeof(entry);ok=kernel.Process32FirstW(snapshot,ctypes.byref(entry));count=0
        while ok and count<16384:
            count+=1
            if entry.exe.casefold()=='v2rayn.exe':
                process=kernel.OpenProcess(0x1000,False,entry.pid)
                if process:
                    try:
                        buffer=ctypes.create_unicode_buffer(32768);size=W.DWORD(len(buffer))
                        if kernel.QueryFullProcessImageNameW(process,0,buffer,ctypes.byref(size)):paths.append(buffer.value)
                    finally:kernel.CloseHandle(process)
            ok=kernel.Process32NextW(snapshot,ctypes.byref(entry))
    finally:kernel.CloseHandle(snapshot)
    return paths


def running_process_paths():
    """Read executable paths only; never inspect process command lines."""
    if os.name!='nt':return []
    # An empty successful inventory means V2 is stopped; do not launch CIM then.
    try:return limited_process_paths()
    except OSError:pass
    command="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process -Filter \"Name = 'v2rayN.exe'\" | ForEach-Object { $_.ExecutablePath } | Where-Object { $_ }) | ConvertTo-Json -Compress"
    try:
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5,creationflags=0x08000000)
        value=json.loads(result.stdout.decode('utf-8-sig') or '[]') if result.returncode==0 else []
        return [value] if isinstance(value,str) else [p for p in value or [] if isinstance(p,str)]
    except (OSError,ValueError,subprocess.TimeoutExpired):return []


def historical_path_hints(registry=None):
    """Read only executable names from two bounded per-user application caches.

    No timestamps, command lines, document history or other values are returned.
    These are hints, never evidence that an installation remains valid.
    """
    if registry is None:
        if os.name!='nt':return []
        import winreg as registry
    paths=[]
    keys=(r'Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache',
          r'Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store')
    for name in keys:
        try:
            with registry.OpenKey(registry.HKEY_CURRENT_USER,name,0,registry.KEY_READ) as key:
                for index in range(min(registry.QueryInfoKey(key)[1],2048)):
                    try:value=registry.EnumValue(key,index)[0]
                    except OSError:continue
                    if not isinstance(value,str):continue
                    value=re.sub(r'\.(?:FriendlyAppName|ApplicationCompany)$','',value,flags=re.I)
                    if not re.search(r'(?:^|[\\/])v2rayn\.exe$',value,re.I):continue
                    if value not in paths:paths.append(value)
        except OSError:pass
    return paths


def installed_path_hints():
    """Read bounded v2rayN-specific registry and shortcut metadata only."""
    if os.name!='nt':return []
    import winreg
    paths=[]
    def add(value):
        if not isinstance(value,str) or not value.strip():return
        value=os.path.expandvars(value.strip()).strip('"')
        # DisplayIcon is an executable path with an optional icon index.
        value=re.sub(r',\s*-?\d+$','',value).strip('"')
        if value not in paths:paths.append(value)
    for hive in (winreg.HKEY_CURRENT_USER,winreg.HKEY_LOCAL_MACHINE):
        for view in (winreg.KEY_WOW64_64KEY,winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive,r'Software\Microsoft\Windows\CurrentVersion\App Paths\v2rayN.exe',0,winreg.KEY_READ|view) as key:add(winreg.QueryValueEx(key,None)[0])
            except OSError:pass
            try:
                with winreg.OpenKey(hive,r'Software\Microsoft\Windows\CurrentVersion\Uninstall',0,winreg.KEY_READ|view) as parent:
                    for index in range(min(winreg.QueryInfoKey(parent)[0],512)):
                        try:
                            with winreg.OpenKey(parent,winreg.EnumKey(parent,index)) as key:
                                if 'v2rayn' not in str(winreg.QueryValueEx(key,'DisplayName')[0]).casefold():continue
                                for name in ('InstallLocation','DisplayIcon'):
                                    try:add(winreg.QueryValueEx(key,name)[0])
                                    except OSError:pass
                        except OSError:continue
            except OSError:pass
    for path in historical_path_hints(winreg):add(path)
    # Valid application metadata avoids spawning PowerShell for shortcut lookup.
    if any(validate_root(path,'installed')['valid'] for path in paths):return paths
    # Link targets are read through Shell COM; no shortcuts are launched.
    command=r"""[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();
$roots=@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'),[Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'));
$shell=New-Object -ComObject WScript.Shell;
@($roots | Where-Object {$_} | ForEach-Object {Get-ChildItem -LiteralPath $_ -Filter '*v2ray*.lnk' -File -Depth 2 -ErrorAction SilentlyContinue} | Select-Object -First 128 | ForEach-Object {$shell.CreateShortcut($_.FullName).TargetPath} | Where-Object {$_ -and [IO.Path]::GetFileName($_) -ieq 'v2rayN.exe'}) | ConvertTo-Json -Compress"""
    try:
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=4,creationflags=0x08000000)
        value=json.loads(result.stdout.decode('utf-8-sig') or '[]') if result.returncode==0 else []
        for path in ([value] if isinstance(value,str) else value or []):add(path)
    except (OSError,ValueError,subprocess.TimeoutExpired):pass
    return paths

def local_roots():
    """Enumerate local fixed/removable drives; no assumed C/D/E drive letters."""
    result=[]
    if os.name=='nt':
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.GetDriveTypeW.argtypes=[ctypes.c_wchar_p]
        mask=kernel.GetLogicalDrives()
        for index in range(26):
            path=chr(ord('A')+index)+':/'
            if mask&(1<<index) and kernel.GetDriveTypeW(path) in (2,3):result.append(Path(path))
    for name in ('USERPROFILE','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)'):
        value=os.environ.get(name)
        if value:result.append(Path(value))
    return result

def machine_id():
    return hashlib.sha256((platform.node()+'|'+os.environ.get('USERPROFILE','')).encode()).hexdigest()[:24]

def validate_root(value,source='selected'):
    """Check layout, JSON structure and SQLite schema, never SELECT node data."""
    try:
        root=Path(value).expanduser()
        if root.name.casefold()=='v2rayn.exe':root=root.parent
        if root.name.casefold()=='guiconfigs':root=root.parent
        root=root.resolve(strict=True)
    except (OSError,ValueError,TypeError):return {'valid':False,'path':str(value),'source':source,'error_code':'missing_path','error':'目录不存在或不可访问'}
    item={'path':str(root),'source':source,'valid':False}
    config=root/'guiConfigs/guiNConfig.json';database=root/'guiConfigs/guiNDB.db'
    if not config.is_file() or not database.is_file():return {**item,'error_code':'missing_layout','error':'需要 guiConfigs/guiNConfig.json 和 guiNDB.db'}
    core=next((root/relative for relative in CORE_RELATIVE if (root/relative).is_file()),None)
    try:
        with config.open('r',encoding='utf-8-sig') as handle:gui=json.load(handle)
        if not isinstance(gui,dict):raise ValueError()
        inbound=gui.get('Inbound')
        if not isinstance(inbound,list) or not inbound or not isinstance(inbound[0],dict):raise ValueError()
        port=inbound[0].get('LocalPort')
        if type(port) is not int or not 1<=port<=65535:raise ValueError()
    except (OSError,ValueError,UnicodeError):return {**item,'error_code':'invalid_config','error':'v2rayN 配置无法读取或本地入口无效'}
    try:
        with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True,timeout=.3)) as db:
            db.execute('PRAGMA query_only=ON')
            names={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ProfileItem','SubItem')")}
            if names!={'ProfileItem','SubItem'}:raise sqlite3.DatabaseError()
    except (sqlite3.Error,OSError):return {**item,'error_code':'invalid_database','error':'v2rayN 节点库无法读取或表结构不完整'}
    # The complete companion includes its own core. v2rayN may use another core.
    return {**item,'valid':True,'core_path':str(core.resolve()) if core else None}

class Discovery:
    def __init__(self,process_paths=None,roots=None,cache_path=None,machine=None,
                 max_depth=3,max_dirs=600,max_seconds=2.5,clock=None,path_hints=None):
        self.process_paths=process_paths if process_paths is not None else running_process_paths
        self.roots=roots if roots is not None else local_roots
        self.cache_path=Path(cache_path) if cache_path is not None else CACHE
        self.machine=machine if machine is not None else machine_id()
        self.max_depth=max_depth;self.max_dirs=max_dirs;self.max_seconds=max_seconds
        self.clock=clock or time.monotonic;self.lock=threading.RLock()
        self.path_hints=path_hints if path_hints is not None else installed_path_hints
        self._process_at=-float('inf');self._process=[];self._scan_at=-float('inf');self._scan=[]
        self._hints_at=-float('inf');self._hints=[]

    def _cache(self):
        try:
            value=json.loads(self.cache_path.read_text(encoding='utf-8'))
            if value.get('version')==1 and value.get('machine')==self.machine and isinstance(value.get('path'),str) and value['path']:return value
        except (OSError,ValueError,TypeError,AttributeError):pass
        return {}

    def _remember(self,path,manual):
        value={'version':1,'machine':self.machine,'path':str(path),'manual':manual}
        self.cache_path.parent.mkdir(parents=True,exist_ok=True)
        temp=self.cache_path.with_name(self.cache_path.name+'.'+uuid.uuid4().hex+'.tmp')
        temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
        os.replace(temp,self.cache_path)

    def select(self,path):
        with self.lock:
            candidate=validate_root(path,'selected')
            if not candidate['valid']:return self._report([], [candidate], 'invalid_selection',candidate['error'],False)
            try:self._remember(candidate['path'],True)
            except OSError:return self._report([candidate],[], 'cache_unwritable','无法保存已选目录，请检查套件目录的写入权限',False)
            return self._report([candidate],[],None,'',False,selected=candidate)

    def clear_selection(self):
        with self.lock:
            self._remember('',False)
            self._process_at=self._hints_at=self._scan_at=-float('inf')

    def _report(self,candidates,rejected,code,error,scanned,selected=None):
        return {'ok':selected is not None,'selected':selected['path'] if selected else None,
                'core_path':selected.get('core_path') if selected else None,
                'candidates':candidates,'rejected':rejected[:20],'error_code':code,'error':error,
                'requires_selection':code in ('ambiguous','not_found','invalid_selection','invalid_manual_selection'),
                'scanned':scanned,'scan_limits':{'depth':self.max_depth,'directories':self.max_dirs,'entries_per_directory':256,'seconds':self.max_seconds}}

    def _scan_roots(self):
        roots=self.roots() if callable(self.roots) else self.roots
        queue=deque((Path(p),0) for p in roots);seen=set();found=[];visited=0;start=self.clock()
        while queue and visited<self.max_dirs and self.clock()-start<self.max_seconds:
            root,depth=queue.popleft()
            try:
                key=os.path.normcase(str(root.resolve()))
                if key in seen or not root.is_dir():continue
                seen.add(key);visited+=1
                if (root/'guiConfigs/guiNConfig.json').is_file() and (root/'guiConfigs/guiNDB.db').is_file():
                    found.append(root);continue
                if depth>=self.max_depth:continue
                with os.scandir(root) as entries:
                    children=0
                    for entry in entries:
                        if self.clock()-start>=self.max_seconds or children>=256 or len(queue)>=self.max_dirs*4:break
                        if entry.name.casefold() in SKIP:continue
                        # Enter only known software containers or v2rayN-named
                        # folders from each root; never recursively sweep drives.
                        if depth==0 and 'v2rayn' not in entry.name.casefold() and entry.name.casefold() not in CONTAINERS:continue
                        if not entry.is_dir(follow_symlinks=False):continue
                        # Do not follow junctions/reparse points into another tree.
                        if getattr(entry.stat(follow_symlinks=False),'st_file_attributes',0)&0x400:continue
                        queue.append((Path(entry.path),depth+1));children+=1
            except (OSError,ValueError):continue
        return found

    def inspect(self,force_scan=False,selected=None):
        with self.lock:
            if selected is not None:return self.select(selected)
            candidates=[];rejected=[];seen={};cache=self._cache()
            def add(path,source):
                candidate=validate_root(path,source)
                key=os.path.normcase(candidate['path'])
                if key in seen:return seen[key] if seen[key]['valid'] else None
                seen[key]=candidate
                (candidates if candidate['valid'] else rejected).append(candidate)
                return candidate if candidate['valid'] else None
            # Explicit user selection is authoritative, unlike an automatic cache.
            manual=None
            if cache.get('manual'):
                manual=add(cache['path'],'selected')
                if manual and not force_scan:return self._report(candidates,rejected,None,'',False,manual)
                if not manual and not force_scan:
                    return self._report(candidates,rejected,'invalid_manual_selection','已选 v2rayN 目录失效，请重新检测或选择目录',False)
            now=self.clock()
            if force_scan or now-self._process_at>=2:
                supplied=self.process_paths() if callable(self.process_paths) else self.process_paths
                self._process=list(supplied or []);self._process_at=now
            running=[]
            for value in self._process:
                candidate=add(value,'running')
                if candidate and not any(os.path.normcase(c['path'])==os.path.normcase(candidate['path']) for c in running):running.append(candidate)
            if len(running)>1 and not cache.get('manual'):
                return self._report(candidates,rejected,'ambiguous','检测到多个有效的 v2rayN 运行目录，请明确选择一个',False)
            if len(running)==1 and not cache.get('manual'):
                chosen=running[0]
                try:self._remember(chosen['path'],False)
                except OSError:pass
                return self._report(candidates,rejected,None,'',False,chosen)
            if cache and not cache.get('manual'):
                chosen=add(cache['path'],'cache')
                if chosen and not force_scan:return self._report(candidates,rejected,None,'',False,chosen)
            if force_scan or now-self._hints_at>=30:
                supplied=self.path_hints() if callable(self.path_hints) else self.path_hints
                self._hints=list(supplied or []);self._hints_at=now
            for path in self._hints:add(path,'installed')
            roots=list(self.roots() if callable(self.roots) else self.roots)
            common=[]
            for root in roots:
                base=Path(root)
                common.extend(base/p for p in ('v2rayN','v2rayN/v2rayN-windows-64','v2rayN-windows-64','Tools/v2rayN','Apps/v2rayN','Downloads/v2rayN','Desktop/v2rayN','Programs/v2rayN'))
            for path in common:
                if path.is_dir():add(path,'common')
            scanned=False
            if not candidates and (force_scan or now-self._scan_at>=30):
                self._scan=self._scan_roots();self._scan_at=now;scanned=True
            for path in self._scan:add(path,'scan')
            if cache.get('manual'):
                if manual:return self._report(candidates,rejected,None,'',scanned,manual)
                return self._report(candidates,rejected,'invalid_manual_selection','已选 v2rayN 目录失效；已列出重新扫描结果，请选择目录或清空原设置以恢复自动识别',scanned)
            if len(candidates)==1:
                chosen=candidates[0]
                try:self._remember(chosen['path'],False)
                except OSError:pass
                return self._report(candidates,rejected,None,'',scanned,chosen)
            if len(candidates)>1:return self._report(candidates,rejected,'ambiguous','检测到多个有效的 v2rayN 目录，请明确选择一个',scanned)
            return self._report(candidates,rejected,'not_found','未找到有效的 v2rayN。请先运行 v2rayN，再重新检测，或选择其文件夹。',scanned)

    def resolve(self,force_scan=False,selected=None):
        report=self.inspect(force_scan,selected)
        if not report['ok']:raise DiscoveryError(report)
        return report

_default=Discovery()
def inspect_candidates(force_scan=False,selected=None):return _default.inspect(force_scan,selected)
def select_root(path):return _default.select(path)
def clear_selection():return _default.clear_selection()
def resolve_location(force_scan=False,selected=None):return _default.resolve(force_scan,selected)
def resolve_v2_root(force_scan=False,selected=None):return Path(resolve_location(force_scan,selected)['selected'])

def choose_root():
    """User-invoked folder picker, supported by the Windows/.NET installation."""
    if os.name!='nt':return {'ok':False,'error':'文件夹选择仅支持 Windows','error_code':'unsupported_platform'}
    command="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $picker=New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description='选择包含 guiConfigs 的 v2rayN 文件夹'; $picker.ShowNewFolderButton=$false; if($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$picker.SelectedPath}; $picker.Dispose()"
    result=subprocess.run(['powershell.exe','-NoProfile','-STA','-Command',command],stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=0x08000000)
    selected=result.stdout.decode('utf-8-sig').strip()
    return select_root(selected) if result.returncode==0 and selected else {'ok':False,'error_code':'cancelled','error':'未选择目录'}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--detect',action='store_true');parser.add_argument('--rescan',action='store_true');parser.add_argument('--select');parser.add_argument('--choose',action='store_true')
    args=parser.parse_args()
    result=choose_root() if args.choose else select_root(args.select) if args.select else inspect_candidates(args.rescan)
    print(json.dumps(result,ensure_ascii=True))
    return 0 if result.get('ok') else 1
if __name__=='__main__':raise SystemExit(main())

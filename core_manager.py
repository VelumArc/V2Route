"""Explicit installation/repair of the pinned companion core only.

No browser extension can bootstrap a missing native host. Once installed, the
host can restore its own verified core without editing v2rayN or a running EXE.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import time
import urllib.request
import zipfile
from contextlib import contextmanager
import threading
import uuid

_SETTINGS_THREAD_LOCK=threading.RLock()

@contextmanager
def settings_lock(settings_path):
    """Serialize read/modify/write across native hosts and the route daemon."""
    import msvcrt
    with _SETTINGS_THREAD_LOCK:
        settings_path.parent.mkdir(parents=True,exist_ok=True)
        path=settings_path.with_name('.host-settings.lock')
        if path.is_symlink() or (path.exists() and getattr(path.lstat(),'st_file_attributes',0)&0x400):
            raise RuntimeError('Linked settings lock / 设置锁路径是链接')
        with path.open('a+b') as handle:
            handle.seek(0,2)
            if handle.tell()==0:handle.write(b'0');handle.flush()
            deadline=time.monotonic()+10
            while True:
                try:handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1);break
                except OSError:
                    if time.monotonic()>=deadline:raise RuntimeError('Settings are busy; retry / 设置正在保存，请重试')
                    time.sleep(.05)
            try:yield
            finally:handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)

ROOT=Path(__file__).resolve().parent
VERSION='v26.10.31'
URL='https://github.com/XTLS/Xray-core/releases/download/v26.10.31/Xray-windows-64.zip'
ARCHIVE_SHA='2e04a9995a6f2ad1b28c0bb25c708ecb2695e43a1c9c7889c4b6ac2b48cf7a6a'
EXE_SHA='d5b558191cccb1e92a5772b68b8cab67717b26f634b0f15153215f65ae982a7e'
MAX_DOWNLOAD=80*1024*1024


def resolved_path(path,strict=False):
    # Windows may add its extended namespace when an ancestor appears during
    # resolve(). Compare the same namespace after resolving the entire chain.
    value=str(path.resolve(strict=strict))
    if os.name=='nt':
        if value.startswith('\\\\?\\UNC\\'):value='\\\\'+value[8:]
        elif value.startswith('\\\\?\\'):value=value[4:]
    return Path(value)


def owned(relative):
    base=resolved_path(ROOT,strict=True);path=base/relative
    for item in (path,*path.parents):
        if item==base:break
        if item.exists() or item.is_symlink():
            info=item.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
                raise RuntimeError('Core path is linked; choose another installation / 核心路径是链接，请选择其他安装位置')
    if not resolved_path(path).is_relative_to(base):raise RuntimeError('Core path escapes installation / 核心路径超出安装目录')
    return path


def digest(path):
    if not path.is_file():return None
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def status():
    import routes
    selected=routes.location().get('core_path')
    bundled=owned('cores/xray/xray.exe')
    installed=bool(selected and Path(selected).is_file())
    return {'version':VERSION,'installed':installed,'path':selected or '',
        'verified':bool(installed and digest(Path(selected))==EXE_SHA),
        'bundled':digest(bundled)==EXE_SHA,'downloadUrl':URL,'repairSupported':True}


def download(opener=urllib.request.urlopen):
    request=urllib.request.Request(URL,headers={'User-Agent':'V2Route-Core-Installer/1'})
    chunks=[];total=0;deadline=time.monotonic()+90
    with opener(request,timeout=15) as response:
        # GitHub redirects its signed release assets. No arbitrary URL is read
        # from user state, and the pinned hash remains the trust boundary.
        while True:
            if time.monotonic()>deadline:raise TimeoutError('Core download timed out / 核心下载超时')
            chunk=response.read(256*1024)
            if not chunk:break
            total+=len(chunk)
            if total>MAX_DOWNLOAD:raise RuntimeError('Core download exceeds limit / 核心下载超出限制')
            chunks.append(chunk)
    return b''.join(chunks)


def install(fetch=download):
    current=status()
    if current['verified']:return {**current,'changed':False}
    bundled=owned('cores/xray/xray.exe')
    if digest(bundled)==EXE_SHA:
        selected=bundled
    else:
        cache=owned('build-cache/Xray-'+VERSION+'-windows-64.zip')
        data=cache.read_bytes() if digest(cache)==ARCHIVE_SHA else fetch()
        if hashlib.sha256(data).hexdigest()!=ARCHIVE_SHA:
            raise RuntimeError('Core archive checksum mismatch / 核心压缩包校验失败')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            info=archive.getinfo('xray.exe')
            if info.file_size>64*1024*1024:raise RuntimeError('Invalid core payload / 核心文件无效')
            executable=archive.read(info)
        if hashlib.sha256(executable).hexdigest()!=EXE_SHA:
            raise RuntimeError('Core executable checksum mismatch / 核心程序校验失败')
        # Use a fresh owned directory; never overwrite an executable in use.
        selected=owned('cores/xray/restored-'+uuid.uuid4().hex+'/xray.exe')
        selected.parent.mkdir(parents=True,exist_ok=False)
        with selected.open('xb') as f:f.write(executable)
    settings_path=owned('data/host-settings.json')
    with settings_lock(settings_path):
        previous=json.loads(settings_path.read_text(encoding='utf-8')) if settings_path.exists() else {}
        next_value={**previous,'corePath':str(selected)}
        temporary=settings_path.with_name('host-settings.core-'+uuid.uuid4().hex+'.tmp')
        temporary.write_text(json.dumps(next_value,ensure_ascii=False,indent=2),encoding='utf-8')
        os.replace(temporary,settings_path)
    # Existing active routes keep their current process; the verified core is
    # used on the next explicit route apply. This operation never restarts it.
    return {'version':VERSION,'installed':True,'path':str(selected),'verified':True,
        'bundled':selected==bundled,'downloadUrl':URL,'repairSupported':True,'changed':True}

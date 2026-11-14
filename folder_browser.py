"""One user-requested local directory at a time; no recursive scan or writes."""
import ctypes
import os
from pathlib import Path
import re
import stat
import time

MAX_ITEMS=200
MAX_SCANNED=4000

def fixed_roots():
    if os.name!='nt':return []
    api=ctypes.WinDLL('kernel32',use_last_error=True)
    api.GetDriveTypeW.argtypes=[ctypes.c_wchar_p];api.GetDriveTypeW.restype=ctypes.c_uint
    return [letter+':\\' for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if api.GetDriveTypeW(letter+':\\')==3]

def local_path(value,roots):
    if not isinstance(value,str) or len(value)>1024 or not re.match(r'^[A-Za-z]:[\\/]',value) or ':' in value[2:] or any(ord(c)<32 for c in value):
        raise ValueError('Enter an absolute local folder path / 请输入完整的本地文件夹路径')
    try:
        path=Path(os.path.abspath(value))
        if path.anchor.casefold() not in {item.casefold() for item in roots}:raise OSError()
        # Inspect each existing component before resolution, so a junction cannot
        # make a local-looking request enumerate a network or device location.
        for part in reversed([path,*path.parents]):
            if getattr(part.lstat(),'st_file_attributes',0)&stat.FILE_ATTRIBUTE_REPARSE_POINT:raise OSError()
        path=path.resolve(strict=True)
        if path.anchor.casefold() not in {item.casefold() for item in roots} or not path.is_dir():raise OSError()
        return path
    except (OSError,ValueError,RuntimeError):
        raise ValueError('Folder unavailable or not on a local fixed drive / 文件夹不可访问或不在本地固定磁盘上') from None

def browse(value):
    if not isinstance(value,dict) or set(value)-{'path','validate'} or not isinstance(value.get('path',''),str) or type(value.get('validate',False)) is not bool:
        raise ValueError('Invalid folder request / 文件夹请求无效')
    roots=fixed_roots()
    if not roots:raise ValueError('No local fixed drives available / 没有可用的本地固定磁盘')
    requested=value.get('path','')
    if not requested:
        if value.get('validate'):raise ValueError('Choose a folder first / 请先选择文件夹')
        return {'path':'','parent':None,'roots':roots,'folders':[],'selectable':False,'truncated':False}
    path=local_path(requested,roots)
    if value.get('validate'):
        from discovery import validate_root
        checked=validate_root(path)
        return {'path':checked['path'],'valid':checked['valid'],'errorCode':checked.get('error_code')}
    candidate=path.parent if path.name.casefold()=='guiconfigs' else path
    selectable=(candidate/'guiConfigs/guiNConfig.json').is_file() and (candidate/'guiConfigs/guiNDB.db').is_file()
    folders=[];truncated=False;started=time.monotonic()
    try:
        with os.scandir(path) as entries:
            for count,entry in enumerate(entries):
                if count>=MAX_SCANNED or len(folders)>=MAX_ITEMS or time.monotonic()-started>.4:
                    truncated=True;break
                try:
                    if not entry.is_dir(follow_symlinks=False):continue
                    attrs=getattr(entry.stat(follow_symlinks=False),'st_file_attributes',0)
                    if attrs&(stat.FILE_ATTRIBUTE_REPARSE_POINT|stat.FILE_ATTRIBUTE_HIDDEN|stat.FILE_ATTRIBUTE_SYSTEM):continue
                    folders.append(entry.name)
                except OSError:continue
    except OSError:
        raise ValueError('This folder cannot be listed / 无法读取此文件夹列表') from None
    return {'path':str(path),'parent':str(path.parent) if path.parent!=path else None,'roots':roots,
            'folders':sorted(folders,key=str.casefold),'selectable':selectable,'truncated':truncated}

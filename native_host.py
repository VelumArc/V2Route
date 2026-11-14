"""Chrome/Firefox framed JSON bridge for this portable package only."""
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent
MAX_FRAME=1024*1024
COMMANDS={'status','getState','ensure','configure','reorder','importLinks','removeNode','hostSettings','releaseSlot','rescan','chooseV2Folder','folderBrowse','networkTest','chainProbe','coreStatus','installCore','systemProxy'}
MEASURE_COMMANDS={'nodeMeasureStart','nodeMeasurePoll','nodeMeasureCancel'}
LIBRARY_COMMANDS={'subscriptionState','libraryGroups','libraryImport','subscriptionSave','subscriptionRemove','subscriptionContext','subscriptionRefresh'}
COMMANDS.update(MEASURE_COMMANDS|LIBRARY_COMMANDS)
# Firefox closes the native application's Windows Job after each one-shot reply.
# Its documented breakaway flag keeps the user-requested route service alive.
# https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging#closing_the_native_app
BACKGROUND_FLAGS=0x08000000|0x00000200|0x01000000

def extension_id():
    ident=json.loads((ROOT/'extension-id.json').read_text(encoding='utf-8')).get('id')
    if not isinstance(ident,str) or not re.fullmatch('[a-p]{32}',ident):raise ValueError('扩展标识尚未正确配置')
    return ident
def validate_origin(args):
    product=json.loads((ROOT/'product.json').read_text(encoding='utf-8'))
    if product.get('chrome_id')!=extension_id():raise ValueError('Chrome 扩展标识不一致')
    if args and args[0]=='chrome-extension://'+extension_id()+'/':
        return len(args)==1 or (len(args)==2 and re.fullmatch(r'--parent-window=\d+',args[1]) is not None)
    if len(args)!=2 or args[1]!=product.get('firefox_id'):return False
    expected=ROOT/'native'/(product['host_name']+'.firefox.json')
    try:
        if Path(args[0]).resolve(strict=True)!=expected.resolve(strict=True):return False
        value=json.loads(expected.read_text(encoding='utf-8'))
        return (value.get('name')==product['host_name'] and value.get('type')=='stdio'
            and value.get('allowed_extensions')==[product['firefox_id']]
            and Path(value.get('path','')).resolve(strict=True)==(ROOT/'native/V2RouteHost.exe').resolve(strict=True))
    except (OSError,ValueError,TypeError):return False
def validate_message(value):
    if not isinstance(value,dict) or set(value)-{'command','settings'}:raise ValueError('无效的控制消息')
    command=value.get('command')
    if not isinstance(command,str) or command not in COMMANDS:raise ValueError('不支持的控制命令')
    if command in MEASURE_COMMANDS|LIBRARY_COMMANDS or command in ('configure','reorder','importLinks','removeNode','hostSettings','releaseSlot','networkTest','chainProbe','folderBrowse'):
        if not isinstance(value.get('settings'),dict):raise ValueError('缺少有效设置')
    elif value.get('settings') is not None:raise ValueError('此命令不接受设置参数')
    if command=='importLinks' and isinstance(value['settings'].get('text'),str):
        # Normalize shared SOCKS userinfo before forwarding to a warm route service.
        # This applies the parser fix without restarting any active proxy process.
        from proxy_import_formats import parse_document,normalize_socks_uri
        items=parse_document(value['settings']['text'])
        normalized=[normalize_socks_uri(item) if isinstance(item,str) else item for item in items]
        value['settings']={**value['settings'],'text':json.dumps(normalized,ensure_ascii=False)}

    return command,value.get('settings')
def read_exact(stream,count,allow_eof=False):
    chunks=[];remaining=count
    while remaining:
        data=stream.read(remaining)
        if not data:
            if allow_eof and remaining==count:return None
            raise ValueError('控制消息不完整')
        chunks.append(data);remaining-=len(data)
    return b''.join(chunks)
def read_message(stream):
    header=read_exact(stream,4,True)
    if header is None:return None
    length=struct.unpack('<I',header)[0]
    if not 1<=length<=MAX_FRAME:raise ValueError('控制消息长度无效')
    return json.loads(read_exact(stream,length).decode('utf-8'))
def write_message(stream,value):
    data=json.dumps(value,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    if len(data)>MAX_FRAME:data=b'{"ok":false,"error":"Response exceeds native messaging limit"}'
    stream.write(struct.pack('<I',len(data))+data);stream.flush()
def request_backend(command,settings=None):
    import backend
    try:return backend.request(command,settings)
    except (FileNotFoundError,ConnectionRefusedError):pass
    pythonw=Path(sys.executable).with_name('pythonw.exe')
    if not pythonw.is_file():raise RuntimeError('后台 Python 运行环境不存在')
    try:
        subprocess.Popen([str(pythonw),'-I',str(ROOT/'backend.py'),'--headless'],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=BACKGROUND_FLAGS,close_fds=True)
    except OSError as exc:
        raise RuntimeError('无法启动独立线路后台：'+str(exc)) from exc
    deadline=time.monotonic()+12
    while time.monotonic()<deadline:
        time.sleep(.15)
        try:return backend.request(command,settings)
        except (FileNotFoundError,ConnectionRefusedError):pass
    raise RuntimeError('V2Route companion startup timed out / V2Route 本地组件启动超时')
def handle(value,session=None):
    command,settings=validate_message(value)
    if command in MEASURE_COMMANDS:
        if session is None:raise ValueError('Measurement requires an owned native session')
        if 'measurement' not in session:
            from node_measure import Manager
            session['measurement']=Manager()
        return {'ok':True,'result':session['measurement'].handle(command,settings)}
    if command in LIBRARY_COMMANDS:
        import subscriptions
        return {'ok':True,'result':subscriptions.handle(command,settings)}
    if command in ('importLinks','removeNode'):
        # Use current storage code even when the user's route service is warm.
        # Its already-running code must not overwrite new subscription metadata.
        import subscriptions
        result=subscriptions.import_links(settings) if command=='importLinks' else subscriptions.remove_node(settings)
        current=request_backend('getState')
        return {**current,**result}
    if command=='folderBrowse':
        from folder_browser import browse
        return {'ok':True,'result':browse(settings)}
    if command=='systemProxy':
        from system_proxy import get_system_proxy
        return {'ok':True,'result':get_system_proxy()}
    if command in ('coreStatus','installCore'):
        import core_manager
        return {'ok':True,'result':core_manager.status() if command=='coreStatus' else core_manager.install()}
    if command=='networkTest':
        from network_diagnostics import run_test
        return {'ok':True,'result':run_test(settings)}
    if command=='chainProbe':
        from chain_probe import run
        return {'ok':True,'result':run(settings)}
    if command=='configure' and any(isinstance(item,dict) and 'chain' in item for item in settings.get('buttons',{}).values()):
        current=request_backend('getState')
        if not current.get('capabilities',{}).get('explicitChains'):
            raise ValueError('Upgrade the local companion to enable ordered chains / 请升级本地组件以启用多层代理')
    if command=='chooseV2Folder':
        # The user explicitly clicked Browse. Keep its potentially long-lived
        # dialog out of the shared route-service lock/pipe request loop.
        import discovery
        choice=discovery.choose_root()
        if choice.get('ok'):
            result=request_backend('hostSettings',{'v2raynRoot':choice['selected']})
            result['folderSelection']={'cancelled':False,'selected':choice['selected']}
            return result
        if choice.get('error_code')=='cancelled':
            result=request_backend('getState')
            result['folderSelection']={'cancelled':True}
            return result
        raise ValueError(choice.get('error') or 'Cannot select v2rayN folder / 无法选择 v2rayN 目录')
    if command=='configure':
        # Keep the snapshot-to-settings commit atomic against subscription removal,
        # including when the already-running route service predates library locks.
        # The service must not acquire this cross-process lock a second time.
        from library_store import locked
        with locked(timeout=30):
            return request_backend(command,settings)
    return request_backend(command,settings)
def main():
    if not validate_origin(sys.argv[1:]):return 2
    if os.name=='nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    session={}
    try:
        while True:
            try:value=read_message(sys.stdin.buffer)
            except Exception as exc:write_message(sys.stdout.buffer,{'ok':False,'error':str(exc)});return 1
            if value is None:return 0
            try:result=handle(value,session)
            except Exception as exc:result={'ok':False,'error':str(exc)}
            write_message(sys.stdout.buffer,result)
    finally:
        if session.get('measurement') is not None:session['measurement'].close()
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:print('Native host failed: '+str(exc),file=sys.stderr);sys.exit(1)

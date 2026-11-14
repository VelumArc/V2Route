"""Build reviewed graphical helper, optionally embedding the verified complete ZIP."""
import argparse,hashlib,json,os,struct,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def branding():
    """Wrap the approved PNGs unchanged; no second installer artwork source."""
    sizes=(16,20,24,32,40,48,64,128,256)
    assets={};images=[]
    for size in sizes:
        relative=f'chrome-extension/v2route-ui/icons/icon-{size}.png'
        path=ROOT/relative;data=path.read_bytes()
        if data[:8]!=b'\x89PNG\r\n\x1a\n' or struct.unpack('>II',data[16:24])!=(size,size):
            raise RuntimeError('Invalid approved installer icon: '+relative)
        if data!=(ROOT/f'firefox-extension/v2route-ui/icons/icon-{size}.png').read_bytes():
            raise RuntimeError('Browser branding mismatch: '+relative)
        assets[relative]=sha(path);images.append((size,data))
    offset=6+16*len(images);entries=[]
    for size,data in images:
        entries.append(struct.pack('<BBBBHHII',size%256,size%256,0,0,1,32,len(data),offset));offset+=len(data)
    icon=struct.pack('<HHH',0,1,len(images))+b''.join(entries)+b''.join(data for _,data in images)
    header='chrome-extension/v2route-ui/icons/brand-display-216.png';header_data=(ROOT/header).read_bytes()
    if header_data[:8]!=b'\x89PNG\r\n\x1a\n' or struct.unpack('>II',header_data[16:24])!=(216,216):
        raise RuntimeError('Invalid approved installer header: '+header)
    if header_data!=(ROOT/'firefox-extension/v2route-ui/icons/brand-display-216.png').read_bytes():
        raise RuntimeError('Browser header branding mismatch')
    assets[header]=sha(ROOT/header)
    return icon,{'header':header,'header_source_pixels':216,'header_display_pixels':48,'icon_sizes':list(sizes),
                 'assets':assets,'windows_icon_sha256':hashlib.sha256(icon).hexdigest()}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--payload',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args()
    compiler=Path(os.environ.get('WINDIR','C:/Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    source=ROOT/'SetupLauncher.cs';target=args.output or ROOT/'V2Route-Setup.exe'
    target.parent.mkdir(parents=True,exist_ok=True)
    icon,brand=branding()
    # Temporary build inputs stay beside this build's output and are cleaned only by Python.
    with tempfile.TemporaryDirectory(prefix='v2route-setup-icon-',dir=target.parent) as temporary:
        icon_path=Path(temporary)/'V2Route.ico';icon_path.write_bytes(icon)
        command=[str(compiler),'/nologo','/target:winexe','/optimize+','/platform:x64','/debug-',
                 '/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll','/r:System.Web.Extensions.dll',
                 '/win32icon:'+str(icon_path),'/resource:'+str(icon_path)+',V2Route.Brand.ico',
                 '/resource:'+str(ROOT/brand['header'])+',V2Route.Brand.png','/out:'+str(target),str(source)]
        if args.payload:command.append('/resource:'+str(args.payload.resolve(strict=True))+',V2Route.Payload.zip')
        subprocess.run(command,check=True,creationflags=0x08000000)
    receipt={'source':'SetupLauncher.cs','source_sha256':sha(source),'build_script':'build_setup.py','build_script_sha256':sha(Path(__file__)),
             'launcher':target.name,'sha256':sha(target),
             'target':'Windows 10/11 x64; .NET Framework 4.5.2+','signed':False,'payload_sha256':sha(args.payload) if args.payload else None,'branding':brand}
    path=target.with_suffix('.build.json') if args.output or args.payload else ROOT/'licenses/setup-build.json'
    path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n','utf-8');print(json.dumps(receipt,ensure_ascii=False))
if __name__=='__main__':main()

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parent

def main():
    compiler=Path(os.environ.get('WINDIR','C:/Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if not compiler.is_file(): raise RuntimeError('Required installed .NET compiler is unavailable')
    folder=ROOT/'native';folder.mkdir(exist_ok=True)
    source=ROOT/'NativeHost.cs'
    target=folder/'V2RouteHost.exe'
    subprocess.run([str(compiler),'/nologo','/target:exe','/optimize+','/platform:x64','/debug-',
                    '/out:'+str(target),str(source)],check=True,creationflags=0x08000000)
    (folder/'V2RouteHost.exe.config').write_text('<?xml version="1.0" encoding="utf-8"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.0"/></startup></configuration>',encoding='utf8')
    receipt={'launcher':'native/V2RouteHost.exe','sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
             'source':'NativeHost.cs','source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
             'target':'Windows 10/11 x64; Windows .NET Framework 4.x','paths':'relative to executable',
             'runtime_requirement_source':'https://learn.microsoft.com/dotnet/framework/install/'}
    (ROOT/'licenses').mkdir(exist_ok=True)
    (ROOT/'licenses/native-build.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False))

if __name__=='__main__': main()

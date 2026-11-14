"""Build matching readable V2Route sources; no legacy engine or user state."""
import hashlib,json
from pathlib import Path
from pack_portable import ROOT, FILES, OPTIONAL_SOURCE, EXT_ROOT, EXT_TREES, extension_files, archive_bytes, safe_file, yaml_sources
def collect_sources():
    payload={}
    for name in FILES:
        key,data=safe_file(ROOT/name);payload[key]=data
    for name in OPTIONAL_SOURCE:
        path=ROOT/name
        if path.is_file():
            key,data=safe_file(path);payload[key]=data
    payload.update(yaml_sources())
    for browser in ('chrome','firefox'):
        files,manifest=extension_files(browser)
        for name,data in files.items():payload[browser+'-extension/'+name]=data
    for tree in ('licenses/xray/dependencies','licenses/xray/toolchain'):
        for path in sorted((ROOT/tree).rglob('*')):
            if path.is_file():
                name,data=safe_file(path);payload[name]=data
    for name in ('assets/FLAG-ICONS-LICENSE','licenses/python/LICENSE.txt','licenses/xray/LICENSE.txt','licenses/xray/BUILD-INFO.txt','licenses/xray/DEPENDENCY-MANIFEST.json','licenses/xray/THIRD-PARTY-NOTICES.md','licenses/xray/SBOM.cdx.json'):
        key,data=safe_file(ROOT/name);payload[key]=data
    metadata={'product':'Proxy V2Route','format':1,'source_form':'Readable JS/HTML/CSS/JSON/Python/C#. HTML data parser is a readable, unminified pinned parse5 bundle; vendor-html contains its exact build recipe and dependency lock.',
              'upstream_notices':'Retained in COPYING/AUTHORS/NOTICES and SOURCES.md; no legacy ZeroOmega JS engine is packaged',
              'files':{n:hashlib.sha256(data).hexdigest() for n,data in sorted(payload.items())}}
    payload['REBUILD-MANIFEST.json']=(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n').encode()
    return payload,metadata

def main():
    payload,metadata=collect_sources()
    out=ROOT/'sources';out.mkdir(exist_ok=True)
    archive=out/'V2Route-source.zip';archive.write_bytes(archive_bytes(payload))
    receipt={**metadata,'archive':archive.name,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
    (out/'SOURCE-MANIFEST.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'ok':True,'archive':str(archive),'files':len(payload),'sha256':receipt['sha256']}))
if __name__=='__main__':main()

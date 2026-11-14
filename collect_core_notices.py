"""Collect original notices for modules recorded in the bundled Xray binary.

Reads executable build metadata; never runs module code or changes installed V2.
Go's documented build-info and module-zip hash formats are used to verify the
exact source archives, not to infer a license from a project's name.
"""
import base64,concurrent.futures,hashlib,io,json,re,urllib.request,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
BASE=ROOT/'licenses/xray'
CACHE=ROOT/'build-cache/module-notices'
MAX_ZIP=128*1024*1024

def sha(data):return hashlib.sha256(data).hexdigest()

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'V2Route-source-notice-audit/1.0'}),timeout=40) as response:
        data=response.read(MAX_ZIP+1)
    if len(data)>MAX_ZIP:raise ValueError('Source archive exceeds limit: '+url)
    return data

def build_metadata(data):
    header=data.find(b'\xff Go buildinf:')
    if header<0 or not data[header+15]&2:raise ValueError('Unsupported Go inline build-info format')
    offset=header+32
    def string():
        nonlocal offset
        size=shift=0
        for _ in range(10):
            b=data[offset];offset+=1;size|=(b&127)<<shift
            if b<128:break
            shift+=7
        else:raise ValueError('Invalid build-info length')
        if size>1024*1024 or offset+size>len(data):raise ValueError('Invalid build-info range')
        out=data[offset:offset+size];offset+=size;return out
    version=string().decode('ascii');framed=string()
    if len(framed)<32:raise ValueError('Missing framed build metadata')
    text=framed[16:-16].decode('utf-8')
    modules=[]
    for line in text.splitlines():
        parts=line.split('\t')
        if parts[0]=='=>':raise ValueError('Replacement modules require explicit handling')
        if parts[0]=='dep':
            if len(parts)!=4 or not parts[3].startswith('h1:'):raise ValueError('Unverified module dependency')
            modules.append({'module':parts[1],'version':parts[2],'go_sum':parts[3]})
    if not modules:raise ValueError('Missing linked module list')
    return version,text,modules

def go_escape(value):return ''.join('!'+c.lower() if c.isupper() else c for c in value)

def module_h1(archive):
    # Hash1 over sorted full module ZIP member names and each member SHA-256.
    names=archive.namelist()
    if len(names)!=len(set(names)):raise ValueError('Duplicate module ZIP names')
    manifest=bytearray()
    for name in sorted(names):
        if name.endswith('/'):continue
        if '\n' in name:raise ValueError('Invalid module ZIP name')
        manifest.extend((sha(archive.read(name))+'  '+name+'\n').encode())
    return 'h1:'+base64.b64encode(hashlib.sha256(manifest).digest()).decode()

NOTICE=re.compile(r'^(?:licen[sc]e(?:[._-].*)?|copying(?:[._-].*)?|copyright(?:[._-].*)?|notice(?:[._-].*)?|patents|authors(?:[._-].*)?)$',re.I)

def collect_module(item):
    module,version=item['module'],item['version']
    ident=sha((module+'@'+version).encode())[:20]
    url='https://proxy.golang.org/'+go_escape(module)+'/@v/'+go_escape(version)+'.zip'
    cache=CACHE/(ident+'.zip')
    if not cache.exists():cache.write_bytes(fetch(url))
    data=cache.read_bytes();records=[]
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        observed=module_h1(z)
        if observed!=item['go_sum']:raise ValueError('Module source checksum mismatch: '+module)
        prefix=module+'@'+version+'/'
        for name in sorted(z.namelist()):
            if not name.startswith(prefix):raise ValueError('Module ZIP prefix mismatch')
            relative=name[len(prefix):]
            if not NOTICE.fullmatch(Path(relative).name) or name.endswith('/'):continue
            content=z.read(name)
            if not content or len(content)>1024*1024:raise ValueError('Invalid notice size: '+name)
            destination=BASE/'dependencies'/ident/f'{len(records)+1:03d}-{Path(relative).name}'
            destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_bytes(content)
            records.append({'source_path':relative,'file':destination.relative_to(BASE).as_posix(),'sha256':sha(content),'bytes':len(content)})
    if not records:raise ValueError('No original license/notice file found: '+module)
    return {**item,'id':ident,'source_archive':url,'archive_sha256':sha(data),'archive_bytes':len(data),'go_sum_verified':True,'notices':records,'license_assertion':'Original documents retained; no inferred SPDX license expression'}

def main():
    BASE.mkdir(parents=True,exist_ok=True);CACHE.mkdir(parents=True,exist_ok=True)
    exe=(ROOT/'cores/xray/xray.exe').read_bytes()
    provenance=json.loads((BASE/'PROVENANCE.json').read_text())
    if sha(exe)!=provenance['files']['cores/xray/xray.exe']:raise ValueError('Bundled Xray differs from approved official binary')
    go_version,text,modules=build_metadata(exe)
    (BASE/'BUILD-INFO.txt').write_text(go_version+'\n'+text,encoding='utf-8')
    results=[];failures=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        jobs={pool.submit(collect_module,item):item for item in modules}
        for future in concurrent.futures.as_completed(jobs):
            item=jobs[future]
            try:
                result=future.result();results.append(result)
                print(json.dumps({'module':item['module'],'notices':len(result['notices']),'verified':True}),flush=True)
            except Exception as exc:
                failures.append({'module':item['module'],'version':item['version'],'error':str(exc)})
                print(json.dumps(failures[-1]),flush=True)
    results.sort(key=lambda x:x['module'])
    toolchain=[]
    for name in ('LICENSE','PATENTS'):
        url='https://raw.githubusercontent.com/golang/go/'+go_version+'/'+name
        try:
            content=fetch(url);path=BASE/'toolchain'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content)
            toolchain.append({'source':url,'file':path.relative_to(BASE).as_posix(),'sha256':sha(content)})
        except Exception as exc:failures.append({'module':'Go toolchain '+go_version,'file':name,'error':str(exc)})
    manifest={'format':1,'scope':'Dependencies recorded by the linked official Xray binary, plus Go toolchain notices; module code was downloaded only for notice collection and never executed','binary_sha256':sha(exe),'go_version':go_version,'linked_modules':len(modules),'completed_modules':len(results),'complete':len(results)==len(modules) and not failures,'modules':results,'toolchain':toolchain,'failures':failures,'hash_method':'https://pkg.go.dev/golang.org/x/mod/sumdb/dirhash','format_reference':'https://go.dev/src/debug/buildinfo/buildinfo.go'}
    (BASE/'DEPENDENCY-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    notices=['# Xray-core third-party notices / 第三方许可','',f'Xray {provenance["version"]}; binary SHA-256 {sha(exe)}.',f'Build toolchain: {go_version}. Linked module versions and h1 checksums were read from the executable, then each downloaded module ZIP was verified against that h1 checksum. No dependency code was executed. / 从实际可执行文件读取链接模块与校验，逐包核验，不执行依赖源码。','', 'The following original files are reproduced verbatim. Their inclusion is intentionally conservative: notices nested in a module can describe portions not selected by this particular build. The index does not grant additional rights or replace the original terms. / 下列原始文件原样保留；保守收录模块内嵌套声明，其中部分代码未必由本次构建使用，许可原文优先。','']
    for r in results:
        notices.extend(['## '+r['module']+' '+r['version'],'','Source: '+r['source_archive'],'Go checksum: '+r['go_sum'],''])
        for note in r['notices']:
            content=(BASE/note['file']).read_text(encoding='utf-8',errors='replace')
            notices.extend(['### '+note['source_path'],'','````text',content,'````',''])
    for entry in toolchain:
        notices.extend(['## Go '+go_version+' / '+Path(entry['file']).name,'',entry['source'],'','````text',(BASE/entry['file']).read_text(encoding='utf-8'),'````',''])
    if failures:notices.extend(['## Unresolved / 未完成','',json.dumps(failures,indent=2)])
    (BASE/'THIRD-PARTY-NOTICES.md').write_text('\n'.join(notices)+'\n',encoding='utf-8')
    components=[{'type':'library','name':r['module'],'version':r['version'],'bom-ref':'pkg:golang/'+r['module']+'@'+r['version'],'purl':'pkg:golang/'+r['module']+'@'+r['version'],'hashes':[{'alg':'SHA-256','content':r['archive_sha256']}],'externalReferences':[{'type':'distribution','url':r['source_archive']}],'properties':[{'name':'go:h1','value':r['go_sum']},{'name':'notice-files','value':','.join(n['file'] for n in r['notices'])},{'name':'license-review','value':'Original notice text provided; SPDX expression not asserted'}]} for r in results]
    bom={'bomFormat':'CycloneDX','specVersion':'1.6','version':1,'metadata':{'component':{'type':'application','name':'Xray-core','version':provenance['version'],'hashes':[{'alg':'SHA-256','content':sha(exe)}]},'properties':[{'name':'completeness','value':'linked modules complete' if manifest['complete'] else 'incomplete; see DEPENDENCY-MANIFEST.json'}]},'components':components,'dependencies':[{'ref':'Xray-core','dependsOn':[c['bom-ref'] for c in components]}]}
    bom['metadata']['component']['bom-ref']='Xray-core'
    (BASE/'SBOM.cdx.json').write_text(json.dumps(bom,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'complete':manifest['complete'],'linked_modules':len(modules),'completed_modules':len(results),'notice_files':sum(len(r['notices']) for r in results),'failures':failures}),flush=True)
    if not manifest['complete']:raise SystemExit(1)

if __name__=='__main__':main()

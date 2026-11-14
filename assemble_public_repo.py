"""Prepare an offline public source repository. Never contacts or writes GitHub."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import zipfile
from pack_portable import ROOT, validate_export_name

def sha(data):return hashlib.sha256(data).hexdigest()

def build_export(raw,record,repository=None):
    if sha(raw)!=record['sha256']:raise RuntimeError('Source archive checksum failed')
    files={}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if archive.testzip():raise RuntimeError('Source archive CRC failed')
        names=archive.namelist()
        if len(names)!=len({name.casefold() for name in names}):raise RuntimeError('Duplicate source names')
        if set(names)!=set(record['files'])|{'REBUILD-MANIFEST.json'}:raise RuntimeError('Source manifest file set mismatch')
        for name in names:
            p=validate_export_name(name)
            if set(p.parts)&{'runtime','cores'} or p.suffix.lower() in ('.exe','.dll','.pyd'):
                raise RuntimeError('Executable runtime excluded from source export: '+name)
            body=archive.read(name)
            if name!='REBUILD-MANIFEST.json' and sha(body)!=record['files'][name]:raise RuntimeError('Source file checksum failed: '+name)
            files[name]=body
    rebuild=json.loads(files['REBUILD-MANIFEST.json'])
    if rebuild.get('files')!=record['files']:raise RuntimeError('Rebuild and source manifests differ')
    for required in ('README.md','INSTALL.md','docs/index.html','docs/privacy.html','docs/site.css','docs/PRIVACY.md','docs/PERMISSIONS.md'):
        if required not in files:raise RuntimeError('Required public document missing: '+required)
    if repository:
        index=files['docs/index.html'].decode('utf-8')
        if ('href="'+repository+'/archive/refs/heads/main.zip"' not in index
                or 'href="'+repository+'"' not in index
                or 'href="'+repository+'/releases' in index):
            raise RuntimeError('Canonical docs/index.html must link to the specified repository and its current main source archive, without a Releases link')
    # Preserve README, INSTALL and canonical Pages documents exactly.
    files['.gitignore']=b'/private/\n/data/\n/runtime/\n/cores/\n/native/\n/receipts/\n/build-cache/\n/dist/\n/sources/*.zip\nnode_modules/\n__pycache__/\n*.pyc\n*.log\n*.db\n*.sqlite\n'
    files.setdefault('docs/.nojekyll',b'')
    product=json.loads(files.get('product.json',b'{}'))
    output_record={'format':1,'artifact_kind':'public-source-export','product':product.get('name','V2Route'),'version':product.get('version',record.get('version')),
                   'source_archive_sha256':record['sha256'],'repository':repository,'executables_included':False,
                   'files':{n:sha(b) for n,b in sorted(files.items())}}
    files['PUBLIC-SOURCE-MANIFEST.json']=(json.dumps(output_record,ensure_ascii=False,indent=2)+'\n').encode()
    return files,output_record
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--repository',help='Optional verified https://github.com/OWNER/REPO URL')
    args=parser.parse_args()
    repository=None
    if args.repository:
        if not re.fullmatch(r'https://github\.com/[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+/?',args.repository):
            raise RuntimeError('Use an actual GitHub repository URL / 请提供真实 GitHub 仓库网址')
        repository=args.repository.rstrip('/')
    out=args.output.absolute()
    if out.is_symlink() or (out.exists() and any(out.iterdir())):
        raise RuntimeError('Output must be a new or empty ordinary directory / 输出必须是新建或空的普通目录')
    out=out.resolve()
    if ROOT.is_relative_to(out):raise RuntimeError('Output cannot contain the working source / 输出不能覆盖工作源码根目录')
    record=json.loads((ROOT/'sources/SOURCE-MANIFEST.json').read_text(encoding='utf-8'))
    raw=(ROOT/'sources/V2Route-source.zip').read_bytes()
    files,output_record=build_export(raw,record,repository)
    out.mkdir(parents=True,exist_ok=True)
    for name,body in sorted(files.items()):
        target=out.joinpath(*PurePosixPath(name).parts)
        if not target.resolve().is_relative_to(out):raise RuntimeError('Output path escaped repository')
        target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as stream:stream.write(body)
    print(json.dumps({'ok':True,'directory':str(out),'files':len(files),'artifact_kind':'public-source-export','repository':repository},ensure_ascii=False))

if __name__=='__main__':main()

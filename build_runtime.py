"""Fetch one official, hash-pinned Python embeddable build. Build-time only."""
import hashlib,json,shutil,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
VERSION='3.13.17'
URL=f'https://www.python.org/ftp/python/{VERSION}/python-{VERSION}-embed-amd64.zip'
SHA256='9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38'

def main():
    cache=ROOT/'build-cache';cache.mkdir(exist_ok=True)
    archive=cache/URL.rsplit('/',1)[1]
    if not archive.exists():
        with urllib.request.urlopen(URL,timeout=60) as response:archive.write_bytes(response.read())
    actual=hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual!=SHA256:raise RuntimeError('Official Python archive SHA256 mismatch; no files extracted')
    target=ROOT/'runtime';target.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for info in package.infolist():
            path=(target/info.filename).resolve()
            if not path.is_relative_to(target.resolve()):raise RuntimeError('Unexpected archive path')
        package.extractall(target)
    (target/'python313._pth').write_text('python313.zip\n.\n..\n',encoding='utf8')
    folder=ROOT/'licenses/python';folder.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(target/'LICENSE.txt',folder/'LICENSE.txt')
    record={'name':'CPython Windows embeddable x64','version':VERSION,'archive_url':URL,'archive_sha256':actual,
      'official_release':'https://www.python.org/downloads/release/python-31317/',
      'source':'https://github.com/python/cpython/tree/v3.13.17',
      'license':'PSF-2.0 and bundled third-party notices; see LICENSE.txt',
      'runtime_docs':'https://docs.python.org/3.13/using/windows.html#the-embeddable-package',
      'modifications':{'python313._pth':'python313.zip; .; ..; no import site'},
      'files':{p.relative_to(target).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(target.rglob('*')) if p.is_file()}}
    (folder/'PROVENANCE.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'ok':True,'version':VERSION,'archive_sha256':actual,'files':len(record['files'])}))

if __name__=='__main__':main()

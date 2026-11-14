"""Developer-only fetch of a pinned official core; never touches installed v2rayN."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
VERSION = 'v26.10.31'
URL = f'https://github.com/XTLS/Xray-core/releases/download/{VERSION}/Xray-windows-64.zip'
SHA256 = '2e04a9995a6f2ad1b28c0bb25c708ecb2695e43a1c9c7889c4b6ac2b48cf7a6a'
SOURCE = f'https://github.com/XTLS/Xray-core/archive/refs/tags/{VERSION}.zip'

def main():
    cache = ROOT / 'build-cache'
    cache.mkdir(exist_ok=True)
    archive = cache / f'Xray-{VERSION}-windows-64.zip'
    if not archive.exists():
        urllib.request.urlretrieve(URL, archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError('Official Xray archive checksum mismatch / 官方核心校验失败')
    dest = ROOT / 'cores/xray'; dest.mkdir(parents=True, exist_ok=True)
    license_dir = ROOT / 'licenses/xray'; license_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        exe = z.read('xray.exe')
        (dest/'xray.exe').write_bytes(exe)
        names = z.namelist()
        notices = [n for n in names if n.upper() in ('LICENSE', 'LICENSE.TXT', 'README.MD')]
        for n in notices:
            (license_dir / Path(n).name).write_bytes(z.read(n))
    source_zip = license_dir / f'Xray-core-{VERSION}-source.zip'
    if not source_zip.exists():
        urllib.request.urlretrieve(SOURCE, source_zip)
    with zipfile.ZipFile(source_zip) as z:
        license_name = next(n for n in z.namelist() if n.endswith('/LICENSE'))
        (license_dir/'LICENSE.txt').write_bytes(z.read(license_name))
    record = {'name':'Xray-core', 'version':VERSION, 'license':'MPL-2.0',
        'url':URL, 'archive_sha256':SHA256, 'publisher_checksum':'GitHub release asset digest',
        'source_url':SOURCE, 'source_file':source_zip.name,
        'source_sha256':hashlib.sha256(source_zip.read_bytes()).hexdigest(),
        'files':{'cores/xray/xray.exe':hashlib.sha256(exe).hexdigest()},
        'scope':'This package only; installed v2rayN is never changed'}
    (license_dir/'PROVENANCE.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(record))

if __name__ == '__main__': main()

"""Build the Windows snapshot-only sidecar from content-verified distribution archives."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "resources/harness"
ID = "harness-0.2.2-rc.3-node24.22.1-win-x64-r2"
NODE_SHA = "d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5"
BASELINE = "39163dd30f703a79079e2d2446545cff3c453738"
def encoded(obj):
    return (json.dumps(obj, ensure_ascii=True, sort_keys=True, separators=(',', ':'))+'\n').encode('ascii')

def tarball(meta, cache):
    kind, value = meta["integrity"].split("-",1)
    if kind != "sha512" or not meta["resolved"].startswith("https://registry.npmjs.org/"):
        raise ValueError("Unsupported lockfile source")
    digest = base64.b64decode(value,validate=True)
    address = digest.hex()
    local = cache/"_cacache"/"content-v2"/kind/address[:2]/address[2:4]/address[4:]
    if local.is_file():
        data=local.read_bytes()
    else:
        with urllib.request.urlopen(meta["resolved"],timeout=30) as response: data=response.read(100*1024*1024+1)
    if hashlib.sha512(data).digest()!=digest: raise ValueError("npm archive integrity mismatch")
    return data

def selected(name):
    parts=PurePosixPath(name).parts
    # Include package entry points and adjacent runtime data plus legal notices.
    if any(p.lower().startswith(('license','licence','copying','notice','copyright','third_party','third-party')) for p in parts):return True
    if any(p.lower() in ('test','tests','__tests__','examples','benchmark','docs','node_modules') for p in parts):return False
    return name.endswith(('.js','.mjs','.cjs','.json','.yml','.yaml','.node','.dll','.wasm','.dat'))

def build(args):
    from re import fullmatch
    lockbytes=(SPEC/'dev-runtime/package-lock.json').read_bytes()
    packages=json.loads(lockbytes)['packages']
    requested=json.loads((SPEC/'windows-packages.json').read_text())
    if len(set(requested))!=len(requested):raise ValueError("Duplicate package")
    files={}
    def put(name,data):
        if not fullmatch(r'[A-Za-z0-9@_+.~ /-]+',name) or any(s in ('','.','..') or s.endswith((' ','.')) for s in name.split('/')):
            raise ValueError("Invalid member: "+name)
        if name in files:raise ValueError("Duplicate file: "+name)
        files[name]=data
    with args.node_zip.open('rb') as inp:
        if hashlib.file_digest(inp,'sha256').hexdigest()!=NODE_SHA:raise ValueError("Wrong official Node zip")
        inp.seek(0)
        with zipfile.ZipFile(inp) as z:
            put("node.exe",z.read("node-v24.22.1-win-x64/node.exe"))
            put("notices/node-LICENSE.txt",z.read("node-v24.22.1-win-x64/LICENSE"))
    upstream={'LICENSE':'ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be','THIRD_PARTY_NOTICES.md':'f2d50810380d1855ee83b9b46514033f2ac8c406d49bc8ecab711406a2acd061'}
    for name,digest in upstream.items():
        data=(subprocess.check_output(['git','-C',str(args.harness_src),'show',BASELINE+':'+name]) if args.harness_src else
              (SPEC/'notices'/('upstream-'+name+'.txt')).read_bytes().replace(b'\r\n',b'\n'))
        if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Unexpected upstream notice: '+name)
        put('notices/harness-'+name,data)
    inventory=[]
    tar_cache={}
    for key in requested:
        meta=packages[key]; value=meta['integrity']
        if value not in tar_cache:tar_cache[value]=tarball(meta,args.npm_cache)
        names=[]
        with tarfile.open(fileobj=io.BytesIO(tar_cache[value]),mode='r:gz') as tf:
            for m in tf:
                if not m.isfile():continue
                prefix,sep,name=m.name.partition('/')
                if prefix!='package' or not sep: raise ValueError("Invalid npm tar member: "+m.name)
                if selected(name):
                    put(key+'/'+name,tf.extractfile(m).read());names.append(name)
        pkg=json.loads(files[key+'/package.json'])
        if pkg['version']!=meta['version'] or pkg['name']!=key.split('node_modules/')[-1]:raise ValueError("Package mismatch: "+key)
        texts=[n for n in names if PurePosixPath(n).name.lower().startswith(('license','licence','copying','notice','copyright'))]
        if not texts and pkg['name']=='@koromix/koffi-win32-x64' and pkg['version']==packages['node_modules/koffi']['version']:
            texts=['SEE node_modules/koffi/LICENSE.txt']
        if not texts:raise ValueError("Missing license text: "+key)
        inventory.append(dict(path=key,version=pkg['version'],license=pkg.get('license'),integrity=value,notices=sorted(texts)))
    for item in inventory:
        for n in item['notices']:
            if n.startswith('SEE ') and n[4:] not in files:raise ValueError(n)
    put('notices/packages.json',encoded(inventory))
    put('snapshot-only.yml',(SPEC/'snapshot-only.yml').read_bytes().replace(b'\r\n',b'\n'))
    if len(set(n.lower() for n in files))!=len(files):raise ValueError("Windows filename collision")
    manifest=encoded(dict(schema=1,component=ID,files={n:[len(d),hashlib.sha256(d).hexdigest()] for n,d in files.items()}))
    anchor=hashlib.sha256(manifest).hexdigest()
    if not args.candidate and anchor!=(SPEC/'component.sha256').read_text().strip(): raise ValueError("Component differs from the reviewed host pin: "+anchor)
    args.output.mkdir(exist_ok=True,parents=True)
    dest=args.output/(ID+'.zip')
    # Build off to the side, publish only complete artifacts, and never overwrite.
    with tempfile.TemporaryDirectory(dir=args.output) as temp:
        archive=Path(temp)/'component.zip'
        with zipfile.ZipFile(archive,'x') as z:
            for name,data in sorted({**files,'manifest.json':manifest}.items()):
                info=zipfile.ZipInfo(name,(2020,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
                z.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
        os.link(archive,dest)
    print(json.dumps(dict(path=str(dest),manifestSha256=anchor,packages=len(requested),files=len(files),packedBytes=dest.stat().st_size,payloadBytes=sum(map(len,files.values())))))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node-zip',type=Path,required=True)
    parser.add_argument('--harness-src',type=Path,help='Optional upstream Git checkout; use pinned Git object notices instead of the vendored copies')
    parser.add_argument('--npm-cache',type=Path,default=Path(os.environ.get('LOCALAPPDATA','.'))/'npm-cache')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--candidate',action='store_true',help='Build an unapproved candidate when reviewing a component update; never changes the host pin.')
    build(parser.parse_args())

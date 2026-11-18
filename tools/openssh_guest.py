"""Boot a disposable Alpine/OpenSSH guest on VMware VMnet1; never reuse a personal VM."""
import argparse
import base64
from contextlib import contextmanager, ExitStack
import ctypes
from ctypes import wintypes
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import pycdlib
from dissect.hypervisor.disk.qcow2 import QCow2

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'src-tauri/target'
IMAGE = 'nocloud_alpine-3.23.4-x86_64-bios-cloudinit-r0.qcow2'
OFFICIAL = 'https://dl-cdn.alpinelinux.org/alpine/v3.23/releases/cloud/' + IMAGE
PIN = '05bd2071f54cb47307fd1f9ff99333b3426dafa7fea95253b1100119b4da537e5f415c369a7c74b8c4d11cc22db178e26f39ecb27b7757edbe25d19a9944f061'
COMPONENT = 'harness-0.2.2-rc.3-node24.22.1-win-x64-r2.zip'


def checked_image(cache):
    cache.mkdir(exist_ok=True, parents=True)
    dest = cache / IMAGE
    def verify(p):
        with p.open('rb') as f:
            if hashlib.file_digest(f, 'sha512').hexdigest() != PIN:
                raise ValueError('Unexpected Alpine image; check the official SHA-512')
    if not dest.exists():
        with tempfile.TemporaryDirectory(dir=cache) as td:
            tmp = Path(td) / 'download'
            with urllib.request.urlopen(OFFICIAL, timeout=120) as src, tmp.open('xb') as out:
                shutil.copyfileobj(src, out, 1024*1024)
            verify(tmp)
            tmp.rename(dest)
    else:
        verify(dest)
    return dest


def seed(dir_, nonce, port, label):
    key = dir_ / 'client-key'
    # Use an argument vector so the empty passphrase reaches ssh-keygen on Windows.
    subprocess.run([shutil.which('ssh-keygen'), '-q', '-t', 'ed25519', '-N', '', '-C', 'dalizi-qa', '-f', key], check=True)
    pub = key.with_suffix('.pub').read_text().strip()
    script = f'''#!/bin/sh
set -eu
umask 077
home=/home/alpine
install -d -o alpine -g alpine -m 700 "$home/private" "$home/shared" "$home/Paper" "$home/paper"
printf '{'DALIZI_OPENSSH_SELECTED' if label=='a' else 'DALIZI_OPENSSH_PEER_B'}' > "$home/private/notes.md"
printf 'DALIZI_OPENSSH_OTHER' > "$home/private/other.md"
printf 'SHARED' > "$home/shared/notes.md"
printf 'UPPER' > "$home/Paper/notes.md"
printf 'LOWER' > "$home/paper/notes.md"
chown alpine:alpine "$home/private/"*.md "$home/shared/notes.md" "$home/Paper/notes.md" "$home/paper/notes.md"
chmod 0777 "$home/shared"
ln -s other.md "$home/private/alias.md"
ssh-keygen -q -t ed25519 -N '' -f /run/dalizi-host
cat >/etc/ssh/sshd_config <<'END'
Port {port}
HostKey /run/dalizi-host
AllowUsers alpine
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
AllowTcpForwarding no
AllowAgentForwarding no
X11Forwarding no
Subsystem sftp internal-sftp
{'ForceCommand internal-sftp' if label=='b' else '# Normal interactive shell'}
END
/usr/sbin/sshd -t
rc-service sshd restart
addr=$(ip -4 -o addr show scope global | awk 'NR==1{{split($4,a,"/");print a[1]}}')
fp=$(ssh-keygen -lf /run/dalizi-host.pub -E sha256 | awk '{{print $2}}')
ver=$(/usr/sbin/sshd -V 2>&1 | awk 'NR==1{{print $1}}' | tr -d ',')
printf '\nDALIZI_GUEST_READY {nonce} %s %s %s\n' "$addr" "$fp" "$ver" >/dev/ttyS0
'''
    config = {'ssh_authorized_keys':[pub],'ssh_pwauth':False,
              'write_files':[{'path':'/run/dalizi-init','permissions':'0700','encoding':'b64',
                              'content':base64.b64encode(script.encode()).decode()}],
              'runcmd':[['/bin/sh','/run/dalizi-init']]}
    iso=pycdlib.PyCdlib()
    iso.new(interchange_level=3, joliet=3, rock_ridge='1.09', vol_ident='CIDATA')
    for name,data in [('user-data','#cloud-config\n'+json.dumps(config)+'\n'),
                      ('meta-data', 'instance-id: dalizi-'+nonce+'\nlocal-hostname: dalizi-qa\n')]:
        data=data.encode()
        iso.add_fp(io.BytesIO(data),len(data),iso_path='/'+name.upper().replace('-','_')+'.;1',
                   rr_name=name,joliet_path='/'+name)
    iso.write(str(dir_/'seed.iso'));iso.close()
    return key


def machine(dir_, image):
    # Read a verified standalone disk. Do not allow backing chains or external data files.
    with image.open('rb') as src, (dir_/'disk.raw').open('xb') as dst:
        qc=QCow2(src)
        if qc.needs_backing_file or qc.needs_data_file or not 0 < qc.header.size <= 1024**3:
            raise ValueError('Not a standalone test image')
        with qc.open() as data:
            shutil.copyfileobj(data,dst,1024*1024)
        dst.truncate(512*1024**2)
    (dir_/'guest.vmdk').write_text('# Disk DescriptorFile\nversion=1\nCID=12345678\nparentCID=ffffffff\ncreateType="monolithicFlat"\nRW 1048576 FLAT "disk.raw" 0\nddb.adapterType = "ide"\nddb.geometry.cylinders = "1040"\nddb.geometry.heads = "16"\nddb.geometry.sectors = "63"\n',encoding='ascii')
    params={'.encoding':'UTF-8','config.version':'8','virtualHW.version':'16','guestOS':'otherlinux-64',
            'displayName':dir_.parent.name+'-'+dir_.name,'memsize':'768','numvcpus':'1','firmware':'bios','bios.bootOrder':'hdd,cdrom',
            'ide0:0.present':'TRUE','ide0:0.fileName':'guest.vmdk','ide1:0.present':'TRUE',
            'ide1:0.deviceType':'cdrom-image','ide1:0.fileName':'seed.iso','floppy0.present':'FALSE',
            'ethernet0.present':'TRUE','ethernet0.connectionType':'custom','ethernet0.vnet':'VMnet1',
            'ethernet0.virtualDev':'e1000','ethernet0.addressType':'generated','serial0.present':'TRUE',
            'serial0.fileType':'file','serial0.fileName':'serial.log','serial0.startConnected':'TRUE',
            'usb.present':'FALSE','sound.present':'FALSE','isolation.tools.hgfs.disable':'TRUE',
            'sharedFolder.maxNum':'0','msg.autoAnswer':'TRUE','uuid.action':'create'}
    vmx=dir_/'guest.vmx'
    vmx.write_text(''.join(f'{k} = "{v}"\n' for k,v in params.items()),encoding='ascii')
    return vmx


def vm_command(vmrun, *args, timeout=65):
    return subprocess.run([vmrun,'-T','ws',*args],capture_output=True,text=True,errors='replace',
                          timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW,check=True).stdout


def ready(dir_, nonce, subnet, vmrun, vmx):
    deadline=time.monotonic()+130
    pattern=re.compile(r'DALIZI_GUEST_READY '+nonce+r' ([\d.]+) (SHA256:[A-Za-z0-9+/]{43}) (OpenSSH_[\w.p-]+)')
    serial=dir_/'serial.log'
    while time.monotonic()<deadline:
        if serial.exists():
            match=pattern.search(serial.read_bytes()[-131072:].decode('utf-8',errors='replace'))
            if match:
                host=ipaddress.IPv4Address(match[1])
                if host not in subnet or host in (subnet.network_address,subnet.broadcast_address):
                    raise ValueError('Guest is not on the expected host-only network')
                return str(host),match[2],match[3]
        if not any(os.path.normcase(x.strip())==os.path.normcase(str(vmx)) for x in vm_command(vmrun,'list').splitlines()):
            raise RuntimeError('Our guest stopped before OpenSSH became ready')
        time.sleep(2)
    raise TimeoutError('Guest boot timed out; see the generated serial and VMware logs')


def clear_fixture_trust(host, port, expected):
    # Match both our test endpoint AND the freshly generated fingerprint before deletion.
    digest=hashlib.sha256()
    for value in [host,str(port)]:
        b=value.encode();digest.update(len(b).to_bytes(8,'little'));digest.update(b)
    target='DaliziFiles/SSH/host/'+digest.hexdigest()
    class Credential(ctypes.Structure):
        _fields_=[('Flags',wintypes.DWORD),('Type',wintypes.DWORD),('TargetName',wintypes.LPWSTR),
                  ('Comment',wintypes.LPWSTR),('LastWritten',wintypes.FILETIME),
                  ('Size',wintypes.DWORD),('Blob',ctypes.POINTER(ctypes.c_ubyte))]
    api=ctypes.WinDLL('advapi32',use_last_error=True)
    ptr=ctypes.POINTER(Credential)()
    if not api.CredReadW(ctypes.c_wchar_p(target),1,0,ctypes.byref(ptr)):
        if ctypes.get_last_error()==1168:return 'absent'
        raise ctypes.WinError(ctypes.get_last_error())
    try: same=ctypes.string_at(ptr.contents.Blob,ptr.contents.Size)==expected.encode()
    finally: api.CredFree(ptr)
    if not same:raise RuntimeError('Trust entry changed independently; left untouched')
    if not api.CredDeleteW(ctypes.c_wchar_p(target),1,0):raise ctypes.WinError(ctypes.get_last_error())
    if api.CredReadW(ctypes.c_wchar_p(target),1,0,ctypes.byref(ptr)):
        api.CredFree(ptr);raise RuntimeError('Test trust still present')
    if ctypes.get_last_error()!=1168:raise ctypes.WinError(ctypes.get_last_error())
    return 'removed'


@contextmanager
def guest(args, run, image, subnet, label, port):
    dir_=run/('peer-'+label)
    dir_.mkdir()
    nonce=secrets.token_hex(12)
    vmx=None
    host=fp=version=None
    result={'label':label,'trust':'not-created'}
    try:
        key=seed(dir_,nonce,port,label);vmx=machine(dir_,image)
        vm_command(args.vmrun,'start',vmx,'nogui')
        host,fp,version=ready(dir_,nonce,subnet,args.vmrun,vmx)
        print('Guest ready:',label,version,flush=True)
        result['server']=version
        yield dict(host=host,port=port,fingerprint=fp,identityFile=str(key),nonce=nonce,label=label),result
    finally:
        try:
            if host and fp and (dir_/'trust-owned').exists():result['trust']=clear_fixture_trust(host,port,fp)
        finally:
            if run.parent!=(TARGET/'openssh-guests').resolve() or dir_.resolve().parent!=run:raise RuntimeError('Unsafe VM cleanup path')
            if vmx is not None:
                if vmx.resolve().parent!=dir_:raise RuntimeError('Unexpected VMX path')
                running=lambda: any(os.path.normcase(x.strip())==os.path.normcase(str(vmx)) for x in vm_command(args.vmrun,'list').splitlines())
                if running():vm_command(args.vmrun,'stop',vmx,'hard')
                if running():raise RuntimeError('Disposable VM did not stop; retaining its files')
            for name in ('client-key','client-key.pub','guest.vmdk','disk.raw','seed.iso'):
                (dir_/name).unlink(missing_ok=True)
            result.update(guestStopped=True,temporaryKeyRemoved=not (dir_/'client-key').exists())
            print('Guest stopped; temporary keys and disk removed:',label,flush=True)


def main(args):
    base=TARGET/'openssh-guests'
    base.mkdir(parents=True,exist_ok=True)
    image=checked_image(TARGET/'openssh-qa-cache')
    raw=subprocess.check_output(['powershell.exe','-NoProfile','-Command',
      "Get-NetIPAddress -AddressFamily IPv4 | Where-Object InterfaceAlias -like '*VMnet1' | Select-Object IPAddress,PrefixLength | ConvertTo-Json -Compress"],text=True)
    nic=json.loads(raw);subnet=ipaddress.ip_network(f"{nic['IPAddress']}/{nic['PrefixLength']}",strict=False)
    if not subnet.is_private:raise ValueError('Expected a private host-only adapter')
    run=Path(tempfile.mkdtemp(prefix='dalizi-openssh-',dir=base)).resolve()
    print('Disposable test directory:',run,flush=True)
    port=18000+secrets.randbelow(24000)
    results=[]
    with ExitStack() as stack:
        peers=[]
        for label in ('a',) if args.boot_only else ('a','b'):
            peer,result=stack.enter_context(guest(args,run,image,subnet,label,port))
            peers.append(peer)
            results.append(result)
        if args.boot_only:return
        exe=run/'openssh-fixture.exe'
        binary=args.desktop.read_bytes()
        if b'com.dalizi.openssh-qa' not in binary:raise ValueError('Expected isolated release host')
        exe.write_bytes(binary)
        folder=run/'components';folder.mkdir()
        if args.component.name!=COMPONENT:raise ValueError('Wrong component')
        shutil.copyfile(args.component,folder/COMPONENT)
        manifest=run/'fixture.json'
        manifest.write_text(json.dumps(peers),encoding='utf-8')
        pinned=Path(os.environ['LOCALAPPDATA'])/'DaliziDev/node-v24.22.1-win-x64/node.exe'
        node=str(pinned) if pinned.is_file() else shutil.which('node')
        subprocess.run([node,'tools/harness_m1_smoke.cjs',exe,'--openssh',manifest],cwd=ROOT,check=True,timeout=180)
    report=json.loads((run/'desktop-acceptance.json').read_text())
    report.update(guestImage=IMAGE,guestImageSha512=PIN,guests=results)
    with (run/'acceptance.json').open('x',encoding='utf-8') as f:json.dump(report,f,indent=2);f.write('\n')


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--vmrun',type=Path,default=Path(os.environ.get('ProgramFiles','C:/Program Files'))/'VMware/VMware Workstation/vmrun.exe')
    cli.add_argument('--boot-only',action='store_true')
    cli.add_argument('--desktop',type=Path)
    cli.add_argument('--component',type=Path)
    args=cli.parse_args()
    if not args.boot_only and not (args.desktop and args.component):cli.error('pass --desktop and --component')
    try:main(args)
    except subprocess.CalledProcessError as exc:
        print(exc.stdout or '',exc.stderr or '',file=sys.stderr)
        raise

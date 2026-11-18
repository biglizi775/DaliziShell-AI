"""Read a pinned data disc in a disposable offline VMware Linux guest. No Windows app runs."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import time
import zipfile

import pycdlib
from collect_windows_guest_report import payload
from openssh_guest import checked_image, machine, vm_command, TARGET, ROOT
from prepare_windows_guests import digest
from windows_qa_release import CURRENT, RELEASES, disc_entry, kit_names, record


def create_seed(folder, checks, probe, tag):
    lines = ''.join(f'{h}  {name}\n' for name, h in checks.items())
    frame = 'DALIZI-'+tag.upper()+' '+hashlib.sha256(probe).hexdigest()+' '+base64.b64encode(probe).decode()
    script = f"""#!/bin/sh
set -eu
mkdir -p /run/disc
for drive in /dev/sr*; do
  mount -t iso9660 -o ro "$drive" /run/disc || continue
  if [ -f /run/disc/Run-Guest.ps1 ]; then
    if (cd /run/disc && sha256sum -c /run/expected); then
      printf '\\n%s\\n' '{frame}' > /dev/ttyS0
      exit 0
    fi
  fi
  umount /run/disc
done
printf '\\nDALIZI_DISC_ERROR\\n' > /dev/ttyS0
"""
    files = [{'path':path, 'encoding':'b64', 'content':base64.b64encode(data.encode()).decode()}
             for path,data in [('/run/expected',lines),('/run/disc-probe.sh',script)]]
    entries = {'user-data':'#cloud-config\n'+json.dumps({'write_files':files,
               'runcmd':[['/bin/sh','/run/disc-probe.sh']]})+'\n',
               'meta-data':'instance-id: dalizi-'+secrets.token_hex(12)+'\n',
               'network-config':'version: 2\nethernets: {}\n'}
    seed = pycdlib.PyCdlib()
    seed.new(interchange_level=3, joliet=3, rock_ridge='1.09', vol_ident='CIDATA')
    try:
        for i,(name,value) in enumerate(entries.items()):
            data=value.encode()
            seed.add_fp(io.BytesIO(data),len(data),iso_path=f'/FILE{i}.;1',rr_name=name,joliet_path='/'+name)
        seed.write(str(folder/'seed.iso'))
    finally:
        seed.close()


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('disc', type=Path)
    ap.add_argument('--release', choices=RELEASES, default=CURRENT)
    args=ap.parse_args()
    disc=args.disc.resolve(strict=True)
    release=record(args.release)['offlineKit']
    names=kit_names(args.release)
    with (ROOT/'dist'/release['file']).open('rb') as inp:
        if digest(inp)!=release['sha256']:
            raise ValueError('Unknown acceptance kit')
        inp.seek(0)
        with zipfile.ZipFile(inp) as kit:
            if sorted(kit.namelist())!=sorted(names):
                raise ValueError('Unexpected kit entries')
            checks={name:hashlib.sha256(kit.read(name)).hexdigest() for name in names}
    checks['Run-Guest.ps1']=hashlib.sha256(disc_entry(args.release)).hexdigest()
    probe=json.dumps({'kind':'optical-transport-only','files':len(checks),'nonce':secrets.token_hex(16)}).encode()
    base=TARGET/'windows-guests'
    base.mkdir(exist_ok=True)
    image=checked_image(TARGET/'openssh-qa-cache')
    folder=Path(tempfile.mkdtemp(prefix='disc-probe-',dir=base)).resolve()
    print('Isolated probe:',folder,flush=True)
    vmrun=str(Path(os.environ['ProgramFiles'])/'VMware/VMware Workstation/vmrun.exe')
    vmx=machine(folder,image)
    config=vmx.read_text().replace('ethernet0.present = "TRUE"','ethernet0.present = "FALSE"')
    config+='sata0.present = "TRUE"\nsata0:2.present = "TRUE"\nsata0:2.deviceType = "cdrom-image"\n'
    config+=f'sata0:2.fileName = "{disc.as_posix()}"\nsata0:2.startConnected = "TRUE"\n'
    vmx.write_text(config,encoding='utf-8')
    create_seed(folder,checks,probe,args.release)
    def running():
        return os.path.normcase(str(vmx)) in [os.path.normcase(x.strip()) for x in vm_command(vmrun,'list').splitlines()]
    try:
        vm_command(vmrun,'start',str(vmx),'nogui')
        deadline=time.monotonic()+150
        serial=folder/'serial.log'
        while time.monotonic()<deadline:
            data=serial.read_bytes() if serial.exists() else b''
            if b'DALIZI_DISC_ERROR' in data:
                raise RuntimeError('Guest could not read the data disc or file hashes did not match')
            if any(line.startswith(b'DALIZI-RC') for line in data.split(b'\n')[:-1]):
                if payload(data,args.release)!=probe:
                    raise ValueError('Unexpected serial response')
                break
            time.sleep(1)
        else:
            raise TimeoutError('No complete serial frame from the guest')
    finally:
        if running():
            vm_command(vmrun,'stop',str(vmx),'hard')
        if running():
            raise RuntimeError('Probe guest is still running')
    # Only remove the newly allocated probe after it stopped and passed.
    if folder.parent!=base.resolve() or not folder.name.startswith('disc-probe-'):
        raise RuntimeError('Unexpected cleanup path')
    shutil.rmtree(folder)
    print(f'Isolated VMware SATA optical read: {len(checks)} file hashes matched; serial frame round trip passed.')


if __name__=='__main__':
    main()

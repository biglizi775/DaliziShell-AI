"""Prepare a read-only candidate data disc and optionally NEW, powered-off QA VMs. No OS media is included."""
import argparse
import hashlib
import io
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

import pycdlib

from windows_qa_release import ROOT, CURRENT, RELEASES, disc_entry, kit_names, record


def digest(stream):
    return hashlib.file_digest(stream, 'sha256').hexdigest()


def make_disc(kit_path, disc, pin, tag):
    names=kit_names(tag)
    # Use the same open file for the pinned archive and its entries.
    with kit_path.open('rb') as inp:
        if digest(inp) != pin:
            raise ValueError('Not the verified offline acceptance kit for this release')
        inp.seek(0)
        with zipfile.ZipFile(inp) as kit:
            if sorted(kit.namelist()) != sorted(names):
                raise ValueError('Unexpected kit entries')
            data = {name: kit.read(name) for name in names}
    data['Run-Guest.ps1'] = disc_entry(tag)
    names['Run-Guest.ps1']='RUN.PS1'
    image = pycdlib.PyCdlib()
    image.new(interchange_level=3, joliet=3, vol_ident='DALIZI_'+tag.upper())
    try:
        for name, content in data.items():
            image.add_fp(io.BytesIO(content), len(content), iso_path='/'+names[name]+';1', joliet_path='/'+name)
        with disc.open('xb') as out:
            image.write_fp(out)
    finally:
        image.close()
    image = pycdlib.PyCdlib()
    image.open(str(disc))
    try:
        for name, expected in data.items():
            with image.open_file_from_iso(joliet_path='/'+name) as actual:
                if digest(actual) != hashlib.sha256(expected).hexdigest():
                    raise ValueError('Read-back mismatch for '+name)
    finally:
        image.close()


def create_guest(run, family, vdisk, disc, tag):
    folder = run / ('Windows'+family)
    folder.mkdir()
    disk = folder/'system.vmdk'
    subprocess.run([str(vdisk), '-c', '-s', '80GB', '-a', 'lsilogic', '-t', '0', str(disk)], check=True)
    # CD 1 is disconnected with a harmless ISO backing. The operator selects their
    # Windows installer there; CD 2 always exposes the immutable test disc.
    params = {'.encoding':'UTF-8', 'config.version':'8','virtualHW.version':'20',
              'guestOS':'windows9-64' if family=='10' else 'windows11-64',
              'displayName':f'Dalizi {tag.upper()} - Windows {family} x64 QA',
              'firmware':'efi', 'uefi.secureBoot.enabled':'TRUE','memsize':'6144',
              'numvcpus':'2','cpuid.coresPerSocket':'2','sata0.present':'TRUE',
              'sata0:0.present':'TRUE','sata0:0.fileName':disk.name,
              'ethernet0.present':'TRUE','ethernet0.connectionType':'nat',
              'ethernet0.virtualDev':'e1000e','ethernet0.startConnected':'FALSE',
              'ethernet0.addressType':'generated','usb.present':'FALSE','sound.present':'FALSE',
              'floppy0.present':'FALSE','sharedFolder.maxNum':'0','isolation.tools.hgfs.disable':'TRUE',
              'isolation.tools.copy.disable':'TRUE','isolation.tools.paste.disable':'TRUE',
              'serial0.present':'TRUE','serial0.fileType':'file','serial0.fileName':'acceptance-serial.log',
              'serial0.startConnected':'TRUE','uuid.action':'create'}
    for slot in (1,2):
        port = f'sata0:{slot}.'
        params.update({port+'present':'TRUE',port+'deviceType':'cdrom-image',
                       port+'fileName':os.path.relpath(disc,folder).replace(os.sep,'/'),
                       port+'startConnected':'TRUE' if slot==2 else 'FALSE'})
    vmx = folder / ('Windows'+family+'.vmx')
    with vmx.open('x', encoding='utf-8', newline='\n') as out:
        for k,v in params.items():
            out.write(f'{k} = "{v}"\n')
    return vmx


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', choices=RELEASES, default=CURRENT)
    parser.add_argument('--disc-only', action='store_true', help='Reuse your existing guests; create no VM or disk')
    parser.add_argument('--vmware', type=Path, default=Path(os.environ['ProgramFiles'])/'VMware/VMware Workstation')
    args=parser.parse_args()
    vdisk=args.vmware/'vmware-vdiskmanager.exe'
    if not args.disc_only and not vdisk.is_file():
        raise FileNotFoundError(vdisk)
    release=record(args.release)['offlineKit']
    kit=ROOT/'dist'/release['file']
    base=ROOT/'src-tauri/target/windows-guests'
    base.mkdir(parents=True,exist_ok=True)
    run=Path(tempfile.mkdtemp(prefix=args.release+'-',dir=base))
    disc=run/f'Dalizi-{args.release.upper()}-QA.iso'
    make_disc(kit,disc,release['sha256'],args.release)
    print(disc,flush=True)
    if not args.disc_only:
        for family in ('10','11'):
            print(create_guest(run,family,vdisk,disc,args.release),flush=True)
        print('No operating system installed. Windows 11 needs VMware encryption and a vTPM before installation.')
    with disc.open('rb') as file:
        print('QA disc SHA-256:',digest(file))


if __name__=='__main__':
    main()

"""Isolated password/public-key SSH + SFTP fixture; loopback and generated data only."""
import base64
import ctypes
import hashlib
import json
import logging
import os
from pathlib import Path
import socket
import stat
import sys
import threading
import time
import uuid
import paramiko
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, BestAvailableEncryption

logging.getLogger('paramiko').setLevel(logging.CRITICAL)
root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
remote_root = root / 'remote'
remote_root.mkdir(exist_ok=True)
(remote_root / '目录').mkdir(exist_ok=True)
(remote_root / 'large').mkdir(exist_ok=True)
(remote_root / '中文.txt').write_bytes('本地生成的测试内容\n'.encode())
(remote_root / 'slow.bin').write_bytes(b'x' * (8 * 1024 * 1024))
password = 'fixture-' + uuid.uuid4().hex
passphrase = 'fixture-key-' + uuid.uuid4().hex
identity = root / 'fixture-key.pem'
user_key = paramiko.RSAKey.generate(2048)
identity.write_bytes(user_key.key.private_bytes(Encoding.PEM, PrivateFormat.OpenSSH, BestAvailableEncryption(passphrase.encode())))
host_key = paramiko.RSAKey.generate(2048)
fingerprints = []
auth_attempts = 0
transports = []
allow_cleanup = False

def fingerprint(key):
    return 'SHA256:' + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')

def local_path(remote):
    candidate = (remote_root / remote.lstrip('/')).resolve()
    if candidate != remote_root and remote_root not in candidate.parents:
        raise PermissionError('outside fixture')
    return candidate

class Handle(paramiko.SFTPHandle):
    def write(self, offset, data):
        if self.filename.endswith('.part') and len(data) >= 16384:
            time.sleep(0.015)
        return super().write(offset, data)

    def read(self, offset, length):
        if self.filename.endswith('slow.bin'):
            time.sleep(0.035)
        return super().read(offset, length)

class Files(paramiko.SFTPServerInterface):
    def canonicalize(self, path):
        return '/' + local_path(path).relative_to(remote_root).as_posix().lstrip('.')

    def list_folder(self, path):
        try:
            if local_path(path).name == 'large':
                result = []
                for i in range(5010):
                    a = paramiko.SFTPAttributes(); a.filename = f'entry-{i:05}.txt'; a.st_mode = stat.S_IFREG | 0o644; a.st_size = 1; result.append(a)
                return result
            result = []
            for file in local_path(path).iterdir():
                attr = paramiko.SFTPAttributes.from_stat(file.lstat()); attr.filename = file.name; result.append(attr)
            return result
        except OSError as error:
            return paramiko.SFTPServer.convert_errno(error.errno or 13)

    def stat(self, path):
        try: return paramiko.SFTPAttributes.from_stat(local_path(path).stat())
        except OSError as e: return paramiko.SFTPServer.convert_errno(e.errno or 13)

    def lstat(self, path):
        try: return paramiko.SFTPAttributes.from_stat(local_path(path).lstat())
        except OSError as e: return paramiko.SFTPServer.convert_errno(e.errno or 13)

    def mkdir(self, path, attr):
        try: local_path(path).mkdir(); return paramiko.SFTP_OK
        except OSError as e: return paramiko.SFTPServer.convert_errno(e.errno or 13)

    def open(self, path, flags, attr):
        try:
            local = local_path(path)
            fd = os.open(local, flags | getattr(os, 'O_BINARY', 0), 0o600)
            file = os.fdopen(fd, 'r+b' if flags & os.O_RDWR else 'wb' if flags & os.O_WRONLY else 'rb')
            handle = Handle(flags); handle.filename = str(local); handle.readfile = file; handle.writefile = file
            return handle
        except OSError as e: return paramiko.SFTPServer.convert_errno(e.errno or 13)

    def remove(self, path):
        try: local_path(path).unlink(); return paramiko.SFTP_OK
        except OSError as e: return paramiko.SFTPServer.convert_errno(e.errno or 13)

    def rename(self, old, new):
        try:
            destination = local_path(new)
            if destination.exists(): return paramiko.SFTP_FAILURE
            local_path(old).rename(destination); return paramiko.SFTP_OK
        except OSError as e: return paramiko.SFTPServer.convert_errno(e.errno or 13)

class Server(paramiko.ServerInterface):
    def check_auth_password(self, user, value):
        global auth_attempts
        auth_attempts += 1
        return paramiko.AUTH_SUCCESSFUL if user == 'fixture' and value == password else paramiko.AUTH_FAILED

    def check_auth_publickey(self, user, key):
        global auth_attempts
        auth_attempts += 1
        return paramiko.AUTH_SUCCESSFUL if user == 'fixture' and key == user_key else paramiko.AUTH_FAILED

    def get_allowed_auths(self, user): return 'password,publickey'
    def check_channel_request(self, kind, channel_id): return paramiko.OPEN_SUCCEEDED if kind == 'session' else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
    def check_channel_pty_request(self, *args): return True
    def check_channel_window_change_request(self, *args): return True

    def check_channel_shell_request(self, channel):
        def shell():
            try:
                channel.send(b'fixture ready\r\n')
                pending = b''
                while True:
                    data = channel.recv(4096)
                    if not data: break
                    if b'\x03' in data:
                        pending = b''; channel.send(b'^C\r\nfixture interrupted\r\n'); continue
                    pending += data
                    if b'\r' in pending or b'\n' in pending:
                        if pending.strip() == b'exit': channel.send_exit_status(0); break
                        channel.send(b'fixture input: ' + pending + b'\r\n'); pending = b''
            except (OSError, EOFError): pass
            finally: channel.close()
        threading.Thread(target=shell, daemon=True).start(); return True

    def check_channel_exec_request(self, channel, command):
        windows = command.startswith(b'powershell.exe ')
        if windows:
            script = base64.b64decode(command.split()[-1]).decode('utf-16-le')
            if 'Get-CimInstance Win32_OperatingSystem' not in script: return False
        elif b'memoryTotalKiB' not in command: return False
        def output():
            try:
                data = 'hostname\tfixture-host\nos\t' + ('Windows fixture' if windows else 'Linux fixture') + '\nkernel\tfixture\narch\tx64\nuser\tfixture\nuptime\t1 hour\nserverIp\t127.0.0.1\nmemoryTotalKiB\t8388608\nmemoryAvailableKiB\t4194304\ndiskTotalKiB\t104857600\ndiskUsedKiB\t20971520\ndiskAvailableKiB\t83886080\n'
                channel.sendall(data.encode()); channel.send_exit_status(0)
            finally: channel.close()
        threading.Thread(target=output, daemon=True).start(); return True

listener = socket.socket(); listener.bind(('127.0.0.1', 0)); listener.listen(); listener.settimeout(0.3)
port = listener.getsockname()[1]
stop = threading.Event()
def serve(client):
    transport = paramiko.Transport(client); transports.append(transport)
    transport.add_server_key(host_key)
    transport.set_subsystem_handler('sftp', paramiko.SFTPServer, Files)
    try:
        transport.start_server(server=Server())
        while transport.is_active() and not stop.wait(0.1): pass
    except (paramiko.SSHException, OSError, EOFError): pass
    finally: transport.close()

def accept():
    while not stop.is_set():
        try: client, _ = listener.accept(); threading.Thread(target=serve, args=(client,), daemon=True).start()
        except socket.timeout: pass
        except OSError: break

def target(kind, parts):
    hash_value = hashlib.sha256()
    for part in parts:
        data = part.encode(); hash_value.update(len(data).to_bytes(8, 'little')); hash_value.update(data)
    return f'DaliziFiles/SSH/{kind}/' + hash_value.hexdigest()

def cleanup_credentials():
    host_id = target('host', ['127.0.0.1', str(port)])
    delete = ctypes.windll.advapi32.CredDeleteW
    delete.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
    for fp in fingerprints:
        for key_path in ['', str(identity)]:
            delete(target('auth', [host_id, 'fixture', fp, key_path]), 1, 0)
    delete(host_id, 1, 0)

fingerprints.append(fingerprint(host_key))
threading.Thread(target=accept, daemon=True).start()
print(json.dumps(dict(port=port,password=password,passphrase=passphrase,identity=str(identity),root=str(remote_root),fingerprint=fingerprints[-1])),flush=True)
try:
    for line in sys.stdin:
        command = line.strip()
        if command == 'rotate':
            host_key = paramiko.RSAKey.generate(2048); fingerprints.append(fingerprint(host_key))
            print(json.dumps(dict(fingerprint=fingerprints[-1],authAttempts=auth_attempts)),flush=True)
        elif command == 'auth-count': print(json.dumps(dict(authAttempts=auth_attempts)),flush=True)
        elif command == 'allow-cleanup': allow_cleanup = True
        elif command == 'stop': break
finally:
    stop.set(); listener.close()
    for transport in transports: transport.close()
    if allow_cleanup: cleanup_credentials()

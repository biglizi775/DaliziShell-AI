"""Loopback-only SSH fixture for the desktop terminal integration smoke test.

Start with ``python tools/ssh_fixture.py`` and keep stdin open. The first stdout
line describes a fresh test identity and known_hosts file. Closing stdin stops
the listener and all sessions. Nothing executes a local or remote shell.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import paramiko


USER = "fixture"
PROMPT = b"fixture> "
BOOTSTRAP_NONCE = re.compile(rb"DLZ-([0-9a-fA-F]{32})-BEGIN")
FIELDS = (
    "fixture-host",
    "Fixture Linux 1.0",
    "6.1.0-fixture",
    "x86_64",
    USER,
    "up 42 minutes",
    "127.0.0.1",
)


def protect_fixture_identity(path: Path) -> None:
    """Give only the current user access to this freshly generated test key."""
    if sys.platform != "win32":
        path.chmod(0o600)
        return
    # A new descriptor replaces both inherited and explicit grants. Using the
    # current SID avoids localized account names and paths stay out of code.
    script = """
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.FileSecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
[System.IO.File]::SetAccessControl($env:DLZ_FIXTURE_IDENTITY, $acl)
"""
    environment = os.environ.copy()
    environment["DLZ_FIXTURE_IDENTITY"] = str(path)
    powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    subprocess.run(
        [str(powershell), "-NoProfile", "-NonInteractive", "-Command", script],
        env=environment,
        check=True,
        capture_output=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
        timeout=15,
    )


class Session:
    def __init__(self) -> None:
        self.ready = threading.Event()
        self.command = b""
        self.width = 80
        self.height = 24
        self.interactive = False
        self.running = False


class FixtureServer(paramiko.ServerInterface):
    def __init__(self, identity: paramiko.PKey, record) -> None:
        self.identity = identity
        self.record = record
        self.sessions: dict[int, Session] = {}

    def session(self, channel: paramiko.Channel) -> Session:
        return self.sessions.setdefault(channel.get_id(), Session())

    def get_allowed_auths(self, username: str) -> str:
        return "publickey"

    def check_auth_publickey(self, username: str, key: paramiko.PKey) -> int:
        accepted = username == USER and hmac.compare_digest(
            key.asbytes(), self.identity.asbytes()
        )
        self.record("auth", user=username, accepted=accepted)
        return paramiko.AUTH_SUCCESSFUL if accepted else paramiko.AUTH_FAILED

    def check_channel_request(self, kind: str, chanid: int) -> int:
        if kind != "session":
            return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
        return paramiko.OPEN_SUCCEEDED

    def check_channel_pty_request(
        self, channel, term, width, height, pixelwidth, pixelheight, modes
    ) -> bool:
        session = self.session(channel)
        session.width, session.height = width, height
        self.record("pty", channel=channel.get_id(), cols=width, rows=height)
        return True

    def check_channel_shell_request(self, channel) -> bool:
        self.session(channel).ready.set()
        self.record("shell", channel=channel.get_id())
        return True

    def check_channel_exec_request(self, channel, command: bytes) -> bool:
        session = self.session(channel)
        session.command = command
        session.ready.set()
        self.record("exec", channel=channel.get_id(), bootstrap=bool(BOOTSTRAP_NONCE.search(command)))
        return True

    def check_channel_window_change_request(
        self, channel, width, height, pixelwidth, pixelheight
    ) -> bool:
        session = self.session(channel)
        session.width, session.height = width, height
        self.record("window-change", channel=channel.get_id(), cols=width, rows=height)
        if not session.interactive:
            return True
        try:
            channel.sendall(f"\r\nFIXTURE RESIZE {width}x{height}\r\n".encode())
        except (EOFError, OSError):
            pass
        return True


def serve_channel(channel, server: FixtureServer, stopping: threading.Event) -> None:
    session = server.session(channel)
    try:
        while not stopping.is_set():
            if session.ready.wait(0.2):
                break
            if channel.closed:
                return
        if stopping.is_set():
            return
        match = BOOTSTRAP_NONCE.search(session.command)
        previous_cr = False
        channel.settimeout(0.2)
        if match:
            nonce = match.group(1)
            frame = b";".join(value.encode("utf-8").hex().encode("ascii") for value in FIELDS)
            channel.sendall(b"\x1b]2;DLZ-" + nonce + b"-BEGIN" + frame + b"DLZ-" + nonce + b"-END\x07\r\n")
            server.record("metadata", channel=channel.get_id(), nonce=nonce.decode("ascii"))
            deadline = time.monotonic() + 10
            expected = b"DLZ-" + nonce + b"-ACK"
            ack_line = bytearray()
            oversized = False
            acknowledged = False
            while not stopping.is_set() and time.monotonic() < deadline:
                try:
                    byte = channel.recv(1)
                except socket.timeout:
                    continue
                if not byte:
                    return
                if byte in (b"\r", b"\n"):
                    if not oversized and ack_line == expected:
                        acknowledged = True
                        previous_cr = byte == b"\r"
                        break
                    ack_line.clear()
                    oversized = False
                elif len(ack_line) < len(expected):
                    ack_line.extend(byte)
                else:
                    oversized = True
            if not acknowledged:
                server.record("metadata-ack-timeout", channel=channel.get_id())
                channel.send_exit_status(1)
                return
            server.record("metadata-ack", channel=channel.get_id(), nonce=nonce.decode("ascii"))
        session.interactive = True
        channel.sendall(b"\x1b]0;fixture-host - fixture shell\x07")
        channel.sendall(
            f"FIXTURE READY {session.width}x{session.height}\r\n".encode() + PROMPT
        )
        pending = bytearray()
        while not stopping.is_set() and not channel.closed:
            try:
                data = channel.recv(4096)
            except socket.timeout:
                continue
            if not data:
                break
            for byte in data:
                if byte == 3:
                    pending.clear()
                    previous_cr = False
                    was_running = session.running
                    session.running = False
                    server.record("interrupt", channel=channel.get_id(), running=was_running)
                    channel.sendall(b"^C\r\nFIXTURE INTERRUPTED\r\n" + PROMPT)
                    continue
                if session.running:
                    # Simulate a foreground command that waits indefinitely
                    # for Ctrl+C, without executing any local or remote shell.
                    continue
                if byte == 10 and previous_cr:
                    previous_cr = False
                    continue
                previous_cr = byte == 13
                if byte in (10, 13):
                    line = pending.decode("utf-8", errors="replace").strip()
                    pending.clear()
                    server.record("input", channel=channel.get_id(), text=line)
                    channel.sendall(b"\r\n")
                    if line == "exit" or line == "exit 7":
                        channel.sendall(b"FIXTURE EXIT 7\r\n")
                        channel.send_exit_status(7)
                        return
                    if line == "wait":
                        session.running = True
                        server.record("running", channel=channel.get_id())
                        channel.sendall(b"FIXTURE RUNNING\r\n")
                        continue
                    if line == "drop":
                        server.record("remote-drop", channel=channel.get_id())
                        channel.sendall(b"FIXTURE DROP\r\n")
                        channel.get_transport().close()
                        return
                    if line == "status":
                        channel.sendall(b"FIXTURE STATUS READY\r\n")
                    elif line.startswith("echo "):
                        token = line[5:].strip()
                        if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'":
                            token = token[1:-1]
                        channel.sendall(token.encode("utf-8") + b"\r\n")
                    elif line:
                        channel.sendall(b"fixture: supported commands are echo, status, wait, drop, and exit\r\n")
                    channel.sendall(PROMPT)
                elif byte in (8, 127):
                    if pending:
                        pending.pop()
                        channel.sendall(b"\b \b")
                elif len(pending) < 8192:
                    pending.append(byte)
                    channel.sendall(bytes((byte,)))
    except (EOFError, OSError):
        pass
    finally:
        channel.close()


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "src-tauri" / "target" / "ssh-smoke"
    run_dir = output / ("fixture-" + uuid.uuid4().hex)
    run_dir.mkdir(parents=True, exist_ok=False)
    host_key = paramiko.ECDSAKey.generate()
    client_key = paramiko.ECDSAKey.generate()
    identity_file = run_dir / "client-key"
    host_key.write_private_key_file(str(run_dir / "host-key"))
    client_key.write_private_key_file(str(identity_file))
    protect_fixture_identity(identity_file)
    log_path = run_dir / "events.jsonl"
    record_lock = threading.Lock()

    def record(event: str, **fields) -> None:
        with record_lock:
            with log_path.open("a", encoding="utf-8") as output_file:
                output_file.write(json.dumps({"event": event, **fields}, ensure_ascii=False) + "\n")

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(4)
    listener.settimeout(0.2)
    port = listener.getsockname()[1]
    known_hosts = run_dir / "known_hosts"
    known_hosts.write_text(
        f"[127.0.0.1]:{port} {host_key.get_name()} {host_key.get_base64()}\n",
        encoding="ascii",
    )
    stopping = threading.Event()
    transports: set[paramiko.Transport] = set()
    transport_lock = threading.Lock()

    def connection(client: socket.socket) -> None:
        transport = paramiko.Transport(client)
        with transport_lock:
            transports.add(transport)
        try:
            transport.add_server_key(host_key)
            server = FixtureServer(client_key, record)
            transport.start_server(server=server)
            while not stopping.is_set() and transport.is_active():
                channel = transport.accept(0.2)
                if channel is not None:
                    threading.Thread(target=serve_channel, args=(channel, server, stopping), daemon=True).start()
        except (EOFError, OSError, paramiko.SSHException) as error:
            record("connection-error", message=str(error))
        finally:
            transport.close()
            with transport_lock:
                transports.discard(transport)

    def accept_connections() -> None:
        while not stopping.is_set():
            try:
                client, address = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            record("connection", peer=address[0])
            threading.Thread(target=connection, args=(client,), daemon=True).start()

    worker = threading.Thread(target=accept_connections, daemon=True)
    worker.start()
    print(json.dumps({"port": port, "user": USER, "identityFile": str(identity_file), "knownHosts": str(known_hosts)}), flush=True)
    try:
        sys.stdin.buffer.read()
    except KeyboardInterrupt:
        pass
    finally:
        stopping.set()
        listener.close()
        with transport_lock:
            for transport in list(transports):
                transport.close()
        worker.join(timeout=1)


if __name__ == "__main__":
    main()

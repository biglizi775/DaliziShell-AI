"""Identify the Windows desktop target from the executable being packaged."""
import struct

TARGETS = {"x64": "x86_64-pc-windows-msvc", "x86": "i686-pc-windows-msvc"}


def executable_architecture(path):
    with path.open("rb") as stream:
        header = stream.read(64)
        if len(header) != 64 or header[:2] != b"MZ":
            raise ValueError("Invalid executable header")
        stream.seek(struct.unpack_from("<I", header, 60)[0])
        signature = stream.read(6)
    if len(signature) != 6 or signature[:4] != b"PE\0\0":
        raise ValueError("Invalid PE signature")
    machine = int.from_bytes(signature[4:], "little")
    if machine == 0x14C:
        return "x86"
    if machine == 0x8664:
        return "x64"
    raise ValueError(f"Unsupported Windows executable machine 0x{machine:04x}")

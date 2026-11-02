"""Generate src-tauri/icons/icon.ico (Win11-style folder) without external deps."""
import struct, zlib, os

TAB = (232, 163, 61)          # darker amber tab
BODY_TOP = (255, 210, 128)    # body gradient top
BODY_BOT = (242, 176, 52)     # body gradient bottom


def inside_rr(u, v, x0, y0, x1, y1, r):
    if u < x0 or u > x1 or v < y0 or v > y1:
        return False
    cx = min(max(u, x0 + r), x1 - r)
    cy = min(max(v, y0 + r), y1 - r)
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r


def draw(size):
    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    s = size - 1 or 1
    for y in range(size):
        v = y / s * 255
        for x in range(size):
            u = x / s * 255
            if inside_rr(u, v, 8, 52, 122, 88, 10):
                px[y][x] = TAB + (255,)
            elif inside_rr(u, v, 8, 78, 248, 224, 20):
                k = max(0.0, min(1.0, (v - 78) / 146))
                c = tuple(round(BODY_TOP[i] + (BODY_BOT[i] - BODY_TOP[i]) * k) for i in range(3))
                px[y][x] = c + (255,)
    return px


def png(size, px):
    raw = b"".join(b"\x00" + b"".join(bytes(p) for p in row) for row in px)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def bmp_entry(size, px):
    rows = []
    for y in range(size - 1, -1, -1):
        rows.append(b"".join(bytes((px[y][x][2], px[y][x][1], px[y][x][0], px[y][x][3]))
                             for x in range(size)))
    mask = b"\x00" * (((size + 31) // 32 * 4) * size)
    hdr = struct.pack("<IiiHHIIiiII", 40, size, size, 1, 32, 0, 0, 0, 0, 0, 0)
    return hdr + b"".join(rows) + mask


def ico(images):
    out = struct.pack("<HHH", 0, 1, len(images))
    off = 6 + 16 * len(images)
    body = b""
    for (s, d) in images:
        out += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(d), off)
        body += d
        off += len(d)
    return out + body


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    icons = os.path.normpath(os.path.join(here, "..", "src-tauri", "icons"))
    os.makedirs(icons, exist_ok=True)
    big = draw(256)
    with open(os.path.join(icons, "icon.png"), "wb") as f:
        f.write(png(256, big))
    images = [(s, bmp_entry(s, draw(s))) for s in (16, 24, 32, 48)]
    images.append((256, png(256, big)))
    with open(os.path.join(icons, "icon.ico"), "wb") as f:
        f.write(ico(images))
    print("icon written to", icons)

#!/usr/bin/env python3
"""Draw dependency-free PNG icons for iOS and Android home screens."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INK = (23, 61, 69)
PAPER = (255, 253, 248)
ACCENT = (221, 121, 78)
GLYPHS = {
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '11100'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
}


def draw(size):
    pixels = bytearray(size * size * 3)

    def rect(x0, y0, x1, y1, color):
        for y in range(max(0, y0), min(size, y1)):
            for x in range(max(0, x0), min(size, x1)):
                pos = (y * size + x) * 3
                pixels[pos:pos + 3] = bytes(color)

    rect(0, 0, size, size, INK)
    margin = round(size * .14)
    rect(margin, margin, size - margin, size - margin, PAPER)
    line = max(2, round(size * .025))
    third = (size - 2 * margin) / 3
    for n in (1, 2):
        at = round(margin + n * third)
        rect(at - line // 2, margin, at + (line + 1) // 2, size - margin, INK)
        rect(margin, at - line // 2, size - margin, at + (line + 1) // 2, INK)
    scale = max(2, round(size * .025))
    for digit, row, col, color in [('1', 0, 0, INK), ('9', 1, 1, ACCENT), ('4', 2, 2, INK)]:
        glyph = GLYPHS[digit]
        x0 = round(margin + col * third + (third - 5 * scale) / 2)
        y0 = round(margin + row * third + (third - 7 * scale) / 2)
        for gy, bits in enumerate(glyph):
            for gx, bit in enumerate(bits):
                if bit == '1':
                    rect(x0 + gx * scale, y0 + gy * scale, x0 + (gx + 1) * scale, y0 + (gy + 1) * scale, color)
    rows = b''.join(b'\x00' + pixels[y * size * 3:(y + 1) * size * 3] for y in range(size))

    def chunk(tag, payload):
        return struct.pack('!I', len(payload)) + tag + payload + struct.pack('!I', zlib.crc32(tag + payload) & 0xffffffff)

    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')


for size in (180, 192, 512):
    (ROOT / f'icon-{size}.png').write_bytes(draw(size))

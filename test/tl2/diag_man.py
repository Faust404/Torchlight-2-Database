# -*- coding: utf-8 -*-
"""Walk the MAN with a fixed tail and show exactly where and why it breaks.

The successful prefix is the useful part: it says how far the fixed-stride
assumption holds, and the bytes at the break say what the real field is.

Usage: python diag_man.py [start] [tail]
"""
import io, struct, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

MAN = (r'E:\Games\Steam\steamapps\common\Torchlight II'
       r'\PAKS\DATA.PAK.MAN')
data = open(MAN, 'rb').read()
N = len(data)

start = int(sys.argv[1]) if len(sys.argv) > 1 else 51
tail = int(sys.argv[2]) if len(sys.argv) > 2 else 21


def name_at(o):
    if o + 2 > N:
        return None
    n, = struct.unpack_from('<H', data, o)
    if n == 0 or n > 300 or o + 2 + n * 2 > N:
        return None
    body = data[o + 2:o + 2 + n * 2]
    for i in range(0, len(body), 2):
        lo, hi = body[i], body[i + 1]
        if hi != 0 or not (0x20 <= lo <= 0x7e):
            return None
    return body.decode('utf-16-le')


o = start
k = 0
last = []
while True:
    s = name_at(o)
    if s is None:
        break
    last.append((o, s))
    o += 2 + len(s) * 2 + tail
    k += 1

print('walk from %d, tail %d: %d records, stopped at offset %d of %d (%.1f%%)'
      % (start, tail, k, o, N, 100.0 * o / N))
print('\nlast 5 records before the break:')
for off, s in last[-5:]:
    print('   %8d  %s' % (off, s))

lo = max(0, o - 16)
print('\nbytes around the break (%d..%d):' % (lo, lo + 96))
print('   ' + data[lo:lo + 96].hex(' '))
print('\nas cu16le: %r' % data[lo:lo + 96].decode('utf-16-le', 'replace'))

# what does the break offset look like if read as a fresh record?
print('\nread at break offset as a name: %r' % name_at(o))
n, = struct.unpack_from('<H', data, o)
print('   u16 there = %d' % n)

# -*- coding: utf-8 -*-
"""Fit the DATA.PAK.MAN record walk and report what the archive holds.

Each record is [u16 charlen][UTF-16LE name][tail]. The tail is not constant --
directory entries carry fewer fields than file entries -- so a fixed-stride
walk dies partway. This does a depth-first walk that tries a small set of tail
sizes at each record and keeps the path that lands exactly on EOF, which is
self-validating: a wrong tail cannot reach the end.

Usage: python fit_man_layout.py [--dump out.txt]
"""
import io, struct, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

MAN = (r'E:\Games\Steam\steamapps\common\Torchlight II'
       r'\PAKS\DATA.PAK.MAN')

data = open(MAN, 'rb').read()
N = len(data)

# directory entries appear to carry 9 bytes of tail, file entries 21
TAILS = (21, 9, 8, 13, 17, 25, 29, 33)


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


# Where do records begin? The candidates at 6 and 28 are the two "MEDIA/"
# entries; the header is whatever precedes the first one.
starts = [o for o in range(0, 32) if name_at(o)]

# Depth-first walk to EOF. Memoise failures so the branching stays cheap.
bad = set()
path = []


def walk(o):
    if o == N:
        return True
    if o > N or o in bad:
        return False
    s = name_at(o)
    if s is None:
        bad.add(o)
        return False
    base = o + 2 + len(s) * 2
    for t in TAILS:
        nxt = base + t
        if nxt > N:
            continue
        path.append((o, s, t))
        if walk(nxt):
            return True
        path.pop()
    bad.add(o)
    return False


for start in starts[:4]:
    del path[:]
    bad.clear()
    ok = walk(start)
    print('start %-3d -> %s' % (start, 'reached EOF, %d records' % len(path) if ok else 'no walk'))
    if ok:
        break
else:
    print('no walk to EOF; falling back to a partial walk')
    print('the record list is still readable as names -- see --dump')
    sys.exit(1)

print('header: %s' % data[:start].hex(' '))
print('tail sizes seen: %s'
      % {t: sum(1 for _, _, tt in path if tt == t) for t in TAILS})

if '--dump' in sys.argv:
    out = sys.argv[sys.argv.index('--dump') + 1]
    with open(out, 'w', encoding='utf-8') as f:
        for o, s, t in path:
            f.write('%d\t%d\t%s\n' % (o, t, s))
    print('wrote %s' % out)

print('\nfirst 20 records:')
for o, s, t in path[:20]:
    print('   %8d tail=%-3d %s' % (o, t, s))

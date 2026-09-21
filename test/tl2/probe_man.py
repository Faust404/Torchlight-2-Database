# -*- coding: utf-8 -*-
"""Derive the DATA.PAK.MAN record layout from the file itself.

Rather than guessing a record size and failing when it is wrong, this finds
every offset that plausibly holds a length-prefixed UTF-16LE ASCII name and
looks at the gaps between consecutive ones. If the record tail is a constant
size, that shows up as one dominant gap.

Usage: python probe_man.py
"""
import io, os, struct, sys, collections

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
# Anchored to this file rather than to the caller's directory: these were
# written to be run from the folder they lived in, and that folder has moved.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', '..', 'src'))
import paths


MAN = paths.MAN

data = open(MAN, 'rb').read()
N = len(data)


def name_at(o):
    """The UTF-16LE ASCII name starting at o, if one plausibly does."""
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


# Every offset that could be the length prefix of a name. Restricting to names
# that look like paths (a '.' or '/') cuts the false positives a lot.
hits = []
for o in range(0, N - 2):
    s = name_at(o)
    if s is not None and ('.' in s or '/' in s) and len(s) >= 4:
        hits.append((o, s))

print('candidate name positions: %d' % len(hits))
print('\nfirst 12 candidates (offset, gap from previous, name):')
prev = None
for o, s in hits[:12]:
    gap = '' if prev is None else str(o - prev)
    print('   %8d  gap=%-6s %s' % (o, gap, s))
    prev = o

gaps = collections.Counter(b - a for (a, _), (b, _) in zip(hits, hits[1:]))
print('\nmost common gaps between consecutive candidates:')
for g, c in gaps.most_common(10):
    print('   gap %-6d  x%d' % (g, c))

# The real records should be a walk from a fixed start where every step is the
# same gap. Look for the start offset that produces the longest such run.
best = None
for start_o, start_s in hits[:50]:
    for g, _ in gaps.most_common(6):
        o, k = start_o, 0
        while True:
            s = name_at(o)
            if s is None:
                break
            k += 1
            o += 2 + len(s) * 2 + g
        if best is None or k > best[0]:
            best = (k, start_o, start_s, g)

print('\nlongest constant-gap walk: %d records, start %d (%r), gap %d'
      % (best[0], best[1], best[2], best[3]))

k, start_o, start_s, g = best
o = start_o
print('\nfirst 8 records of that walk -- the gap bytes are the payload:')
for _ in range(8):
    s = name_at(o)
    pay = data[o + 2 + len(s) * 2:o + 2 + len(s) * 2 + g]
    print('   %-30s %s' % (s, pay.hex(' ')))
    o += 2 + len(s) * 2 + g
print('\n   header before start %d: %s' % (start_o, data[:start_o].hex(' ')))
print('   final offset %d vs file size %d (tail %d bytes)'
      % (o, N, N - o))

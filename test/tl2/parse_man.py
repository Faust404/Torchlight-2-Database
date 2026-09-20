# -*- coding: utf-8 -*-
"""Parse DATA.PAK.MAN into (path, offset, size) using the PAK as a validator.

Each record is [u16 charlen][UTF-16LE name][tail]. File records carry a 21-byte
tail holding (offset, uncompressed_size); directory records carry a shorter
one. The tail length is not constant, so a naive fixed-stride walk derails at
the first directory boundary.

What rescues it: a file record is *verifiable*. Its offset must land on a PAK
entry whose stored uncompressed size matches -- the PAK entry at `offset` is
[u32 unc][u32 comp][zlib]. So the walk is a search whose branches are pruned
by the archive itself, and a wrong tail cannot survive.

Names are stored relative to the directory being listed; the walk tracks the
path so each record gets a full path.

Usage: python parse_man.py [--dump index.tsv]
"""
import io, mmap, struct, sys, zlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

TL2 = r'E:\Games\Steam\steamapps\common\Torchlight II'
MAN = TL2 + r'\PAKS\DATA.PAK.MAN'
PAK = TL2 + r'\PAKS\DATA.PAK'

man = open(MAN, 'rb').read()
NM = len(man)

_pf = open(PAK, 'rb')
pak = mmap.mmap(_pf.fileno(), 0, access=mmap.ACCESS_READ)
NP = len(pak)
print('manifest %d bytes, pak %d bytes' % (NM, NP))

# ---- name decoding ---------------------------------------------------------
_nm = {}


def name_at(o):
    if o in _nm:
        return _nm[o]
    r = None
    if o + 2 <= NM:
        n, = struct.unpack_from('<H', man, o)
        if 0 < n <= 300 and o + 2 + n * 2 <= NM:
            b = man[o + 2:o + 2 + n * 2]
            ok = all(b[i + 1] == 0 and 0x20 <= b[i] <= 0x7e
                     for i in range(0, len(b), 2))
            if ok:
                r = b.decode('utf-16-le')
    _nm[o] = r
    return r


# ---- PAK validation --------------------------------------------------------
_pk = {}


def pak_ok(off, unc):
    """Is there a PAK entry at `off` whose uncompressed size is `unc`?"""
    k = (off, unc)
    if k in _pk:
        return _pk[k]
    r = False
    if off + 8 <= NP:
        u, c = struct.unpack_from('<II', pak, off)
        if u == unc and unc > 0:
            if c == 0:
                r = off + 8 + unc <= NP          # stored raw
            elif off + 8 + c <= NP:
                try:
                    d = zlib.decompressobj()
                    out = d.decompress(pak[off + 8:off + 8 + c])
                    r = d.eof and len(out) == unc
                except zlib.error:
                    r = False
    _pk[k] = r
    return r


# ---- walk ------------------------------------------------------------------
# 21 for file records; the short ones show up at directory boundaries
TAILS = (21, 9, 16, 13, 17, 20, 25, 8, 12)


def candidates(base):
    """Plausible (priority, next_offset) continuations after this name.

    Priority 0 means a file record confirmed against the PAK -- proof, not a
    guess. Priority 1 is a directory record, where the only evidence is that
    another readable name follows. Confirmed continuations are tried first.
    """
    out = []
    for rank, t in enumerate(TAILS):
        nxt = base + t
        if nxt > NM:
            continue
        if t == 21:
            off, unc = struct.unpack_from('<II', man, base)
            if pak_ok(off, unc):
                out.append((0, rank, nxt))
                continue
        if nxt == NM or name_at(nxt) is not None:
            out.append((1, rank, nxt))
    out.sort()
    return [(nxt) for _, _, nxt in out]


start = 6 if name_at(6) else 0
print('walk starts at %d (%r)' % (start, name_at(start)))
print('header: %s' % man[:start].hex(' '))

parent = {start: None}
stack = [start]
end = None
while stack:
    o = stack.pop()
    if o == NM:
        end = o
        break
    s = name_at(o)
    if s is None:
        continue
    base = o + 2 + len(s) * 2
    # push in reverse so the best candidate is popped first
    for nxt in reversed(candidates(base)):
        if nxt in parent:
            continue
        parent[nxt] = (o, nxt - base)
        stack.append(nxt)

if end is None:
    print('!! no walk reached EOF; deepest reach %d of %d'
          % (max(parent), NM))
    sys.exit(1)

path = []
o = end
while parent[o] is not None:
    p, t = parent[o]
    path.append((p, name_at(p), t))
    o = p
path.reverse()
print('walk reached EOF: %d records' % len(path))

# ---- stamp full paths ------------------------------------------------------
# Names are relative to the directory being listed. A directory appears twice:
# once by short name inside its parent's child list, and again by FULL path
# where the walk actually descends into it. That second form is what fixes the
# current directory, so the stack is realigned to the new path's parent.
recs = []          # (offset, full_path, tail, is_dir, pak_offset, unc)

# The first record names the archive root; the record after it re-states that
# same root as the descent marker for its own children.
ROOT = path[0][1] if path[0][1].endswith('/') else None
stack = [ROOT] if ROOT else []
print('archive root: %r' % ROOT)

for off, nm, t in path[(1 if ROOT else 0):]:
    isdir = nm.endswith('/')
    if isdir:
        body = nm.rstrip('/')
        if stack and nm == stack[-1]:
            full = nm                       # re-stated current directory
        elif '/' in body:
            # descent marker: a full path, so pop back to its parent
            parent = body.rsplit('/', 1)[0] + '/'
            while len(stack) > 1 and stack[-1] != parent:
                stack.pop()
            full = nm
            stack.append(full)
        else:
            full = stack[-1] + nm           # a child directory, listed
        recs.append((off, full, t, True, None, None))
    else:
        full = stack[-1] + nm
        po, unc = struct.unpack_from('<II', man, off + 2 + len(nm) * 2)
        recs.append((off, full, t, False, po, unc))

files = [r for r in recs if not r[3]]
print('%d directories, %d files' % (len(recs) - len(files), len(files)))

if '--dump' in sys.argv:
    out = sys.argv[sys.argv.index('--dump') + 1]
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write('pak_offset\tunc\tpath\n')
        for off, full, t, isdir, po, unc in files:
            fh.write('%d\t%d\t%s\n' % (po, unc, full))
    print('wrote %s' % out)

print('\nfirst 12 files:')
for off, full, t, isdir, po, unc in files[:12]:
    print('   %-52s off=%-10d unc=%d' % (full, po, unc))

print('\nlast 6 files:')
for off, full, t, isdir, po, unc in files[-6:]:
    print('   %-52s off=%-10d unc=%d' % (full, po, unc))

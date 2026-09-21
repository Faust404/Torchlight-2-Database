# -*- coding: utf-8 -*-
"""Throwaway: decode the AFFIXES list layout and the stray word before it.

For an AFFIXES record at index i the bytes are

    [AFFIXES][3]  [AFFIX][type][value] * N  [0]

so the question is what u[i-1] is, and whether u[i-1] tracks N.
"""
import os, struct, io, sys, zlib, mmap, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
# Anchored to this file rather than to the caller's directory: these were
# written to be run from the folder they lived in, and that folder has moved.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', '..', 'src'))
import paths

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', '..', 'src', 'tl2'))   # dat_hash lives in src/tl2 now
from dat_hash import dek

idx = {}
with open(paths.TL2_INDEX, encoding='utf-8') as fh:
    next(fh)
    for line in fh:
        o, u, p = line.rstrip('\n').split('\t'); idx[p] = (int(o), int(u))
pf = open(paths.PAK, 'rb'); pak = mmap.mmap(pf.fileno(), 0, access=mmap.ACCESS_READ)

def read(p):
    off, unc = idx[p]; u, c = struct.unpack_from('<II', pak, off)
    if c == 0: return bytes(pak[off+8:off+8+unc])
    return zlib.decompressobj().decompress(pak[off+8:off+8+unc])

AFFIXES, AFFIX = dek('AFFIXES'), dek('AFFIX')
pair = collections.Counter(); before = collections.Counter(); ok = bad = 0
samples = []
files = sorted(p for p in idx if p.startswith('MEDIA/UNITS/ITEMS/') and p.endswith('.DAT'))
for p in files[:1500]:
    b = read(p)
    if len(b) < 24: continue
    ver, cnt = struct.unpack_from('<II', b, 0)
    o = 8
    for i in range(cnt):
        t, = struct.unpack_from('<I', b, o); ln, = struct.unpack_from('<H', b, o+4)
        o += 6 + ln*2
    bin_ = b[o:]; n = len(bin_)//4
    if n < 8: continue
    u = struct.unpack('<%dI' % n, bin_[:n*4])
    for i in range(2, n-2):
        if u[i] == AFFIXES and u[i+1] == 3:
            j = i+2; k = 0
            while j+2 < n and u[j] == AFFIX:
                k += 1; j += 3
            term = u[j] if j < n else None
            if term == 0: ok += 1
            else: bad += 1
            pair[(u[i-1], k)] += 1
            before[u[i-1]] += 1
            if len(samples) < 8:
                samples.append((p.rsplit('/',1)[-1], u[i-1], k, hex(u[i-2]), hex(u[i-3]), term))
print('well-formed (0-terminated) lists: %d   malformed: %d' % (ok, bad))
print()
print('(u[i-1], n_entries) -> files:')
for k, c in pair.most_common(20): print('   %-14s x%d' % (k, c))
print()
print('u[i-1] distribution:', before.most_common(8))
print()
print('samples (file, u[i-1], n_entries, u[i-2], u[i-3], terminator):')
for s in samples: print('   ', s)

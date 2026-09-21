# -*- coding: utf-8 -*-
"""Index every entry in Torchlight II's DATA.PAK.

Layout, once the misalignment is out of the way:

    offset 0       8-byte archive header
    then, repeated:
        u32 uncompressed_size
        u32 compressed_size
        zlib stream, compressed_size bytes

The size is stored explicitly, so the entries chain without decompressing
anything -- decompression is only needed to trust the sizes, which this does
on a sample.

Usage: python scan_pak_blocks.py [--dump blocks.tsv] [--verify N]
"""
import io, os, mmap, random, struct, sys, zlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
# Anchored to this file rather than to the caller's directory: these were
# written to be run from the folder they lived in, and that folder has moved.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', '..', 'src'))
import paths


PAK = paths.PAK

f = open(PAK, 'rb')
mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
N = len(mm)
print('%s: %d bytes' % (PAK, N))
print('archive header: %s' % mm[:8].hex(' '))

entries = []          # (offset, uncompressed, stored, compressed?)
off = 8
stored = 0
while off + 8 <= N:
    unc, comp = struct.unpack_from('<II', mm, off)
    # comp == 0 means the file is stored raw and occupies unc bytes; otherwise
    # it is a zlib stream of comp bytes expanding to unc
    size = comp if comp else unc
    if size == 0 or off + 8 + size > N:
        print('!! bad entry at %d (unc=%d comp=%d) -- stopping' % (off, unc, comp))
        break
    entries.append((off, unc, size, bool(comp)))
    if not comp:
        stored += 1
    off += 8 + size

print('%d entries (%d stored raw, %d zlib), walk ended at %d of %d (%s)'
      % (len(entries), stored, len(entries) - stored, off, N,
         'exact' if off == N else 'MISALIGNED'))

# The manifest gives (offset, uncompressed_size) pairs for a few files we read
# by hand; if the walk is right those offsets are all entry starts.
KNOWN = {1321565: 4575, 1323006: 213, 1434909: 27990,
         1438007: 125382, 1456783: 11114, 1460447: 53952}
starts = {o: u for o, u, _, _ in entries}
print('\ncross-check against six manifest offsets:')
for o, u in sorted(KNOWN.items()):
    got = starts.get(o)
    print('   %-9d expect unc=%-8d %s' % (o, u, 'ok' if got == u else 'got %s' % got))

if '--verify' in sys.argv:
    k = int(sys.argv[sys.argv.index('--verify') + 1])
    random.seed(1)
    print('\ndecompressing %d random entries:' % k)
    bad = 0
    for o, unc, size, is_z in random.sample(entries, k):
        if not is_z:
            continue
        d = zlib.decompressobj()
        out = d.decompress(mm[o + 8:o + 8 + size])
        if not d.eof or len(out) != unc:
            bad += 1
            print('   MISMATCH at %d: got %d want %d' % (o, len(out), unc))
    print('   %d of %d mismatched' % (bad, k))

if '--dump' in sys.argv:
    out = sys.argv[sys.argv.index('--dump') + 1]
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write('offset\tunc\tcomp\n')
        for o, u, c in entries:
            fh.write('%d\t%d\t%d\n' % (o, u, c))
    print('\nwrote %s' % out)

print('\nfirst 5 entries:')
for o, u, sz, is_z in entries[:5]:
    print('   off=%-10d unc=%-8d stored=%-8d %s' % (o, u, sz, 'zlib' if is_z else 'raw'))

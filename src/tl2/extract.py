# -*- coding: utf-8 -*-
"""Extract files from DATA.PAK by path, using the index parse_man.py built.

Usage: python extract.py <path-in-pak> [outdir]
       python extract.py --grep <substring>      # list matching paths
"""
import io, mmap, os, struct, sys, zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import paths

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PAK = paths.PAK
INDEX = paths.PAK_INDEX


def load_index():
    idx = {}
    with open(INDEX, encoding='utf-8') as fh:
        next(fh)
        for line in fh:
            o, u, p = line.rstrip('\n').split('\t')
            idx[p] = (int(o), int(u))
    return idx


def read(pak, off, unc):
    u, c = struct.unpack_from('<II', pak, off)
    if c == 0:
        return bytes(pak[off + 8:off + 8 + unc])
    d = zlib.decompressobj()
    out = d.decompress(pak[off + 8:off + 8 + c])
    assert d.eof and len(out) == unc, 'entry %d did not decompress cleanly' % off
    return out


def main():
    if '--grep' in sys.argv:
        pat = sys.argv[sys.argv.index('--grep') + 1].upper()
        for p in sorted(load_index()):
            if pat in p.upper():
                print(p)
        return

    path = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else '.'
    idx = load_index()
    if path not in idx:
        print('not in index: %s' % path)
        sys.exit(1)
    off, unc = idx[path]
    with open(PAK, 'rb') as fh:
        pak = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
        blob = read(pak, off, unc)
    dest = os.path.join(outdir, os.path.basename(path))
    with open(dest, 'wb') as fh:
        fh.write(blob)
    print('%s -> %s (%d bytes)' % (path, dest, len(blob)))


if __name__ == '__main__':
    main()

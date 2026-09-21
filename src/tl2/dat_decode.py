# -*- coding: utf-8 -*-
"""Decode a Torchlight II .DAT: header, string block, and the binary field list.

Container
---------
    u32 version
    u32 string_count
    u32 (unused)
    string_count records of:  u32 id   u16 charlen   charlen*2 bytes UTF-16LE
    binary section

Binary section
--------------
A stream of

    u32 field_hash      DEK hash of the field's UPPERCASE name  (see dat_hash)
    u32 type            1=INTEGER 2=FLOAT 3=list 5=STRING 8=TRANSLATE
    u32 value           INTEGER/FLOAT: literal; STRING/TRANSLATE: string id
                        list: followed by entries, terminated by a zero word

List entries repeat the same shape, each naming its own element field:

    [hash][3]  ([element_hash][type][value]) * N  [0]

so both the list field and each of its members carry a readable name.

Usage:
    python dat_decode.py <file.dat|path/in/pak> [--raw] [--strings]
"""
import io, mmap, os, struct, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)                        # dat_hash, this package's sibling
sys.path.insert(0, os.path.dirname(HERE))       # paths.py, one level up in src/
import paths
from dat_hash import dek, FIELDS, TYPE_NAMES

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:      # <3.7, or a stream that isn't a TextIOWrapper
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# The game install, and the index beside this file. Both were literals here and
# in eight other scripts; paths.py is now the one place either is spelled.
PAK = paths.PAK


# The index and the PAK mapping are process-wide singletons. Building them per
# call cost a 5 MB index parse plus an mmap of the 869 MB archive, which is
# fine for one file from the CLI and pathological for a batch over all 6,262
# item DATs (it ran past 120 s; with the cache the same pass takes seconds).
_INDEX = None
_PAK = None
_PAK_FH = None


def pak_index():
    """{path: (offset, uncompressed_size)} for every file in DATA.PAK."""
    global _INDEX
    if _INDEX is None:
        idx = {}
        with open(paths.TL2_INDEX, encoding='utf-8') as fh:
            next(fh)
            for line in fh:
                o, u, p = line.rstrip('\n').split('\t')
                idx[p] = (int(o), int(u))
        _INDEX = idx
    return _INDEX


def _pak():
    global _PAK, _PAK_FH
    if _PAK is None:
        _PAK_FH = open(paths.require_pak(), 'rb')
        _PAK = mmap.mmap(_PAK_FH.fileno(), 0, access=mmap.ACCESS_READ)
    return _PAK


def read_pak_entry(path):
    off, unc = pak_index()[path]
    pak = _pak()
    u, c = struct.unpack_from('<II', pak, off)
    if c == 0:
        return bytes(pak[off + 8:off + 8 + unc])
    d = zlib.decompressobj()
    out = d.decompress(pak[off + 8:off + 8 + c])
    assert d.eof and len(out) == unc
    return out


def parse_strings(b):
    ver, cnt = struct.unpack_from('<II', b, 0)
    o, strs = 8, []
    for _ in range(cnt):
        t, = struct.unpack_from('<I', b, o)
        ln, = struct.unpack_from('<H', b, o + 4)
        strs.append((t, b[o + 6:o + 6 + ln * 2].decode('utf-16-le')))
        o += 6 + ln * 2
    return ver, cnt, strs, o


def field_name(h):
    return FIELDS.get(h, '0x%08X' % h)


def decode(b):
    """Yield (indent, name, typename, rendered_value) for each field.

    binary section:
        u32 magic
        u32 n_scalars
        n_scalars * [hash][type][value]
        u32 n_lists
        n_lists * ( [hash][count]  entries...  [0] )

The word after a list's hash is the ENTRY COUNT, not a type: over the 6,262
item DATs it equals the number of entries in 4200/4200 non-empty lists. Parse
the count, do not scan for the terminator -- a list whose entry *value* is 0
(e.g. MAGIC_REQUIRED:0) would otherwise stop the walk early.
    """
    ver, cnt, strs, start = parse_strings(b)
    by_id = dict(strs)
    body = b[start:]
    n = len(body) // 4
    words = struct.unpack('<%dI' % n, body[:n * 4])

    def value(t, v):
        if t in (5, 8):
            return by_id.get(v, '<string id %d>' % v)
        if t == 2:
            return '%g' % struct.unpack('<f', struct.pack('<I', v))[0]
        return str(v)

    out = []
    if n < 2:
        return ver, cnt, strs, out, body, words
    magic, n_scalars = words[0], words[1]
    out.append(('head', 'magic=0x%08X' % magic, 'n_scalars=%d' % n_scalars, ''))
    i = 2
    for _ in range(n_scalars):
        if i + 2 >= n:
            break
        h, t = words[i], words[i + 1]
        out.append((0, field_name(h), TYPE_NAMES.get(t, 'type%d' % t),
                    value(t, words[i + 2])))
        i += 3
    # list fields
    if i < n:
        n_lists = words[i]
        out.append(('head', 'n_lists=%d' % n_lists, '', ''))
        i += 1
        for _ in range(n_lists):
            if i + 1 >= n:
                break
            h, count = words[i], words[i + 1]
            out.append((0, field_name(h), 'list(%d)' % count, ''))
            i += 2
            for _ in range(count):
                if i + 2 >= n:
                    break
                out.append((1, field_name(words[i]),
                            TYPE_NAMES.get(words[i + 1], 'type%d' % words[i + 1]),
                            value(words[i + 1], words[i + 2])))
                i += 3
            if i < n and words[i] == 0:
                i += 1  # zero terminator
    return ver, cnt, strs, out, body, words


def main():
    if not sys.argv[1:]:
        print(__doc__)
        return
    arg = sys.argv[1]
    b = read_pak_entry(arg) if not os.path.exists(arg) else open(arg, 'rb').read()
    ver, cnt, strs, fields, body, words = decode(b)
    print('%s: %d bytes, version %d, %d strings, %d-byte binary section'
          % (os.path.basename(arg), len(b), ver, cnt, len(body)))
    print()
    if '--strings' in sys.argv:
        for t, s in strs:
            print('   id=%-6d %s' % (t, s.replace('\n', '\\n')))
        print()
    for depth, nm, tn, v in fields:
        if depth == 'head':
            print('  # %s %s' % (nm, tn))
            continue
        pad = '    ' if depth else '  '
        print('%s%-22s %-8s %s' % (pad, nm, tn, v))
    if '--raw' in sys.argv:
        print('\nraw words:')
        for k in range(0, len(body) // 4):
            w, = struct.unpack_from('<I', body, k * 4)
            print('   %3d 0x%03x  0x%08x  %10d' % (k, k * 4, w, w))


if __name__ == '__main__':
    main()

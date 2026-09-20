# -*- coding: utf-8 -*-
"""Dump a Torchlight II .DAT as a readable type/string listing.

A .DAT is a header

    u32 version
    u32 string_count
    u32 (unused / first type id)

followed by `string_count` records of

    u32 type
    u16 charlen
    charlen * 2 bytes UTF-16LE

and then a binary section of numeric field values, which is not decoded here.
The string section is the useful half: it names every asset, skill, and table
the unit references.

`type` ids are not hashes -- they run in ascending blocks and separate one kind
of field from the next. Diffing two files of the same kind shows which id
carries what.

Usage: python dump_dat.py <file.dat> [--head N]
"""
import io, struct, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def walk(b, o):
    """Decode records from `o`, keeping the good prefix if the layout breaks."""
    out = []
    n = len(b)
    while o + 6 <= n:
        t, = struct.unpack_from('<I', b, o)
        ln, = struct.unpack_from('<H', b, o + 4)
        if ln == 0 or o + 6 + ln * 2 > n:
            break
        body = b[o + 6:o + 6 + ln * 2]
        if any(body[i + 1] != 0 for i in range(0, len(body), 2)):
            break
        out.append((o, t, body.decode('utf-16-le')))
        o += 6 + ln * 2
    return out


def records(b):
    """The start offset and records that decode the most of this file."""
    best = (0, [])
    for start in range(0, min(64, len(b)), 4):
        r = walk(b, start)
        if len(r) > len(best[1]):
            best = (start, r)
    if not best[1]:
        raise SystemExit('no record layout found')
    return best


def main():
    path = sys.argv[1]
    b = open(path, 'rb').read()
    start, recs = records(b)
    ver, cnt = struct.unpack_from('<II', b, 0)
    head = int(sys.argv[sys.argv.index('--head') + 1]) if '--head' in sys.argv else len(recs)

    print('%s: %d bytes, version %d, declares %d strings, decoded %d'
          % (path, len(b), ver, cnt, len(recs)))
    for off, t, s in recs[:head]:
        print('  %5d  t=%-9d %s' % (off, t, s))


if __name__ == '__main__':
    main()

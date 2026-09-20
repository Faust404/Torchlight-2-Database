# -*- coding: utf-8 -*-
"""Read the file index out of a Torchlight II DATA.PAK.MAN manifest.

The manifest is not a headerless blob of strings -- it is a record list with
UTF-16LE names, so `strings` finds nothing without -el and offset math needs
the real record layout. This script derives that layout from the file rather
than assuming it, then reports what is actually inside the archive.

Usage: python parse_pak_man.py [--list <substring>]
"""
import io, struct, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

MAN = (r'E:\Games\Steam\steamapps\common\Torchlight II'
       r'\PAKS\DATA.PAK.MAN')

data = open(MAN, 'rb').read()
print('manifest: %d bytes' % len(data))
print('first 8 bytes: %s' % data[:8].hex(' '))

# The first u16 reads as a version. Everything after it is a record list, but
# the record layout is what we are here to find out.
ver, = struct.unpack_from('<H', data, 0)
print('leading u16: %d' % ver)


def try_layout(start, tail_bytes):
    """Walk records of [u16 len][len UTF-16 chars][tail_bytes of payload].

    Returns the records if the walk lands exactly on EOF with every name
    decoding cleanly, else None. Guessing the layout is cheaper than
    hardcoding it and then being wrong on a patch.
    """
    off = start
    out = []
    while off < len(data):
        if off + 2 > len(data):
            return None
        n, = struct.unpack_from('<H', data, off)
        if n == 0 or n > 260:
            return None
        p = off + 2
        if p + n * 2 > len(data):
            return None
        try:
            name = data[p:p + n * 2].decode('utf-16-le')
        except UnicodeDecodeError:
            return None
        if any(ord(c) < 0x20 for c in name):
            return None
        p += n * 2
        if p + tail_bytes > len(data):
            return None
        payload = struct.unpack_from('<%dI' % (tail_bytes // 4), data, p)
        out.append((name, payload))
        off = p + tail_bytes
    return out


for start in (2, 6):
    for tail in (4, 8, 12, 16):
        recs = try_layout(start, tail)
        if recs:
            print('\nlayout fits: records start at %d, %d payload bytes each '
                  '-> %d records' % (start, tail, len(recs)))
            for name, pay in recs[:6]:
                print('   %-28s %s' % (name, ' '.join('0x%x' % v for v in pay)))
            break
    else:
        continue
    break
else:
    print('\nno clean record walk -- layout needs more work')
    sys.exit(1)

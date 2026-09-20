# -*- coding: utf-8 -*-
"""Torchlight II .DAT field-name hashing, and the field-name table.

The binary section of a .DAT is a stream of

    u32 field_hash      # DEK hash of the field's UPPERCASE name
    u32 type            # 1=int, 2=float, 3=list, 5=asset string, 8=localized string
    u32 value

`field_hash` is Knuth's DEK hash over the ASCII name:

    h = len(name)
    for c in name: h = ((h << 5) ^ (h >> 27) ^ c) & 0xFFFFFFFF

Confirming it: DEK("STRENGTH_REQUIRED") == 0x27DD296B, which is the field
carrying 60/75/90 in every melee-weapon DAT.

Usage:
    python dat_hash.py NAME          # hash one name
    python dat_hash.py --fields      # print the known field table
"""
import io, sys

M = 0xFFFFFFFF


def dek(name):
    """DEK hash of a field name. Pass the name already upper-cased."""
    b = name.encode('ascii')
    h = len(b)
    for c in b:
        h = ((h << 5) ^ (h >> 27) ^ c) & M
    return h


# type ids seen in the value stream
T_INT, T_FLOAT, T_LIST, T_STRING, T_BOOL, T_TEXT = 1, 2, 3, 5, 6, 8

TYPE_NAMES = {1: 'int', 2: 'float', 3: 'list', 5: 'string', 6: 'bool', 8: 'text'}

# Field names confirmed against the hash oracle. Every one of these was
# verified by recomputing dek() on the name and matching the observed value.
FIELDS = {
    # identity / text
    0x00660DE5: 'NAME',
    0x832F7C76: 'DISPLAYNAME',
    0x13B3DCA2: 'DESCRIPTION',
    0xB9F80B70: 'UNIDENTIFIED_NAME',
    0x176B64FE: 'UNITTYPE',
    0x006B6E45: 'TYPE',
    0x0000C4F4: 'SET',
    # assets
    0x006585AE: 'ICON',
    0xE2A227BC: 'MESHFILE',
    0x746FEC1E: 'RESOURCEDIRECTORY',
    0x00679E28: 'MESH',
    0x8FAB5E28: 'TEXTURE',
    0xE0683EAD: 'WARDROBE',
    0xF7319FCA: 'PARTICLES',
    # inheritance
    0xE27227C5: 'BASEFILE',
    0xEDD3AA06: 'UNIT_GUID',
    # levelling / rarity
    0x0EE3D0EC: 'LEVEL',
    0xD8E3DA96: 'MINLEVEL',
    0xF4E3DA94: 'MAXLEVEL',
    0x9D681E79: 'LEVEL_REQUIRED',
    0x20382ED8: 'RARITY',
    0xA670656D: 'RARITY_DMG_MOD',
    # requirements
    0x27DD296B: 'STRENGTH_REQUIRED',
    0xA26968EA: 'DEXTERITY_REQUIRED',
    0xD5D9FE7B: 'MAGIC_REQUIRED',
    0x91230CAD: 'DEFENSE_REQUIRED',
    # combat numbers
    0x46811078: 'DAMAGE_PHYSICAL',
    0x4B4A411C: 'DAMAGE_FIRE',
    0xCA5E6F5D: 'DAMAGE_ICE',
    0x7F8FD5DE: 'DAMAGE_ELECTRIC',
    0x0569A08F: 'DAMAGE_POISON',
    0xB0A39AF9: 'ARMOR_PHYSICAL',
    0x61F25E7E: 'ARMOR_FIRE',
    0xDB0FCFA6: 'ARMOR_ICE',
    0x89AD5F5F: 'ARMOR_ELECTRIC',
    0x85142829: 'ARMOR_POISON',
    0x0C36E3FE: 'MINDAMAGE',
    0x8C36E3BB: 'MAXDAMAGE',
    0x0F191CE4: 'SPEED',
    0x87425B52: 'SPEED_DMG_MOD',
    0x0F01B0A5: 'RANGE',
    0x0F108DC5: 'SCALE',
    # sockets / affixes
    0x5A149EFF: 'SOCKETS',
    0x5EA8E43F: 'MAX_SOCKETS',
    0x0E321178: 'AFFIX',
    0xC845E8DB: 'AFFIXES',
    # misc unit data
    0x0A7618F3: 'GENDER',
    0x00680C25: 'RACE',
    0x13CCD6CD: 'STRIKE_SOUND',
    0x9ACC1E8E: 'ATTACK_SOUND',
    0xBB365EF7: 'FALL_SOUND',
}

if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    if '--fields' in sys.argv:
        for h, n in sorted(FIELDS.items(), key=lambda kv: kv[1]):
            print('0x%08X  %s' % (h, n))
    elif len(sys.argv) > 1:
        for a in sys.argv[1:]:
            print('0x%08X  %s' % (dek(a.upper()), a))
    else:
        print(__doc__)

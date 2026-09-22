# -*- coding: utf-8 -*-
"""The four-level table on an eye's card, derived from the files.

An eye socketable is one item file that prints four statlines. Its DAT carries
MAXLEVEL 9999999 -- the sentinel for "generated at the level of whatever
dropped it" -- so in Normal it prints its own LEVEL and in NG+1/2/3 it prints
higher values. The tables carry only the Normal row, so the card showed one of
the four levels the item actually has. This module derives the other three.

**The values are in the files.** An affix's effect value is a *percentage* of a
per-stat by-level graph in MEDIA/GRAPHS/STATS, and the printed number is

    ceil( pct * CURVE(level) / 100 )

evaluated at the level of the item carrying the affix -- the law REFERENCE.md
records and audits against 42 published rows. Two display rules, not one: the
per-second regen stats print a single decimal, rounded half-up.

**The NG levels are not.** No eye DAT, spawn class or affix carries one. What
the files do carry is the *bands*: REPLAY_GAME_OFFSET.DAT is 0, 51, 81, 100,
120, 120 for replays 0..5, so Normal/NG+1/NG+2/NG+3 begin at 0/51/81/100, and
the Normal level sits in its band by a straight line. That fit reproduces 30 of
30 published NG levels. It is a *hypothesis*, not a rule read from a file --
two free parameters, 23 of the 30 fitted and 7 out of sample -- and `levels()`
below is the only place it lives. NG+3 is the cap at 100 for every eye, which
is why every eye's last row is the same level.

Two traps this module exists to make explicit:

  * The value member is not one hash. `0x0000BD6E` is the usual min, but the
    count-based and draw families put the pair under `0xD6CEC8D9` /
    `0xC7AEC8D9`. And `0xE03B279B` is *not* a value at all -- it is the string
    duration, present on nearly every affix as 0 when there is no duration, so
    listing it as a candidate silently makes every scaled stat read 0.
  * An effect list is flushed when the *next* list begins, not when a value
    member arrives. `UNIQUE_TL2_DRAWMANA2` carries no value member in any form
    (its amount sits in unhashed floats), and waiting for one drops its TYPE,
    which would unpair its line. DRAW MANA has no curve, so nothing needs the
    number -- but the pairing does.

Cells are lists of lines, because one side can print several: The Eye of
Eldrayn's armor column is four elemental defenses from a single affix.
"""
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths  # noqa: E402
import slots  # noqa: E402

sys.path.insert(0, paths.TL2_SRC)
import dat_decode as DD  # noqa: E402

STATS = 'MEDIA/GRAPHS/STATS/%s.DAT'

# TYPE -> the graph its percentage is taken of. Exactly the map REFERENCE.md
# records; a TYPE absent from it prints the affix's own number at every level,
# which is why a proc chance, an attack speed, a potion percentage and the pet
# percentages are all level-independent.
CURVES = {
    'DAMAGE BONUS': STATS % 'BASE_WEAPON_DAMAGE',
    'MELEEDAMAGEBONUS': STATS % 'BASE_WEAPON_DAMAGE',
    'RANGEDDAMAGEBONUS': STATS % 'BASE_WEAPON_DAMAGE',
    'MAX HP': STATS % 'HEALTH_PLAYER_GENERIC',
    'HP RECHARGE PLAYER': STATS % 'HEALTH_PLAYER_GENERIC',
    'MAX MANA': STATS % 'MANA_PLAYER_GENERIC',
    'MANA RECHARGE PLAYER': STATS % 'MANA_PLAYER_GENERIC',
    'LIFE STEAL': STATS % 'STEAL_HEALTH_AND_MANA',
    'MANA STEAL': STATS % 'STEAL_MANA',
    'ARMOR BONUS': STATS % 'ARMOR_PLAYER_BYLEVEL_FORSET',
    'POISON DEFENSE': STATS % 'ARMOR_PLAYER_BYLEVEL_FORSET',
    'ICE DEFENSE': STATS % 'ARMOR_PLAYER_BYLEVEL_FORSET',
    'FIRE DEFENSE': STATS % 'ARMOR_PLAYER_BYLEVEL_FORSET',
    'ELECTRICAL DEFENSE': STATS % 'ARMOR_PLAYER_BYLEVEL_FORSET',
    'MAGIC': STATS % 'ATTRIBUTE_BONUS',
    'STRENGTH BONUS': STATS % 'ATTRIBUTE_BONUS',
    'DEXTERITY BONUS': STATS % 'ATTRIBUTE_BONUS',
    'DEGRADE ARMOR': STATS % 'ARMOR_MONSTER_BYLEVEL',
}

# The stats that print a decimal. ceil would make Void's 1.65 a 2 and Python's
# round() would make it 1.6; the game prints 1.7.
DEC1 = ('HP RECHARGE PLAYER', 'MANA RECHARGE PLAYER')

# The NG bands, from REPLAY_GAME_OFFSET.DAT (0, 51, 81, 100, 120, 120): the
# first replay starts at 51 and the last Normal level (49) lands on 80, so
# NG+1 spans 51..80 -> (51, 29); NG+2 spans 81..99 -> (81, 18); NG+3 is capped.
NG_BANDS = {1: (51, 29), 2: (81, 18), 3: (100, 0)}
NG_SPAN = 49.0
NG_LABELS = ('Normal', 'NG +1', 'NG +2', 'NG +3')
NG_CAP = 100

EFFECT_LIST = '0x0E421C35'
SUBTYPE = '0x4B43015C'
VALUE_MEMBERS = ('0x0000BD6E', '0x0000BC78', '0xD6CEC8D9', '0xC7AEC8D9',
                 '0x0E46C025', '0xE343B7AF')

# The one column of the 16 published eye tables whose numbers move with no
# graph to explain them. TYPE `DAMAGE` with a duration in the string member
# 0xE03B279B fits no graph in MEDIA/GRAPHS/STATS at any percentage, so this is
# the wiki's transcription, not a derivation: The Eye of the Dark Alchemist's
# weapon cell at its four published levels 48 / 79 / 98 / 100, from the page's
# own table. keyed by affix, because the numbers belong to this item and not to
# the TYPE -- The Eye of Jutham Kasam carries UNIQUE_TL2_DAMAGEOVERTIME3, and
# no page anywhere publishes a number for it, so its rows past Normal read '?'.
# The build asserts the four levels above equal what levels() returns, which is
# the check that keeps this transcription tied to the item it came from.
DOT_PUBLISHED = {'UNIQUE_TL2_DAMAGEOVERTIME5': (480, 1370, 2260, 2375)}
UNKNOWN = '?'

# The first number on a line, sign and percent kept, so a substitution replaces
# the quantity and not the wording -- app.js's mark() wraps what this matches.
NUM = re.compile(r'([-+]?)(\d+(?:[.,]\d+)?)(%?)')

_scanned = {}


def effects(affix_path):
    """[(TYPE, subtype, pct)] for one affix DAT, in file order.

    pct is None when the file carries no value member at all -- see the module
    docstring on UNIQUE_TL2_DRAWMANA2. List members are read positionally: they
    are tagged with the list's own hash in some files and with UNITTYPE in
    others, so the walk tracks the most recent list header rather than trusting
    the member's own name.
    """
    if affix_path in _scanned:
        return _scanned[affix_path]
    try:
        rows = DD.decode(DD.read_pak_entry(affix_path))[3]
    except Exception:
        rows = []
    out, cur, cur_list = [], None, None
    for row in rows:
        if not (isinstance(row, (tuple, list)) and len(row) >= 4):
            continue
        if row[0] == 0:
            if cur_list == EFFECT_LIST and cur and 'TYPE' in cur:
                out.append((cur['TYPE'], cur.get(SUBTYPE, ''), cur.get('pct')))
            if row[1] == EFFECT_LIST:
                cur, cur_list = {}, EFFECT_LIST
            else:
                cur, cur_list = None, row[1]
            continue
        if cur is None or cur_list != EFFECT_LIST:
            continue
        if row[1] == 'TYPE':
            cur['TYPE'] = row[3]
        elif row[1] == SUBTYPE:
            cur[SUBTYPE] = row[3]
        elif row[1] in VALUE_MEMBERS and 'pct' not in cur:
            try:
                cur['pct'] = float(row[3])
            except (TypeError, ValueError):
                pass
    if cur_list == EFFECT_LIST and cur and 'TYPE' in cur:
        out.append((cur['TYPE'], cur.get(SUBTYPE, ''), cur.get('pct')))
    _scanned[affix_path] = out
    return out


def printed(ty, pct, level, graph):
    """What the game prints for one effect at one level, or None.

    None means "not derived" -- a TYPE with no curve, no value member, or a
    level off the curve -- and every caller prints TIDBI's text unchanged in
    that case. `graph` is build.graph_points: {level: value} for a graph path,
    memoised there, so there is one reader for the whole build.
    """
    path = CURVES.get(ty)
    if not path or pct is None:
        return None
    pts = graph(path)
    if level not in pts:
        return None
    v = pct * pts[level] / 100.0
    if ty in DEC1:
        return math.floor(v * 10 + 0.5) / 10.0
    return float(math.ceil(v))


def levels(level):
    """[(level, label), ...] -- Normal plus the three replays, four rows.

    The Normal level is the file's own. The rest are the band map: the level
    moved to the same *fraction* of its band that the Normal level occupies of
    band 0. int(round()) is Python's banker's rounding, which is safe here
    only because the two slopes (29/49 and 18/49) can never land a tie -- the
    numerator is even and 49 is odd.

    Four rows unconditionally, because every eye can be generated above level
    100. The Eye of Tiamat is the one eye whose MAXLEVEL is not the 9999999
    sentinel -- it reads 0..999 rather than 1..9999999 -- and that is *not* a
    ceiling: build.py's MAX_LEVEL_CEILING comment records 999 as the number the
    corpus already uses to spell the same thing, and it is above every
    reachable level either way. Both bands say "generated at the level of
    whatever dropped it", so both scale. build.py asserts the condition that
    makes this safe (MAXLEVEL >= 100 or absent) rather than trusting it.
    """
    out = [(level, NG_LABELS[0])]
    for ng in (1, 2, 3):
        base, span = NG_BANDS[ng]
        out.append((int(round(base + (level - 1) * span / NG_SPAN)), NG_LABELS[ng]))
    return out


def _fmt(v, ty):
    return '%.1f' % v if ty in DEC1 else '%d' % int(round(v))


def _cell(pairs, i, lv, graph, notes):
    """One side's lines at one level, each with the number the game prints.

    `pairs` is [(affix, TYPE, pct, line)] -- one entry per line, in tooltip
    order. A pair whose effect is not derived (no curve, or a curve this level
    is off) keeps TIDBI's line exactly as printed; that is the common case and
    it is what makes a proc chance read the same on all four rows.
    """
    out = []
    for name, ty, pct, line in pairs:
        v = printed(ty, pct, lv, graph)
        if v is None:
            pub = DOT_PUBLISHED.get(name)
            if pub and i < len(pub):
                v = float(pub[i])
        if v is None:
            out.append(line)
            continue
        m = NUM.search(line)
        if not m:
            out.append(line)
            continue
        was, now = m.group(2), _fmt(v, ty)
        # Only the Normal row can drift: that is where TIDBI prints the same
        # number the derivation does, so a difference there means one of the
        # two is wrong. On every other row a changed number is the point.
        if i == 0 and was.replace(',', '.') != now:
            notes.append(('value', line, was, now))
        out.append(line[:m.start(2)] + now + line[m.end(2):])
    return out


def pairing(path, fx, fxs):
    """{'a': [(affix, TYPE, pct, line)], 'w': [...]} -- which effect drives
    which line, or None for a side whose two lists disagree in length.

    TIDBI's lines and the file's effects are both in affix order, and an affix
    can put several lines on one side (Eldrayn's four elemental defenses), so
    the pairing is positional within the side. An either-slot affix belongs to
    both sides, which is what slots.EITHER means and what `fxs` records.
    """
    eff = {'a': [], 'w': []}
    for name in slots.affixes(path):
        p = slots.affix_path(name)
        s = slots.affix_slot(name)
        for ty, _sub, pct in (effects(p) if p else []):
            for side in ('a', 'w'):
                if s in (side, slots.EITHER):
                    eff[side].append((name, ty, pct))
    line = {'a': [], 'w': []}
    for text, code in zip(fx, fxs):
        for side in ('a', 'w'):
            if code in (side, slots.EITHER):
                line[side].append(text)
    out = {}
    for side in ('a', 'w'):
        if len(eff[side]) != len(line[side]):
            out[side] = None
            continue
        out[side] = [e + (t,) for e, t in zip(eff[side], line[side])]
    return out


def rows(path, fx, fxs, level, graph, level_curve):
    """([[level, req, armor, weapon, ng_label], ...], notes) for one eye.

    Every one of the five is a string, and armor and weapon are lists of lines
    because one side can print several. `req` is UNKNOWN only if the requirement
    curve came back empty, which the build asserts against -- graph_points()
    returns {} rather than raising, so that failure is otherwise silent.
    `notes` carries what a reader should not have to take on trust, tagged:

        ('value', line, was, now)  TIDBI's own number is not the derived one
        ('unpaired', side, n, m)   a side whose effects and lines disagree, so
                                   its lines are printed exactly as TIDBI has
                                   them and nothing was substituted

    The build pins both sets rather than printing them, so a curve that moves
    or a pairing that slips fails the build instead of quietly shipping.
    """
    pair = pairing(path, fx, fxs)
    notes = []
    lvls = levels(level)
    out = []
    for i, (lv, label) in enumerate(lvls):
        # Strings, because these are what the card prints and app.js marks at
        # render time. `lv` stays an int for the graph lookups below.
        req = level_curve.get(lv)
        row = ['%d' % lv, UNKNOWN if req is None else '%d' % req]
        for side in ('a', 'w'):
            if pair[side] is None:
                if i == 0:
                    notes.append(('unpaired', side, 0, 0))
                row.append([t for t, c in zip(fx, fxs) if c in (side, slots.EITHER)])
            else:
                row.append(_cell(pair[side], i, lv, graph, notes))
        row.append(label)
        out.append(row)
    return out, notes

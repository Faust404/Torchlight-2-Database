# -*- coding: utf-8 -*-
"""Which slot a socketable's effect lines belong to, read from the game files.

A socketable grants one thing in armor or a trinket and another in a weapon, and
the card shows them as two labelled groups. TIDBI's tooltip text carries the
split as `Weapon:` / `Armor/Trinket:` prefixes, and for most socketables that is
right -- 129 of 170 agree with the files exactly. But the export loses a heading
in places, and where it does, its lines silently join the block above them:

    Skull of Quato      Weapon: 10% chance to Freeze for 5 sec.
                        +64 Poison Armor          <- these four are
                        +64 Ice Armor                Armor/Trinket,
                        +64 Fire Armor               not Weapon
                        +64 Electric Armor

    Grapilio Skull      Weapon: 33 Health stolen on hit
                        +6% to Physical Armor   <- Armor, filed under Weapon

The files have no such ambiguity. An item's DAT holds an ordered `AFFIXES`
list, and each affix's own DAT declares which slots it may sit in, as a string
list under hash 0xED6CBF91 -- the same list the rare-ember pools are read from
(see EMBER_FAMILIES in build.py). The order of the item's affix list is the
order the tooltip prints them in, so affix i's slot is the slot of the i-th
block of TIDBI's text.

That gives an independent answer for each line, and where it disagrees with
TIDBI the files win -- which is this project's rule everywhere else. The wiki's
Gems (T2) tables agree with the files on every disagreement found so far, and
disagree with TIDBI on every one; see REFERENCE.md.

Three things it does not settle, all reported rather than guessed:

  * `AFFIXES` is a list field, and build.py's BASEFILE merge deliberately skips
    list fields (scalar_fields' docstring says so), because effect text has
    always come from TIDBI. Embers, gems and components have no AFFIXES of
    their own -- they inherit one -- so this module walks the base chain itself.
    Where the chain still yields nothing, the item is marked.
  * The Ice Ember affixes (GEM_SAPPHIRE, GEM_SAPPHIRE_ARMOR) carry no
    0xED6CBF91 list at all. Their TIDBI headings are complete, so TIDBI's own
    answer is used as it stands and the row is marked 'text'.
  * Where TIDBI's block count does not match the affix count, or a heading
    contradicts the files, the item is marked 'conflict'. The files still win.

One inference is worth naming, because it is the only place a line's slot is
not read straight off a file: when TIDBI merges two affixes into one block, the
boundary inside the block has to be guessed (first line -> affix 1, the rest ->
affix 2, since a heading marks where its affix begins). That guess is checked
against the affix names before it is used -- see _splittable and _corroborates
-- and the row is marked 'split' whether or not the check passed.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths

sys.path.insert(0, paths.TL2_SRC)
import dat_decode as DD  # noqa: E402

APPLICABILITY = '0xED6CBF91'
HEAD = re.compile(r'^(Weapon|Armor/Trinket):\s*(.*)$')

ARMOR, WEAPON, EITHER = 'a', 'w', 'b'

_scanned = {}
_affix_cache = {}
_BY = None


def _scan(path):
    """(scalars, AFFIXES, applicability) for one DAT, memoised.

    The applicability list is read at indent 1 under a list field whose hash is
    APPLICABILITY. A file can hold several lists; the walk tracks the most
    recent hash so another list's entries are not mistaken for this one's.
    """
    if path in _scanned:
        return _scanned[path]
    rows = DD.decode(DD.read_pak_entry(path))[3]
    scal = {r[1]: r[3] for r in rows if r[0] == 0}
    affixes = [r[3] for r in rows if r[0] == 1 and r[1] == 'AFFIX']
    app, cur = [], None
    for r in rows:
        if r[0] == 0 and str(r[2]).startswith('list'):
            cur = r[1] if r[1] == APPLICABILITY else None
        elif r[0] == 1 and cur:
            app.append(r[3])
    _scanned[path] = (scal, affixes, app)
    return _scanned[path]


def _index():
    """basename -> pak path, for every DAT. Affixes are named bare in an item's
    AFFIXES list (`UNIQUE_OFRESISTANCE5`) with no folder, and they live in
    MEDIA/AFFIXES/ITEMS/ or MEDIA/AFFIXES/GEMS/ or both."""
    out = {}
    for p in DD.pak_index():
        if p.upper().endswith('.DAT'):
            out.setdefault(p.split('/')[-1][:-4].upper(), p)
    return out


def affixes(path):
    """An item's ordered AFFIX list, following BASEFILE up the chain."""
    seen, cur = set(), path
    while cur and cur not in seen:
        seen.add(cur)
        scal, own, _ = _scan(cur)
        if own:
            return own
        base = scal.get('BASEFILE')
        cur = base.replace('\\', '/').lstrip('/').upper() if base else None
    return []


def affix_slot(name):
    """'a', 'w', 'b' (either slot) or '?' -- where one affix may sit.

    'b' is not a curiosity, it is a real category: 15 affixes named by
    socketables list both ARMOR and WEAPON, and they are exactly the ones whose
    effect reads the same either way -- the six Lucky Coins, the six Lucky Dice
    and the three fish scales. Those lines belong in both columns, which is why
    this returns a fourth value instead of picking a side. The fish are
    Torchlight 1 content and TL1_ITEMS drops their items, so 12 of the 15 reach
    a card; the count here is the corpus's, which the affix files still make up.
    The wiki leaves the Lucky Coin's weapon cell blank; the file's own list says
    both, so the file wins and the divergence is recorded in REFERENCE.md with
    the others.
    """
    global _BY
    if name not in _affix_cache:
        if _BY is None:
            _BY = _index()
        p = _BY.get(name.upper())
        if not p:
            _affix_cache[name] = '?'
        else:
            _, _, app = _scan(p)
            # the file's own words, not this module's one-letter codes
            has = ('WEAPON' in app, 'ARMOR' in app)
            _affix_cache[name] = (EITHER if all(has) else
                                  WEAPON if has[0] else ARMOR if has[1] else '?')
    return _affix_cache[name]


def tidbi_blocks(fx):
    """TIDBI's tooltip lines -> [(slot-or-None, lines, had_heading), ...].

    A headed line opens a block; an unheaded line continues the block above it,
    or, at the very start, opens one with no slot at all.
    """
    out = []
    for line in fx:
        m = HEAD.match(line)
        if m:
            out.append([WEAPON if m.group(1) == 'Weapon' else ARMOR,
                        [m.group(2)], True])
        elif out:
            out[-1][1].append(line)
        else:
            out.append([None, [line], False])
    return out


def _classify(path, fx):
    """([(slot, line), ...], status) for one socketable, in tooltip order.

    status is 'files'    -- the files decided it and TIDBI agreed (or was silent);
              'split'    -- TIDBI lost a heading, so the files were used and the
                            line boundary inside the merged block was inferred;
              'conflict' -- TIDBI printed a heading the files contradict. The
                            files win, per this project's rule, but the row is
                            flagged: unlike a lost heading, a wrong one is not
                            something the files can prove wrong;
              'text'     -- the files could not decide it (no affix list, or an
                            affix with no applicability list), so TIDBI's own
                            headings are used as they stand;
              'none'     -- no effect lines at all.
    """
    blocks = tidbi_blocks(fx)
    if not blocks:
        return [], 'none'
    names = affixes(path)
    slots = [affix_slot(a) for a in names]

    if slots and '?' not in slots and len(slots) == len(blocks):
        pairs = [(s, l) for (_, lines, _), s in zip(blocks, slots) for l in lines]
        bad = any(b[2] and b[0] != s for b, s in zip(blocks, slots) if s != EITHER)
        return pairs, 'conflict' if bad else 'files'

    if _splittable(blocks, slots, names):
        # One heading, two affixes, and the heading opens the first of them:
        # the heading marks where affix 1 begins, so its first line is affix 1's
        # and everything after belongs to affix 2. Sketchy on its face, so it
        # is checked against the affix names before being used -- see
        # _splittable -- and the row is marked 'split' either way.
        first, rest = blocks[0][1][0], blocks[0][1][1:]
        if slots[0] == ARMOR:
            return [(ARMOR, first)] + [(WEAPON, l) for l in rest], 'split'
        return [(WEAPON, first)] + [(ARMOR, l) for l in rest], 'split'

    # The files could not split this one, so TIDBI's headings stand as printed.
    # A block TIDBI left unheaded is shown in both columns rather than being
    # pushed into one -- that is what "no heading" means, and the row is
    # already marked 'text' so the reader knows the files did not decide it.
    pairs = [(slot or EITHER, l) for slot, lines, _ in blocks for l in lines]
    return pairs, 'text'


def attribute(path, fx):
    """[(slot, line), ...] for one socketable, in tooltip order.

    slot is ARMOR, WEAPON or EITHER. This is the flat form the build writes out:
    `fx` takes the lines, and `fxs` the slots beside them. `resolve` is the
    two-column view of the same answer.
    """
    return _classify(path, fx)[0]


def status(path, fx):
    """Which source decided this item -- see _classify."""
    return _classify(path, fx)[1]


def resolve(path, fx):
    """(armor, weapon, shared, status) for one socketable.

    `armor` and `weapon` are the two columns. `shared` holds the lines that
    belong in both -- an either-slot affix's -- and they appear in both lists
    too, so the caller can render them without guessing which lines are which.
    """
    pairs, st = _classify(path, fx)
    armor = [l for s, l in pairs if s in (ARMOR, EITHER)]
    weapon = [l for s, l in pairs if s in (WEAPON, EITHER)]
    shared = [l for s, l in pairs if s == EITHER]
    return armor, weapon, shared, st


# Words an affix name has to corroborate before the inferred boundary above is
# allowed to place it. The three items this fires on are named in the game's own
# vocabulary -- UNIQUE_OFRESISTANCE5, UNIQUE_ARMOR_PERCENT_BONUS3,
# UNIQUE_TL2_CHARGERATEBONUS -- so a placement that puts "Physical Armor" under
# ARMOR_PERCENT_BONUS and "Health stolen" under LIFE_STEAL is checked rather
# than assumed. A name with no entry here does not block the split.
_TOKENS = {
    'ARMOR': ('armor',), 'RESIST': ('armor', 'resist'),
    'FREEZE': ('freeze',), 'BURN': ('burn',), 'SHOCK': ('shock',),
    'POISON': ('poison',), 'LIFESTEAL': ('health stolen', 'life'),
    'MANASTEAL': ('mana',), 'HP': ('health',), 'CHARGERATE': ('charge',),
    'ELEMENTS': ('damage',), 'ATTACKSPEED': ('attack speed',),
    'DAMAGE': ('damage',), 'DODGE': ('dodge',), 'POTION': ('potion',),
    'FOCUS': ('focus',), 'STRENGTH': ('strength',),
}


def _corroborates(affix, lines):
    """Does a word the affix's name promises appear in the lines given to it?"""
    text = ' '.join(lines).lower()
    for key, wants in _TOKENS.items():
        if key in affix.upper():
            return any(w in text for w in wants)
    return True


def _splittable(blocks, slots, names):
    """The one merged-block shape we are willing to unpick: two affixes, two
    different slots, one block, and a heading that opens affix 1."""
    if len(blocks) != 1 or len(slots) != 2 or slots[0] == slots[1]:
        return False
    slot, lines, headed = blocks[0]
    if not headed or slot != slots[0] or len(lines) < 2:
        return False
    return (_corroborates(names[0], lines[:1])
            and _corroborates(names[1], lines[1:]))

# -*- coding: utf-8 -*-
"""Build the Torchlight II item database.

Merges three sources into one dataset and a grimtools-style browser over it:

    PAK item .DATs   authoritative numbers, 6,262 files, via tl2/dat_decode
    TIDBI            a recovered 2014 Access DB -- display text, effects, icons
    alfgeir          a third-party site's curated name/type/classification

Outputs land in out/: items.json, items.csv, icons.webp, icons.json, index.html.

Reads only. Nothing here writes to the game install.

Usage:
    python build.py            # data + app
    python build.py --no-app   # data only (skips index.html)
"""
import base64, collections, csv, io, json, os, re, struct, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths

# The four names the code below reads by. Every one is an alias so that no call
# site had to move with the tree: while the layout was settling these paths were
# edited in nine places and got out of step twice.
OUT = paths.OUT                    # what this writes, regenerated wholesale
CSV = paths.CSV_DIR                # data/csv -- the item tables this reads
ICON_DIR = paths.ICON_DIR          # data/icons -- the 1,053 sprite PNGs
ALFGEIR = paths.ALFGEIR            # optional; load_alfgeir() copes with {}

sys.path.insert(0, paths.TL2_SRC)
import dat_decode as DD
# The Blood/Iron/Void ember values are the one table in this build that no
# source reads: the affix files hold a single fixed float and the game scales it
# by a per-stat curve that is not in the PAK's readable section. See its header.
import ember_values
# Which slot a socketable's lines belong to, read from the item's AFFIXES order
# and each affix's own 0xED6CBF91 list. TIDBI carries the same split as text
# prefixes and loses a heading on 7 items; see the module docstring.
import slots
from PIL import Image

BS = chr(92)
ITEMS_PREFIX = 'MEDIA/UNITS/ITEMS/'
SETS_PREFIX = 'MEDIA/SETS/'

# ---------------------------------------------------------------- classification

# TIDBI's UNITTYPE is 111 clean "[Tier] <Type>" values; these are the only
# repairs it needs.
TYPE_ALIAS = {
    'crossbows': 'Crossbow',
    'quest items': 'Quest Item',
    'location items': 'Location Item',
}

# Fallback for the ~214 items TIDBI doesn't type. Keys are folder names under
# MEDIA/UNITS/ITEMS/, plus the RESOURCEDIRECTORY leaf.
FOLDER_TYPE = {
    'AXES': 'Axe', 'SWORDS': 'Sword', 'MACES': 'Mace', '2HMACE': 'Greathammer',
    'WANDS': 'Wand', 'STAVES': 'Staff', 'BOWS': 'Bow', 'POLEARMS': 'Polearm',
    'SHIELDS': 'Shield', 'FISTS': 'Claw', 'PISTOLS': 'Pistol', '2HSWORD': 'Greatsword',
    'RIFLES': 'Shotgonne', '2HAXE': 'Greataxe', 'CANNON': 'Cannon',
    'CROSSBOWS': 'Crossbow', 'DAGGERS': 'Dagger', 'POTIONS': 'Potion', 'FISH': 'Fish',
    'SCROLLS': 'Scroll', 'GOLD': 'Gold', 'SPELLS': 'Spell', 'SOCKETABLES': 'Socketable',
    'QUEST_ITEMS': 'Quest Item', 'MAPS': 'Map', 'TL2ARMOR': 'Armor',
    'LEVELITEMS': 'Location Item', 'LEGENDARY2': 'Legendary',
}
RESDIR_TYPE = {
    'axes': 'Axe', 'swords': 'Sword', 'maces': 'Mace', 'greatswords': 'Greatsword',
    'greataxes': 'Greataxe', 'hammers': 'Greathammer', 'polearms': 'Polearm',
    'bows': 'Bow', 'crossbows': 'Crossbow', 'pistols': 'Pistol', 'rifles': 'Shotgonne',
    'cannons': 'Cannon', 'wands': 'Wand', 'staves': 'Staff', 'claws': 'Claw',
    'shields': 'Shield', 'armor': 'Armor', 'helmets': 'Helmet',
}
# Last resort: the NAME suffix. Measured coverage 616 items.
NAME_SLOT = {
    'boots': 'Boots', 'shoulders': 'Shoulder Armor', 'gloves': 'Gloves',
    'chest': 'Chest Armor', 'pants': 'Leggings', 'belt': 'Belt', 'helmet': 'Helmet',
}

# The rail's taxonomy, in the order it renders: group -> optional subgroup ->
# types. This is the single source -- CATEGORY below is derived from it and the
# same structure is injected into the page as window.TAXONOMY, so the CSV's
# category column and the sidebar's grouping cannot drift apart.
#
# The shape is grimtools': it files a belt (ArmorProtective_Waist) with the
# jewellery rather than the body armour, and a shield (WeaponArmor_Shield) with
# the weapons. Weapons then need a third bucket, because a shield is neither
# one- nor two-handed.
#
# Order within a group is declared rather than computed. A curated taxonomy
# should not reshuffle itself as counts move, and the ordering carries meaning
# the counts do not: armour runs in body order, weapons melee-then-ranged.
#
# Fist / Rifle / 2H Mace / 2H Sword do not occur in the corpus. They are kept
# because UNITTYPE can still emit them; the placement follows the attack-speed
# divisor in section 7 (fist divides by 125, the one-handed rate; rifle by 100).
TYPE_GROUPS = [
    ('Armor', None, ['Helmet', 'Shoulder Armor', 'Chest Armor', 'Gloves',
                     'Leggings', 'Boots', 'Armor']),
    ('Weapons', 'One-Handed', ['Sword', 'Axe', 'Mace', 'Dagger', 'Claw',
                               'Wand', 'Pistol', 'Fist']),
    ('Weapons', 'Two-Handed', ['Greatsword', 'Greataxe', 'Greathammer', 'Polearm',
                               'Staff', 'Bow', 'Crossbow', 'Shotgonne', 'Cannon',
                               '2H Sword', '2H Mace', 'Rifle']),
    ('Weapons', 'Off-Hand', ['Shield']),
    ('Accessories', None, ['Ring', 'Necklace', 'Collar', 'Belt']),
    ('Misc', None, ['Spell', 'Socketable', 'Quest Item', 'Tag', 'Map', 'Fish',
                    'Potion', 'Location Item', 'Scroll', 'Gold', 'Dynamite']),
]
CATEGORY = {t: g for g, _sub, ts in TYPE_GROUPS for t in ts}
GROUP_OF = {}                  # type -> (group, subgroup), for the same reason
for _g, _sub, _ts in TYPE_GROUPS:
    for _t in _ts:
        GROUP_OF[_t] = (_g, _sub)

# "Magic" is deliberately absent: TIDBI has no such tier word and every
# *_m<digit> item is tiered Rare. The UI renders only tiers present in the data.
TIER_ORDER = ['Normal', 'Rare', 'Unique', 'Set', 'Legendary', 'Unclassified']
TIER_WORDS = {'NORMAL': 'Normal', 'MAGIC': 'Magic', 'MAGICAL': 'Magic', 'RARE': 'Rare',
              'UNIQUE': 'Unique', 'EPIC': 'Unique', 'LEGENDARY': 'Legendary', 'SET': 'Set'}


def titleize(name):
    """greataxe_bland -> 'Bland Greataxe'. Drops the trailing variant marker."""
    parts = name.lower().split('_')
    # trailing tier+variant tokens: u01c, m02, n1, set, b, c
    while parts and re.fullmatch(r'(?:set|[numc]\d*[a-z]?|[bc])', parts[-1]):
        parts.pop()
    words = [re.sub(r'\d+', '', p) for p in parts]
    return ' '.join(w.capitalize() for w in words if w) or name


def canon_type(s):
    """'NORMAL_COLLAR' -> 'Collar'; 'LEGENDARY 1HAXE' -> 'Axe'; 'Unique Chest
    Armor' -> 'Chest Armor'. TIDBI's UNITTYPE is mostly title case but the DATs'
    own is shouty-underscore, so both spellings reach here."""
    s = (s or '').strip()
    if not s:
        return None
    if '_' in s or s.isupper():
        s = ' '.join(w.capitalize() for w in s.replace('_', ' ').split())
    words = s.split()
    if words and words[0].upper() in TIER_WORDS:
        words = words[1:]
    s = ' '.join(words)
    return TYPE_ALIAS.get(s.lower(), s) or None


def token_names(items):
    """Derive `UNITTYPE` token -> display name from the corpus itself.

    The DAT's `UNITTYPE` says what an item *is*; TIDBI's says what to *call* it.
    Tallying one against the other turns TIDBI's knowledge into a table without
    hand-copying it: 45 of the 46 tokens land on exactly one name ("UNIQUE PANTS"
    -> "Pants" -> "Leggings", "1HMACE" -> "1hmace" -> "Mace"), so the mapping
    cannot drift away from the data it was read out of. `POTION` is the one
    token that is genuinely ambiguous rather than merely differently spelled --
    it covers potions and the fish filed alongside them -- and is resolved per
    item in classify_type().
    """
    tally = collections.defaultdict(collections.Counter)
    for it in items:
        tok = canon_type(it['rec'].get('UNITTYPE'))
        nm = (canon_type(it['tidbi'].get('UNITTYPE'))
              or it['alf'].get('type_') or it['alf'].get('type'))
        if tok and nm:
            tally[tok][nm] += 1
    return tally


def classify_type(rec, folder, tidbi, alf, tokens):
    """What an item is comes from the game file; what we call it comes from
    TIDBI. The DAT states a `UNITTYPE` for 6,175 of the 6,176 items, and the
    token it carries is the game's own answer, so this reads it first and only
    falls back to the older sources when the token is one the corpus never
    agreed a name for -- the four NOSPAWN monster props in TOKEN_UNSEEN, whose
    token carries an elemental suffix, and one collar with no UNITTYPE at all.
    """
    tok = canon_type(rec.get('UNITTYPE'))
    if tok:
        names = tokens.get(tok)
        if names:
            if len(names) == 1:
                return next(iter(names))
            t = canon_type(tidbi.get('UNITTYPE'))
            if t:
                return t
        elif tok in CATEGORY:
            # Self-describing: the token already *is* a display name, it simply
            # never needed translating, so no source ever agreed one for it.
            # DAGGER (Dagger01), GOLD (the six coin piles) and MACE (destro_mug,
            # Engineer_Wrench -- monster props swung as maces) are the three.
            return tok
    return _classify_fallback(rec, folder, tidbi, alf)


def _classify_fallback(rec, folder, tidbi, alf):
    """TIDBI -> alfgeir -> folder -> RESOURCEDIRECTORY -> NAME, the chain this
    project used before it read the DAT's own `UNITTYPE`. Only the items in
    TOKEN_UNSEEN reach it now. Note the folder step ends in `.title()`, so it
    answers for every item that has a folder; the last two steps are reachable
    only from the items root, which is where the two items that use them sit.
    """
    t = canon_type(tidbi.get('UNITTYPE'))
    if t:
        return t
    a = alf.get('type_') or alf.get('type')
    if a:
        return a
    if folder and folder != '(root)':
        return FOLDER_TYPE.get(folder, FOLDER_TYPE.get(folder.upper(), folder.title()))
    rd = rec.get('RESOURCEDIRECTORY')
    if rd:
        leaf = rd.replace(BS, '/').rstrip('/').split('/')[-1].lstrip('_').lower()
        if leaf in RESDIR_TYPE:
            return RESDIR_TYPE[leaf]
    nm = rec.get('NAME')
    if nm:
        tail = re.sub(r'\d+', '', nm.lower().split('_')[-1])
        if tail in NAME_SLOT:
            return NAME_SLOT[tail]
    return None


def base_tier(rec, tidbi, alf):
    """TIDBI's tier vocabulary, measured, is exactly {RARE, UNIQUE, LEGENDARY}
    plus bare types ("Boots", "Ring", "Spell"). It has no MAGIC word at all --
    every one of the 576 items named *_m<digit> is tiered RARE by TIDBI, so
    "Magic" is not a tier this game's data expresses and the facet omits it.

    A bare type is TIDBI saying "not tiered", which for our purposes is Normal.

    This is the tier the sources give an item on their own, before SET
    promotion -- so `classify_tier` is the facet's tier and this is the item's
    own, which on a set piece are two different answers. The `_set` name
    fallback at the bottom is the one place the two ideas touch: a set item with
    no TIDBI row and no `_u`/`_m`/`_n` marker has nothing but its name, and the
    name says `_set`. That branch is why every set item is asserted to resolve
    to Rare or Unique rather than trusted to: it would otherwise be the way a
    set piece came back tiered "Set", which is not a rarity the game has.
    """
    ut = (tidbi.get('UNITTYPE') or '').strip()
    if ut:
        w = ut.replace('_', ' ').split()[0].upper()
        if w in TIER_WORDS:
            return TIER_WORDS[w]
        return 'Normal'              # bare type: TIDBI's un-tiered item
    c = (alf.get('classification') or '').strip()
    if c:
        return {'Epic': 'Unique', 'Rare': 'Rare', 'Legendary': 'Legendary',
                'Magical': 'Magic', 'Normal': 'Normal'}.get(c, c)
    nm = (rec.get('NAME') or '').lower()
    if 'legendary' in nm:
        return 'Legendary'
    if '_set' in nm:
        return 'Set'
    if re.search(r'_u\d', nm):
        return 'Unique'
    if re.search(r'_m\d', nm):
        return 'Magic'
    if re.search(r'_n\d', nm):
        return 'Normal'
    return 'Unclassified'


def classify_tier(rec, tidbi, alf):
    """The tier the site filters on, which for a set piece is not its rarity."""
    if (rec.get('SET') or '').strip():
        # A non-empty SET is the DAT itself asserting membership, so it wins.
        # TIDBI tiers these 210 Rare / 346 Unique; the game shows them as their
        # own tier, so this is a deliberate promotion, not an inference. The
        # tier it displaces is kept as `uq` -- "Unique Set Belt" tells the
        # player what the thing is worth, and "Set Belt" alone does not.
        return 'Set'
    return base_tier(rec, tidbi, alf)


# ---------------------------------------------------------------------- loading

DAMAGE_KEYS = ('DAMAGE_PHYSICAL', 'DAMAGE_FIRE', 'DAMAGE_ICE', 'DAMAGE_ELECTRIC',
               'DAMAGE_POISON')
ARMOR_KEYS = ('ARMOR_PHYSICAL', 'ARMOR_FIRE', 'ARMOR_ICE', 'ARMOR_ELECTRIC',
              'ARMOR_POISON')

# Armor's three inputs, all hashed fields the DATs never name: the weight and
# min-weight a slot scales its ARMOR_* value by, and a rarity multiplier. None of
# them sit on the item -- they are inherited from the base armour file
# (BASEARMOR_AMULET.DAT and the rest of the family), so they have to ride the
# same BASEFILE merge the named fields do, which is why they are in KEEP.
ARMOR_WEIGHT = '0x1ED83664'
ARMOR_MIN_WEIGHT = '0x1ED83772'
ARMOR_MULT = '0xE720656C'

STAT_FIELDS = DAMAGE_KEYS + ARMOR_KEYS + (
    'LEVEL', 'SPEED', 'SPEED_DMG_MOD', 'MINDAMAGE', 'MAXDAMAGE', 'RARITY_DMG_MOD')

KEEP = set(STAT_FIELDS) | {
    ARMOR_WEIGHT, ARMOR_MIN_WEIGHT, ARMOR_MULT,
    'NAME', 'DISPLAYNAME', 'DESCRIPTION', 'UNIDENTIFIED_NAME', 'UNITTYPE', 'TYPE',
    'ICON', 'MESHFILE', 'RESOURCEDIRECTORY', 'UNIT_GUID', 'BASEFILE', 'MINLEVEL',
    'MAXLEVEL', 'LEVEL_REQUIRED', 'RARITY', 'STRENGTH_REQUIRED', 'DEXTERITY_REQUIRED',
    'MAGIC_REQUIRED', 'DEFENSE_REQUIRED', 'SOCKETS', 'MAX_SOCKETS', 'SET', 'AFFIX',
    'RANGE', 'SCALE', 'GENDER', 'RACE',
}


def scalar_fields(path):
    """Named scalar fields of one DAT. List fields (AFFIXES, WARDROBE) skipped."""
    out = {}
    for t in DD.decode(DD.read_pak_entry(path))[3]:
        if isinstance(t, (tuple, list)) and len(t) >= 4 and t[0] == 0:
            if t[1] in KEEP:
                out.setdefault(t[1], t[3])
    return out


def norm_path(v):
    return v.replace(BS, '/').lstrip('/').upper()


def nonzero(v):
    """Scalars arrive as int, float-string, or text. Zero is 'absent' everywhere
    -- 91 items carry DAMAGE_* fields that are all 0, and rendering 'Physical 0'
    for them would be noise."""
    if v is None or v == '':
        return False
    try:
        return float(v) != 0
    except (TypeError, ValueError):
        return True


def _num(v):
    """Numeric value of a field, or None. Zero and non-numeric both read as
    'absent', which is what every caller here wants -- 'melee' is not a number
    and 0 is not a quantity of anything."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f else None


def fmt(v):
    """140.0 -> '140', 0.56 -> '0.56'. Keeps whole numbers free of '.0'."""
    return '%g' % v


# Attack speed is seconds per swing. Every real value in the corpus sits in
# 0.4-1.68 -- 29 distinct values, each attested by alfgeir's own tooltips.
# Anything outside that is not a speed and is dropped rather than shown.
ATTACK_SPEED_MAX = 1.68

# The DAT stores attack speed raw; seconds are SPEED / divisor. An earlier
# version of this file concluded the field "means something else" on the 86
# items carrying 60-150 and dropped them. It does not -- it means exactly this,
# and the divisor was simply unknown. It is a constant per weapon TYPE, and it
# is measured rather than assumed: over the items both sources carry,
# SPEED/divisor reproduces TIDBI's rendered seconds to within 0.005 on all but
# three, and all three are the mislabelled items noted below rather than
# exceptions to the arithmetic.
#
# Note the divisor is NOT a 1H/2H split, which is a different axis: bows and
# crossbows are held in two hands but divide by 125 exactly like the
# one-handers, and rifles divide by 100. Fitting a two-handed rule onto them
# would move every bow in the corpus to a value TIDBI gets right.
SPEED_DIVISOR = {
    '1HAXE': 125.0, '1HMACE': 125.0, '1HSWORD': 125.0, 'FIST': 125.0,
    'WAND': 125.0, 'PISTOL': 125.0, 'BOW': 125.0, 'CROSSBOW': 125.0,
    '2HAXE': 83.3333, '2HMACE': 83.3333, '2HSWORD': 83.3333,
    'POLEARM': 83.3333, 'STAFF': 83.3333,
    'CANNON': 90.9091, 'RIFLE': 100.0,
}

# Longest-first, so 1HSWORD wins over SWORD and CROSSBOW over BOW.
SPEED_CLASS_TOKENS = (
    '1HAXE', '1HMACE', '1HSWORD', '2HAXE', '2HMACE', '2HSWORD',
    'CROSSBOW', 'POLEARM', 'PISTOL', 'CANNON', 'RIFLE', 'STAFF',
    'SWORD', 'MACE', 'BOW', 'AXE', 'WAND', 'FIST',
)

# Monster and NPC weapons carry a bare UNITTYPE with no 1H/2H tag ("SWORD",
# "AXE"). Polearm and staff are the two-handed ones there; axe, sword and mace
# are one-handed. Almost all of these are items TIDBI does not price at all, so
# this adds speeds rather than overriding any -- but it is a rule applied to a
# field that does not state the answer, so it is kept visible here.
BARE_CLASS = {'AXE': '1HAXE', 'SWORD': '1HSWORD', 'MACE': '1HMACE'}

# Two items carry a UNITTYPE that contradicts the weapon they actually are.
# sturm_polearm says NORMAL SWORD yet is a polearm -- TIDBI renders 1.20 s,
# which is the polearm rate (100 / 83 1/3); the sword rate would say 0.80.
# Polearm_Vanq01 says NORMAL AXE and is named a polearm, and the two sources
# disagree on it irreconcilably, so it is dropped from the site instead of
# being given a number neither source supports. See DROP_ITEMS.
SPEED_CLASS_OVERRIDE = {'sturm_polearm': 'POLEARM'}

# Not obtainable, not meaningful, and no source agrees on its class.
DROP_ITEMS = ('polearm_vanq01',)

# Tiers the browser does not render. "Unclassified" is what the pipeline calls
# an item TIDBI has no row for -- it means "no tier could be established", not
# that a tier of that name exists, and the set is overwhelmingly dev, test and
# monster-only units. They stay in items.json and items.csv, which are the
# fuller artifacts, but a player never sees them in game, so the page omits
# them. This hides them from the site only; nothing is lost from the data.
SITE_HIDDEN_TIERS = ('Unclassified',)

# How many pieces of a set a character can be wearing at once. The game's worn
# slots are listed in MEDIA/INVENTORY/ -- HEAD TORSO SHOULDERS GLOVES PANTS
# BOOTS BELT NECKLACE RING1 RING2 RIGHTHAND LEFTHAND -- so a ring fills two and
# a one-handed weapon fills two, everything else one. It is the number a ladder's
# top rung is built to: 52 of the 80 sets stop at exactly their capacity, and
# only Cornerstone's seven single-slot items go past it.
#
# This is not a set's record count, and the difference is the whole reason the
# ladder has a dimmed state worth drawing. Mondon's Vestment is 16 records across
# 9 item types worn as 10 pieces, so all three numbers differ; Twinferno is one
# wand with a 2-piece ladder, legible only once the second piece is understood to
# be the other hand.
ONE_HANDED = {'Sword', 'Axe', 'Mace', 'Dagger', 'Claw', 'Wand', 'Pistol', 'Fist'}


def capacity(types):
    return sum(2 if (t == 'Ring' or t in ONE_HANDED) else 1 for t in types)


# UNITTYPE tokens the corpus never agreed a display name for, so classify_type()
# hands these items to the old chain and their folder decides. All four are
# NOSPAWN monster attack props -- DISPLAYNAME "NOSPAWN_monster_tell Erich" or
# "NOSPAWN_base_tell Erich", RARITY 0 -- so all four are Unclassified and none
# reaches the site:
#
#   VarkolynFirst_1       FIST_ELECTRIC   filed under AXES/       -> Axe
#   VarkolynFirst_2       FIST_FIRE       filed under AXES/       -> Axe
#   vark_champ_spear      POLARARM_FIRE   filed under POLEARMS/   -> Polearm
#   vark_champ_spear_ele  POLARARM_ELE    filed under POLEARMS/   -> Polearm
#
# Their BASEFILEs (base_fist.dat, base_polearm.dat) and RESOURCEDIRECTORIES
# (_Fists, _polearms) agree with the tokens, so the tokens are probably right
# and the folders wrong -- POLARARM is the game's own spelling, and it is on the
# base spear as well as the _ele variant. TIDBI has no row for any of them and
# none of them renders, so no suffix rule is worth writing for four invisible
# records. They keep the class they have always had.
TOKEN_UNSEEN = ('Fist Electric', 'Fist Fire', 'Polararm Fire', 'Polararm Ele')


def speed_class(rec, name):
    """The weapon-class token SPEED_DIVISOR is keyed on, from the DAT's own
    UNITTYPE. None when the field names no weapon class we can price."""
    override = SPEED_CLASS_OVERRIDE.get((name or '').lower())
    if override:
        return override
    ut = (rec.get('UNITTYPE') or '').upper()
    if not ut:
        return None
    for tok in SPEED_CLASS_TOKENS:
        if tok in ut:
            return BARE_CLASS.get(tok, tok)
    return None


def derived_speed(rec, name):
    """Seconds per swing, from the DAT alone, or None when the item carries no
    SPEED or names no class the table covers."""
    cls = speed_class(rec, name)
    raw = _num(rec.get('SPEED'))
    if not cls or not raw or raw <= 0:
        return None
    secs = raw / SPEED_DIVISOR[cls]
    return secs if secs <= ATTACK_SPEED_MAX else None

DMG_TYPES = ('physical', 'fire', 'ice', 'electric', 'poison')

# Base damage by item level. No item DAT stores a rendered damage number -- the
# range is computed at spawn, and this curve is the piece of that computation
# the item files do not carry. It is a bare list of (level, damage) points, one
# pair per level for 1-105. The two members are spelled with their DEK hashes,
# 0x00000078 and 0x00000079, because dat_hash.FIELDS has no entry for them and
# decode() hands back an unknown member's hash rather than guessing a name.
GRAPH_WEAPON_DAMAGE = 'MEDIA/GRAPHS/STATS/BASE_WEAPON_DAMAGE.DAT'
# Armor by item level, the same shape. This is the graph the game scales player
# armor with; it is the only one in the PAK (the other *_BYLEVEL graphs are the
# monsters'), and its own NAME field calls it Armor_Player_byLevel_forSet.
GRAPH_ARMOR = 'MEDIA/GRAPHS/STATS/ARMOR_PLAYER_BYLEVEL_FORSET.DAT'
_graphs = {}


def graph_points(path):
    """{level: value} from one by-level graph DAT, parsed once per file. Empty if
    the graph is unreadable, in which case every item falls back to TIDBI and
    nothing renders a wrong number -- both derivations are always optional,
    never required."""
    if path not in _graphs:
        pts, lvl = {}, None
        try:
            rows = DD.decode(DD.read_pak_entry(path))[3]
        except Exception:
            rows = []
        for row in rows:
            if not (isinstance(row, (tuple, list)) and len(row) >= 4 and row[0] == 1):
                continue
            if row[1] == '0x00000078':
                lvl = _num(row[3])
            elif row[1] == '0x00000079' and lvl is not None:
                pts[lvl] = _num(row[3])
                lvl = None
        _graphs[path] = pts
    return _graphs[path]


def weapon_damage_curve():
    return graph_points(GRAPH_WEAPON_DAMAGE)


def armor_curve():
    return graph_points(GRAPH_ARMOR)


def derived_range(rec, curve):
    """The rendered min/max per damage type, computed from the DAT alone.

    nominal   = curve[LEVEL] x SPEED_DMG_MOD/100 x RARITY_DMG_MOD/100
                           x sum(DAMAGE_*)/100
    min_total = nominal x MINDAMAGE/100      (both are PERCENTAGES, and both
    max_total = nominal x MAXDAMAGE/100       are inherited from the base file)
    per type  = total x that type's share of the DAT's damage sum

    Returns {'physical': (lo, hi), ...} or None when the item cannot be derived
    -- a non-weapon, a level off the curve, or a missing field. The four
    modifiers default to 100 (no adjustment); in practice no computable weapon
    in the corpus is missing one, so the choice never changes a shipped value.

    The share is applied to the *total* and rounded per type, not rounded once
    and split: the game rounds each type independently, which is why the parts
    can sum to one more or less than the whole. int(x + .5) and not round(x) --
    see the note in the emit loop.
    """
    lvl = _num(rec.get('LEVEL'))
    if not lvl or lvl not in curve:
        return None
    dat = [_num(rec.get(k)) or 0.0 for k in DAMAGE_KEYS]
    tot = sum(dat)
    mn = _num(rec.get('MINDAMAGE'))
    mx = _num(rec.get('MAXDAMAGE'))
    if not (tot > 0 and mn and mx):
        return None
    nominal = (curve[lvl] * (_num(rec.get('SPEED_DMG_MOD')) or 100.0) / 100.0
               * (_num(rec.get('RARITY_DMG_MOD')) or 100.0) / 100.0 * tot / 100.0)
    lo, hi = nominal * mn / 100.0, nominal * mx / 100.0
    return {k: (int(lo * v / tot + 0.5), int(hi * v / tot + 0.5))
            for k, v in zip(DMG_TYPES, dat) if v}


def armor_ends(rec, curve):
    """The unrounded per-type (lo, hi) the armor formula produces, or None.

        armor_x = ARMOR_x x weight x mult / 1e6 x curve(LEVEL)

    Neither weight nor multiplier is stated on the item: both are inherited from
    the base armour file (see ARMOR_WEIGHT), which is why the pair has to arrive
    through the BASEFILE merge. Those base files come in three flavours, and the
    weight pair is the whole difference between a flat number and a range:

        BASEARMOR_AMULET.DAT          50 / 40   BASEARMOR_RING.DAT         34 / 26
        BASEARMOR_AMULET_MAGIC.DAT     -        BASEARMOR_RING_MAGIC.DAT      -
        BASEARMOR_AMULET_UNIQUE.DAT   45 / 45   BASEARMOR_RING_UNIQUE.DAT  30 / 30

    Where weight equals min-weight there is nothing to roll and both ends land on
    the same number, which is what most set jewellery shows.

    Left unrounded so the TIDBI cross-check can see how near a .5 boundary each
    end fell -- that distance is the whole explanation for the few hundred ends
    the two sources disagree on by a point, so it has to stay visible rather
    than be rounded away here. `derived_armor` is this plus the rounding.

    Returns {'fire': (lo, hi), ...} or None when the item cannot be derived -- no
    LEVEL, a level off the curve, or no weight and multiplier on the chain.
    """
    lvl = _num(rec.get('LEVEL'))
    if not lvl or lvl not in curve:
        return None
    w = _num(rec.get(ARMOR_WEIGHT))
    mu = _num(rec.get(ARMOR_MULT))
    if not (w and mu):
        return None
    lo_w = _num(rec.get(ARMOR_MIN_WEIGHT)) or w
    out = {}
    for k, t in zip(ARMOR_KEYS, DMG_TYPES):
        v = _num(rec.get(k))
        if v:
            out[t] = (v * lo_w * mu / 1e6 * curve[lvl],
                      v * w * mu / 1e6 * curve[lvl])
    return out or None


def derived_armor(rec, curve):
    """The rendered armor min/max per type, as ints -- armor_ends rounded.

    The same int(x + .5) as derived_range, for the same reason: the game rounds
    each type on its own, and Python's round() would take the halves to even.
    """
    ends = armor_ends(rec, curve)
    return {t: (int(lo + 0.5), int(hi + 0.5)) for t, (lo, hi) in ends.items()} \
        if ends else None


def tidbi_pair(t, pre, key):
    """TIDBI's rendered (min, max) for one damage/armor type, or None.

    TIDBI is the source of these numbers and the .DAT is only a fallback,
    because the DAT's DAMAGE_*/ARMOR_* fields are *pre-scale* values: the game
    multiplies them by level and difficulty at spawn time. Measured, the DAT's
    ARMOR_PHYSICAL equals TIDBI's rendered max in 3 of 2,114 cases -- they are
    different layers of the same data, and only TIDBI is what the player sees.

    The min is parsed here rather than through _num(), which reads 0 as
    'absent'. At this level 0 is a value: both Sturm Shields carry MIN_ARM_FIRE
    and MIN_ARM_ICE of 0 against a max of 1, and collapsing that to a flat 1
    would claim an armor the item does not have at the bottom of its range.
    Those four slots are the only ones in the corpus with a zero min and a real
    max -- and there are none at all with a blank min and a real max, so a max
    arriving on its own always means a flat value."""
    mx = _num(t.get('MAX_%s_%s' % (pre, key)))
    if not mx:
        return None
    raw = (t.get('MIN_%s_%s' % (pre, key)) or '').strip()
    if not raw:
        return (mx, mx)
    try:
        return (float(raw), mx)
    except ValueError:
        return (mx, mx)


def span(mn, mx):
    """The way the game writes a value: '140-174' when it varies, '100' when it
    does not. 3,086 of the 8,441 populated type slots are flat, 5,355 a range."""
    return fmt(mx) if mn == mx else '%s-%s' % (fmt(mn), fmt(mx))


# ------------------------------------------------------- augmented weapons
# 74 of the uniques are TL2's "Augmented Weapon" line: each carries a kill-count
# task, and finishing it unlocks 1-3 extra stats. TIDBI hands over the whole
# tooltip as one flat list, so task, unlocked stats and ordinary affixes arrive
# interleaved and all of them end up rendered as plain affixes -- which reads as
# though the unlockable stats were already on the weapon. They are not.
#
# The boundary is the dashed rule the game itself draws between the two groups.
# It is present on exactly the 74 items that carry an 'Augmented Weapon:'
# header, and on no other item in the corpus. Where the rule sits is trusted
# only when it follows the header, because on `ratkiller` its row id sorts below
# the header's and it lands first; there the block ends at the last row
# contiguous with the header instead. Both readings agree with the game, and
# ratkiller's near-twin `zombiesummoner` (same base stats, same task shape)
# confirms the split: it carries the same '90% Interrupt chance' affix, and for
# it the separator places that affix outside the block.
AUG_HEADER = 'augmented weapon:'
# Both tokens are stray field names, not stats, and they appear in the effect
# list of exactly one item -- the dev test sword zzz_testsword_augment_many.
AUG_JUNK = frozenset(('TRANSLATE', 'AFFIXES'))


def _dashes(t):
    """The game's in-tooltip group divider: a row of hyphens and nothing else."""
    return bool(t) and set(t) == {'-'}


def _keep(t):
    """True for a row that is real player-facing text: not a divider, not a
    stray field-name token, not blank."""
    t = t.strip()
    return bool(t) and not _dashes(t) and t not in AUG_JUNK


def split_effects(lines):
    """TIDBI's flat tooltip list -> (augments, affixes).

    `lines` is [(effect id, text)] as load_tidbi() hands it over. `augments` is
    a list of {'task': str, 'fx': [str, ...]} in tooltip order, empty for the
    6,103 items with no augmented block. A list rather than one block because a
    single item -- the dev sword zzz_testsword_augment_many -- chains three.
    """
    lines = sorted(lines)                    # by id, which is block order
    heads = [i for i, (_, t) in enumerate(lines)
             if t.strip().lower() == AUG_HEADER]
    if not heads:
        return [], [t.strip() for _, t in lines if _keep(t)]

    augs, taken = [], set()
    for h in heads:
        end = h
        # A block runs to the first of: the divider, the next block's header,
        # or the end of the rows contiguous with it.
        while end + 1 < len(lines):
            nid, ntx = lines[end + 1]
            if ntx.strip().lower() == AUG_HEADER or _dashes(ntx.strip()):
                break
            if nid != lines[end][0] + 1:
                break
            end += 1
        rows = [t.strip() for _, t in lines[h:end + 1] if _keep(t)]
        taken.update(range(h, end + 1))
        task = next((t for t in rows if 'upgrade' in t.lower()), '')
        augs.append({'task': task,
                     'fx': [t for t in rows[1:] if t != task]})
    rest = [t.strip() for i, (_, t) in enumerate(lines)
            if i not in taken and _keep(t)]
    return augs, rest


# A flat "+N <type> Damage" affix, as the tooltip prints it. Deliberately
# narrow, because the effect text is display strings and the near misses are
# common: "+N% to Fire Damage" and "+N% Wand and Staff Damage bonus" are
# percentages, "45 Physical Damage over 5 sec." is a damage-over-time rather
# than a per-hit bonus, "+N~N Physical Damage" is a pet tag (never on a weapon),
# and "Weapon: +N Fire Damage" is a socketable's grant, which the weapon may
# not have anything socketed into.
FLAT_DAMAGE = re.compile(r'^\+(\d+) (?:Physical|Ice|Fire|Electric|Poison) Damage$')


def flat_damage(lines):
    """Sum the flat "+N <type> Damage" affixes among a tooltip's effect lines.

    Every one of these is damage added to each hit, so the game counts it in the
    weapon's Damage per Second -- and the two independent sources this project
    is built on both miss it, which is why the number has to be assembled here
    rather than read off either one. TIDBI stores the affix (as `CDPS`, and in
    the effect text) but never adds it to its own DPS_ALL, which sums one
    per-type figure per damage type and stops. alfgeir's `dps` is not a scrape
    at all but alfgeir's own arithmetic: across all 461 weapons it carries, it
    is floor(avg / speed + .5) with zero exceptions -- the 13 that look like
    exceptions are every exact .5 case, where alfgeir rounds halves up and
    Python's round() does not. So neither source ever saw an affix, and neither
    can corroborate the formula. The Grimbone Wand's own tooltip does: it reads
    179, which is floor(148 / .96 + .5) + 25, and not the 180 that folding the
    25 into the damage before dividing would give.

    Only the affixes present from the start count. A weapon whose "+N Damage"
    arrives with its augmentation does not have it until the task is done -- the
    Bugstomper's own in-game tooltip shows no +58 Physical Damage while it reads
    "Kill 20 Spiders to Upgrade (0/20 killed)" -- so this is called with the
    base group only, never with split_effects()'s augments."""
    total = 0
    for line in lines:
        m = FLAT_DAMAGE.match(line.strip())
        if m:
            total += int(m.group(1))
    return total


# ------------------------------------------------------------- the ember pools
# The four rare ember families -- BLOOD, CHAOS, IRON and VOID EMBER, 7 ranks
# each -- are the only socketables whose two bonuses are not fixed. Their item
# DATs carry an empty AFFIXES list (`n_lists=0` on every rank file), and the
# game rolls one Armor/Trinket affix and one Weapon affix when the gem spawns.
# The pool those rolls come from is not declared anywhere: it is the set of
# affixes in MEDIA/AFFIXES/GEMS/ that name the family in their own applicability
# list. An affix is a candidate for a gem of level L when its `0xED6CBF91` list
# contains the gem's UNITTYPE and its [0xF5C798D8, 0x95C798C9] band contains L;
# which of the two columns it lands in is the same list -- ARMOR for the
# Armor/Trinket one, WEAPON for the weapon one. The `0x2BB67F8F` slot list is
# not consulted: it names all three slots on both sides of every family, and the
# one file that differs (GEM_UNIQUE_PERCENTLIFESTEAL, ARMOR+TRINKET only) is a
# weapon affix that the wiki puts in the weapon column, matching its
# applicability list rather than its slots.
#
# CHAOS EMBER is the family that can be derived: each of its 20 families ships
# seven files, one per band -- 1-13, 14-27, 28-41, 42-55, 56-69, 70-83, 84-999,
# matching the seven rank levels -- and each holds that band's value outright.
# Blood, Iron and Void do not: each of their affixes is one 1-999 file with a
# fixed float (Health 10, Armor 20, Mana 20) that the game scales by a per-stat
# multiplier this project cannot read. Their 42 values are transcribed in
# src/ember_values.py, which also says where from and why.
#
# The pool text follows the game's own tooltip wording, the same source every
# other effect line on this site comes from -- TIDBI's `texteffect`, which is
# the game's string to the character (the wiki's Normal-gems table lists 56
# values and all 56 match it). Three of the wiki's rare-gem lists disagree with
# the files, and the files win, as they do everywhere else here:
#   * its Armor/Trinket lists omit the Dodge option entirely, at all 7 ranks;
#   * its weapon lists give one Attack Speed option per rank, where the files
#     have two at every rank -- WEAPON_ATTACKSPEED is a 1-999 file (3%, all
#     ranks) beside a per-band one (3.5% at rank 1 rising to 6% at 6), so ranks
#     2-6 roll either;
#   * its rank-7 Attack Speed of 6.5% has no file at all (the last band file
#     stops at 70-83), so Giant Chaos Ember's weapon list carries the 3% option
#     and no more.
# One affix the wiki does not list is excluded by construction rather than by
# name: GEM_EYEOFGALLO_LIFESTEAL (666) also declares BLOOD EMBER + WEAPON, but
# it is The Eye of Gallo's own affix -- that UNIQUE SOCKETABLE names it in its
# AFFIXES list -- and TIDBI renders the item with two Weapon lines of its own.
# Blood's weapon pool is transcribed from the wiki, so it cannot pick the file
# up by accident.
GEMS_PREFIX = 'MEDIA/AFFIXES/GEMS/'
EMBER_TOKEN = 'CHAOS EMBER'
EMBER_RANKS = ember_values.RANK_LEVELS

# family -> (column, tooltip template, which effect member holds the value).
# The keys are the affix file's own name with the family prefix and any band
# number stripped. Most families carry the value under 0x0000BD6E; three do not,
# and a table is the honest way to say so -- knockback holds its amount under
# 0x0E46C025, knockback resistance under 0xE343B7AF, and silence prints the
# duration it carries as a string member of the effect list, not the 50-80
# chance beside it.
EMBER_VALUE_KEYS = {'v': '0x0000BD6E', 'kb': '0x0E46C025', 'kbr': '0xE343B7AF',
                    'dur': '0xE03B279B'}
EMBER_FAMILIES = {
    'ARMOR_DODGE':                  ('a', '+{v}% Dodge chance', 'v'),
    'ARMOR_MISSILEREFLECT':         ('a', '{v}% chance to reflect missiles at 50% weapon DPS', 'v'),
    'ARMOR_PERCENTARMOR':           ('a', '+{v}% to Physical Armor', 'v'),
    # This one prints a double negative -- "reduced by -3%" -- at every rank,
    # because the file's value is negative and the game's own line already
    # carries the "reduced by". TIDBI has the same string on the game's own
    # items (Quest_ManaVent_Acquire: "Physical Damage Taken is reduced by -3%"),
    # so it is the wording, not a sign that got flipped here.
    'ARMOR_PERCENTDAMAGE':          ('a', 'Physical Damage Taken is reduced by {v}%', 'v'),
    'ARMOR_PERCENTKNOCKBACKRESIST': ('a', '{v}% Knock Back Resistance', 'kbr'),
    'ARMOR_PERCENTPETARMOR':        ('a', '+{v}% pet and minion Armor', 'v'),
    'ARMOR_PERCENTPETDAMAGE':       ('a', '+{v}% pet and minion Damage', 'v'),
    'ARMOR_POTIONEFFICIENCY':       ('a', '+{v}% Potion effectiveness', 'v'),
    'ARMOR_SPEED':                  ('a', '{v}% faster movement speed', 'v'),
    'WEAPON_ATTACKSPEED':           ('w', '+{v}% Attack Speed', 'v'),
    'WEAPON_CASTSPEED':             ('w', '+{v}% Cast Speed', 'v'),
    'WEAPON_CRITCHANCE':            ('w', '+{v}% Critical Hit Chance', 'v'),
    'WEAPON_CRITDAMAGE':            ('w', '{v}% bonus to Critical Damage', 'v'),
    'WEAPON_DUALWIELD':             ('w', '{v}% Damage bonus when dual-wielding', 'v'),
    'WEAPON_EXECTUE':               ('w', '+{v}% chance to Execute', 'v'),
    'WEAPON_KNOCKBACK':             ('w', '+{v} Knockback', 'kb'),
    'WEAPON_MISSILERANGE':          ('w', '+{v}m to Bow, Crossbow, Pistol and Wand range', 'v'),
    'WEAPON_SILENCE':               ('w', 'Silence for {v} sec.', 'dur'),
    'WEAPON_SPLASH':                ('w', '+{v}% Damage to secondary targets', 'v'),
    'UNIQUE_PERCENTLIFESTEAL':      ('w', '{v}% Health stolen (% of dealt damage)', 'v'),
}
_pools = None


def _effect_members(rows):
    """{member name: value} for the first effect list in a decoded affix.

    Names are the DAT's own -- `TYPE`, or a DEK hash for the stat's value
    members -- so a caller keyed on EMBER_VALUE_KEYS can reach the one it wants.
    The two floats sharing a value (0x0000BD6E, 0x0000BC78) collapse here, which
    is the point: they are the same number written twice."""
    cur, out = None, {}
    for r in rows:
        if r[0] == 0 and str(r[2]).startswith('list'):
            cur = r[1] if r[1] == '0x0E421C35' else None
            continue
        if r[0] == 1 and cur:
            out[r[1]] = r[3]
    return out


def ember_pools():
    """{unittype: {'a': [per-rank options], 'w': [...]}} for all four families.

    Chaos is read from the PAK; the other three come from ember_values.py. Each
    list is indexed by rank -- 0 is rank 1 -- and holds whole tooltip lines."""
    global _pools
    if _pools is not None:
        return _pools
    band, ok = {}, set()
    for p in sorted(DD.pak_index()):
        u = p.upper()
        if not (u.startswith(GEMS_PREFIX) and u.endswith('.DAT')):
            continue
        rows = DD.decode(DD.read_pak_entry(p))[3]
        scalar = {r[1]: r[3] for r in rows if r[0] == 0}
        app, cur = [], None
        for r in rows:
            if r[0] == 0 and str(r[2]).startswith('list'):
                cur = r[1] if r[1] == '0xED6CBF91' else None
                continue
            if r[0] == 1 and cur:
                app.append(r[3])
        if EMBER_TOKEN not in app:
            continue
        fam = re.sub(r'\d+$', '', p.split('/')[-1][:-4].upper())
        fam = re.sub(r'^GEM_(?:CHAOSEMBER_)?', '', fam)
        assert fam in EMBER_FAMILIES, 'unmapped ember affix: %s' % p
        col, tpl, vk = EMBER_FAMILIES[fam]
        assert col == ('w' if 'WEAPON' in app else 'a'), \
            'ember affix %s moved columns: %s' % (fam, app)
        members = _effect_members(rows)
        val = members[EMBER_VALUE_KEYS[vk]]
        lo, hi = int(scalar['0xF5C798D8']), int(scalar['0x95C798C9'])
        ok.add(fam)
        for i, lvl in enumerate(EMBER_RANKS):
            if lo <= lvl <= hi:
                band.setdefault(i, {'a': [], 'w': []})[col].append(tpl.replace('{v}', val))
    assert ok == set(EMBER_FAMILIES), \
        'ember affix family never seen: %s' % sorted(set(EMBER_FAMILIES) - ok)
    chaos = {'a': [band[i]['a'] for i in range(len(EMBER_RANKS))],
             'w': [band[i]['w'] for i in range(len(EMBER_RANKS))]}
    _pools = {'CHAOS EMBER': chaos}
    _pools.update(ember_values.FAMILIES)
    return _pools


def load_pak_items():
    """Decode every item DAT and resolve BASEFILE inheritance."""
    index = DD.pak_index()
    paths = sorted(p for p in index
                   if p.startswith(ITEMS_PREFIX) and p.endswith('.DAT'))
    cache = {}

    def fields(path):
        if path not in cache:
            try:
                cache[path] = scalar_fields(path) if path in index else {}
            except Exception:
                cache[path] = {}
        return cache[path]

    recs = []
    for p in paths:
        own = dict(fields(p))
        # walk the base chain; own values always win
        merged, seen, cur = dict(own), {p}, own.get('BASEFILE')
        while cur:
            nxt = norm_path(cur)
            if nxt in seen:
                break
            seen.add(nxt)
            f = fields(nxt)
            if not f:
                break
            for k, v in f.items():
                merged.setdefault(k, v)
            cur = f.get('BASEFILE')
        merged['_path'] = p
        rel = p[len(ITEMS_PREFIX):]
        merged['_folder'] = rel.split('/')[0] if '/' in rel else '(root)'
        merged['_own'] = own
        recs.append(merged)
    return recs


def load_set_defs():
    """Read every set file once: its display name, and its bonus thresholds.

    Returns (names, thresholds), both keyed on the set's DAT token.

    An item's SET field is a bare token -- SENTINAL, U_GRAND_ARCHITECT,
    BERSERKER_FINAL -- which is not a name. SENTINAL is not even spelled right.
    The name lives in that set's own file under MEDIA/SETS/, whose NAME field
    carries the token and whose DISPLAYNAME carries what the game shows:
    Sentinel, Cornerstone, Harbinger.

    Keyed on NAME and not on the filename, because the two differ: the set token
    STURMBEORN is defined in TL2_STURMBEORN.DAT, and matching by filename misses
    it. All 88 files declare a distinct NAME, so the key is unambiguous. The
    `_BIG` variants name themselves `<token>_BIG`, so they cannot shadow a token
    an item actually references.

    TIDBI carries the same names in its sets.csv and agrees on 73 of the 80
    tokens this corpus uses. It disagrees on two (ASPHYX: "The Asphyx" against
    "Asphyx", GHASTLY: "Haunt" against "Ghastly") and its export turned the
    apostrophe in five more into a backtick ("Xtro`s Blades"). The DAT is the
    game's own data, so it wins on all seven.

    The thresholds come out of the same walk because they live in the same
    files, as AFFIX triples: the unnamed field 0x0E16DD94 is the piece count the
    rung needs, 0xF4C3B4CE is an affix level, and the AFFIX field names the affix
    to grant. The two unnamed hashes are left unnamed in dat_hash.FIELDS on
    purpose -- they are a *list element's* shape, not a field of the set, and
    naming them there would claim they are something a set declares.
    """
    index = set(DD.pak_index())
    names, thresholds = {}, {}
    for p in sorted(p for p in index
                    if p.startswith(SETS_PREFIX) and p.endswith('.DAT')):
        scal = scalar_fields(p)
        tok = (scal.get('NAME') or '').strip().upper()
        if not tok:
            continue
        # AFFIX is a list(3) per rung, so its three members arrive as three
        # consecutive rows: the count, the affix level, then the affix name that
        # closes the list. Tracking the count until the next list opens is what
        # keeps a rung's number attached to its own affix and not the next one's.
        rungs, cur = [], None
        for t in DD.decode(DD.read_pak_entry(p))[3]:
            if t[0] == 0 and t[1] == 'AFFIX':
                if cur is not None:
                    rungs.append(cur)
                cur = None
            elif t[0] == 1 and t[1] == '0x0E16DD94':
                cur = int(t[3])
        if cur is not None:
            rungs.append(cur)
        if rungs:
            thresholds[tok] = sorted(set(rungs))
        disp = (scal.get('DISPLAYNAME') or '').strip()
        if disp:
            names[tok] = disp
    return names, thresholds


def load_set_bonuses():
    """Map each set's DAT token to its per-piece-count bonus ladder.

    The DAT holds the ladder's *shape* and TIDBI holds its *words*, and neither
    carries both. A set file under MEDIA/SETS/ lists one AFFIX triple per rung --
    piece count, affix level, affix name (SET_CAST_SPEED2) -- so the thresholds
    are the game's own; but the affix files it names are mechanical. Reading
    SET_CAST_SPEED2's own DAT gives a TYPE of "PERCENT CAST SPEED" and a value,
    not the "+6% Cast Speed" the player sees, and rendering that is the same job
    as rendering item affixes, which this pipeline already declines to do: item
    affix text comes from TIDBI's effects.csv, and set bonus text comes from
    TIDBI's sets.csv the same way.

    Rows are grouped by piece count because one rung can carry several lines --
    Aristocrat's 4-piece bonus is four separate elemental bonuses. Order within
    a rung is TIDBI's own row order, which is stable in the export and is the
    order the game prints them in.

    The thresholds are cross-checked against the DATs in build(). They agree on
    all 80 tokens today, which is the point of asserting it: TIDBI alone could
    not tell us if a rung were missing, since a set with one fewer row is a
    perfectly well-formed ladder.
    """
    out = collections.OrderedDict()
    for r in read_csv(os.path.join(CSV, 'sets.csv')):
        tok = (r.get('item') or '').strip().upper()
        tx = _decimal((r.get('texteffect') or '').strip())
        try:
            cnt = int(r.get('countset') or 0)
        except ValueError:
            cnt = 0
        if not tok or not tx:
            continue
        # A rung below 2 pieces would be an ordinary affix printed as though
        # wearing the piece unlocked it, so it gets no filter here -- build()
        # asserts that none reaches a ladder. Dropping one silently would be
        # worse than either: the DAT agreement check would still fire, but as a
        # mismatch against a threshold the set file really declares, which reads
        # as the DAT being wrong rather than this loop.
        rungs = out.setdefault(tok, collections.OrderedDict())
        rungs.setdefault(cnt, []).append(tx)
    return {tok: [[c, ts] for c, ts in sorted(rungs.items())]
            for tok, rungs in out.items()}


def read_csv(path):
    with open(path, encoding='utf-8-sig') as fh:
        return list(csv.DictReader(fh))


def _apos(s):
    """The 2014 Access export mangles apostrophes to backticks. Exactly two keys
    are affected -- "BROM`S ROUGHHIDE TONIC" and "OVERSEER`S EYE" -- and both
    fail to join against the DAT's real apostrophe, stranding two potions as
    Unclassified with no icon and no effect text. Fold them so the join sees
    what the game does."""
    return s.replace('`', "'")


# A comma between two digits. See _decimal() for why that is a decimal point
# and not a list separator; build() asserts on this same pattern at the end, so
# the fold and the check cannot come to disagree about what they are looking for.
DECIMAL_COMMA = re.compile(r'(?<=\d),(?=\d)')


def _decimal(s):
    """The same export writes decimals the way its locale does: `-1,1%` where
    the game prints `-1.1%`. A reader sees `-7,5%` as a typo, and a spreadsheet
    reads it as text, so it is folded here rather than left for the browser.

    Four values are affected today -- 1,1 / 1,5 / 4,5 / 7,5, all of them
    physical-damage-taken lines -- across 43 effect rows and 4 set rows. They
    are also the whole of the problem: the corpus prints the same kind of value
    both ways, so the page was showing "+3.5% Attack Speed" beside "-7,5%
    Physical Damage Taken", the points arriving from the game's own DAT text and
    the commas from TIDBI.

    Digit-comma-digit, anchored on both sides. The digits are the whole of the
    safety argument: no string in this corpus carries a thousands separator, so
    a comma with digits on both sides is a decimal point in every case there is,
    and a comma that separates a list never has one."""
    return DECIMAL_COMMA.sub('.', s)


def load_tidbi():
    items = read_csv(os.path.join(CSV, 'items.csv'))
    by_name = {}
    for r in items:
        k = _apos((r.get('ConsolNAME') or '').strip().upper())
        if k:
            by_name[k] = r
    effects = {}
    for r in read_csv(os.path.join(CSV, 'effects.csv')):
        it = _apos((r.get('item') or '').strip().upper())
        tx = _decimal((r.get('texteffect') or '').strip())
        if it and tx and tx.upper() != 'BLANK_NO_EFFECTS':
            # the row id is carried through, not just the text: it is what
            # split_effects() uses to tell a block's own rows from the affixes
            # that merely happen to sit nearby in the tooltip (see below)
            effects.setdefault(it, []).append((int(r['id']), tx))
    return by_name, effects


def load_alfgeir():
    if not os.path.exists(ALFGEIR):
        return {}
    with open(ALFGEIR, encoding='utf-8') as fh:
        return {a['tag'].upper(): a for a in json.load(fh) if a.get('tag')}


# ------------------------------------------------------------------------ icons

def load_icons():
    names = {}
    for f in sorted(os.listdir(ICON_DIR)):
        if f.lower().endswith('.png'):
            names[os.path.splitext(f)[0].lower()] = os.path.join(ICON_DIR, f)
    return names


def build_sheet(icon_files, cols=33):
    """Pack every icon into one sheet at native size.

    1,052 of the 1,053 are 45x45 (one stray 44x44), so the cell is sized to the
    largest and the odd one is pasted at the cell origin. A 2x sheet would be
    13.5 MB and is a non-starter, so there is no scale-up here."""
    keys = sorted(icon_files)
    imgs = {k: Image.open(icon_files[k]).convert('RGBA') for k in keys}
    cw = max(i.width for i in imgs.values())
    ch = max(i.height for i in imgs.values())
    rows = (len(keys) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cw, rows * ch), (0, 0, 0, 0))
    coords = {}
    for i, k in enumerate(keys):
        x, y = (i % cols) * cw, (i // cols) * ch
        sheet.paste(imgs[k], (x, y))
        coords[k] = [x, y, imgs[k].width, imgs[k].height]
    buf = io.BytesIO()
    # Lossless WebP, not PNG: 4.46 MB -> 3.63 MB for the same pixels, and the
    # sheet is 92% of what a visitor downloads, since brotli already undoes the
    # base64 expansion exactly -- inlining it costs nothing, so the sheet's own
    # encoding is the whole of the payload.
    #
    # `exact=True` is what makes the decode bit-identical: without it libwebp is
    # free to rewrite the RGB under fully transparent pixels, which is invisible
    # but no longer lossless. The assert below pins that, because "lossless" is
    # the entire reason this format was chosen and a Pillow default moving under
    # us would otherwise ship the game's art silently re-encoded.
    sheet.save(buf, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    data = buf.getvalue()
    with Image.open(io.BytesIO(data)) as back:
        assert back.convert('RGBA').tobytes() == sheet.tobytes(), \
            'the sheet did not survive the webp encode unchanged'
    return data, coords, (cols * cw, rows * ch)


# ------------------------------------------------------------------------ build

def build():
    print('loading PAK item DATs ...')
    recs = load_pak_items()
    print('  %d items, %d decode failures' % (len(recs), 0))

    tidbi, effects = load_tidbi()
    alf = load_alfgeir()
    icon_files = load_icons()
    print('  TIDBI %d rows, %d effect sets; alfgeir %d tags; %d icon files'
          % (len(tidbi), len(effects), len(alf), len(icon_files)))
    curve = weapon_damage_curve()
    armor_c = armor_curve()
    print('  BASE_WEAPON_DAMAGE curve: %d levels; armor curve: %d levels'
          % (len(curve), len(armor_c)))
    set_names, set_thr = load_set_defs()
    set_bonus = load_set_bonuses()
    print('  %d set definitions, %d with bonus text'
          % (len(set_names), len(set_bonus)))

    # --- icon resolution: own ICON -> TIDBI ICON -> sibling in same family ---
    def icon_for(rec, t):
        for cand in (rec.get('ICON'), (t.get('ICON') or '').strip()):
            if cand and cand.lower() in icon_files:
                return cand.lower()
        return None

    def family(rec):
        rd = (rec.get('RESOURCEDIRECTORY') or '').replace(BS, '/').rstrip('/').lower()
        mf = (rec.get('MESHFILE') or '').lower()
        return (rd, mf) if rd or mf else None

    items = []
    for rec in recs:
        name = rec.get('NAME') or ''
        t = tidbi.get(name.upper(), {})
        a = alf.get(name.upper(), {})
        items.append({
            'rec': rec, 'tidbi': t, 'alf': a, 'name': name,
            'icon': icon_for(rec, t), 'family': family(rec),
        })

    # inherit: any sibling sharing (resourcedir, meshfile) that resolved an icon
    donor, donor_rd = {}, {}
    for it in items:
        if it['icon'] and it['family']:
            donor.setdefault(it['family'], it['icon'])
            donor_rd.setdefault(it['family'][0], it['icon'])
    inherited = 0
    for it in items:
        if it['icon'] or not it['family']:
            continue
        got = donor.get(it['family']) or (donor_rd.get(it['family'][0]) if it['family'][0] else None)
        if got:
            it['icon'] = got
            it['inherited'] = True
            inherited += 1
    print('  icons: %d own/tidbi + %d inherited = %d of %d items'
          % (len(items) - inherited - sum(1 for i in items if not i['icon']),
             inherited, sum(1 for i in items if i['icon']), len(items)))

    # --- the UNITTYPE token table ---
    # Read off the corpus rather than declared, so it describes the data it is
    # applied to. Both assertions are drift alarms: a second ambiguous token
    # means a new slot has appeared that no source can name, and an unseen token
    # means a new one has appeared at all.
    tokens = token_names(items)
    _split = {k: len(v) for k, v in tokens.items() if len(v) > 1}
    assert _split == {'Potion': 2}, 'ambiguous UNITTYPE token(s): %s' % _split
    print('  UNITTYPE: %d tokens, %d ambiguous (%s)'
          % (len(tokens), len(_split), ', '.join(sorted(_split))))

    # --- emit records ---
    # 85 of the 6,262 DATs are abstract bases: 78 with no NAME at all
    # (BASE_2HAXE, BASEARMOR_CHEST, ...) and 7 that do carry one but are still
    # templates (base_cannon, base_fist, base_rifle_NOSKILL). None are
    # obtainable or ever shown in game; they exist to be inherited *from*. They
    # stay in the icon-donor pool above but are not items.
    out, skipped_stat, templates, dropped = [], 0, [], []
    slot_status = collections.Counter()
    classified = set()             # UNITTYPE tokens the classifier actually saw
    set_tokens = set()             # SET tokens the items actually reference
    arm_drift = []                 # derived armor vs TIDBI, for the check below
    for it in items:
        rec, t, a = it['rec'], it['tidbi'], it['alf']
        name = it['name']
        if not name or name.lower().startswith('base_'):
            templates.append(rec['_path'])
            continue
        # An item no source can agree on is left out rather than given a
        # number. See DROP_ITEMS for what Polearm_Vanq01's disagreement is.
        if name.lower() in DROP_ITEMS:
            dropped.append(name)
            continue
        # display name ladder
        dn = rec.get('DISPLAYNAME') or ''
        if dn and not dn.startswith('NOSPAWN'):
            disp, nsrc = dn, 'dat'
        elif a.get('name'):
            disp, nsrc = a['name'], 'alfgeir'
        elif name:
            disp, nsrc = titleize(name), 'derived'
        else:
            disp, nsrc = '(unnamed)', 'none'

        typ = classify_type(rec, rec.get('_folder'), t, a, tokens)
        classified.add(canon_type(rec.get('UNITTYPE')))
        o = {
            'id': name,
            'n': disp,
            't': typ or 'Unclassified',
            'c': CATEGORY.get(typ or '', 'Misc'),
            'q': classify_tier(rec, t, a),
        }
        # The rarity SET promotion displaced. Set is a membership, not a
        # rarity: the game paints these items in the colour of what they
        # actually are -- Rare blue, Unique orange -- and prints "Unique Set
        # Belt", so the site needs both words. Only set items carry it, which
        # is what makes `uq` a safe key to branch on.
        if o['q'] == 'Set':
            o['uq'] = base_tier(rec, t, a)
        if nsrc != 'dat':
            o['ns'] = nsrc
        for k, src in (('LEVEL', 'lv'), ('MINLEVEL', 'ml'), ('MAXLEVEL', 'xl'),
                       ('RARITY', 'rar'), ('SOCKETS', 'sk'), ('MAX_SOCKETS', 'skm'),
                       ('RANGE', 'rng')):
            if nonzero(rec.get(k)):
                o[src] = rec[k]
        # LEVEL_REQUIRED is its own field -- not LEVEL, not MINLEVEL. TIDBI has
        # it for 5,474 items against the DAT's 844, and the two disagree in 429
        # of the 810 cases where both exist, again because the DAT holds a
        # pre-scale value. (TIDBI's iLEVEL is the item's level and matches the
        # DAT's LEVEL in all 5,945 cases where both exist, so lv/ml need no
        # such treatment.)
        lr = _num(t.get('LEVEL_REQUIRED')) or _num(rec.get('LEVEL_REQUIRED'))
        if lr:
            o['lr'] = fmt(lr)
        rq = {}
        for k, src in (('STRENGTH_REQUIRED', 'str'), ('DEXTERITY_REQUIRED', 'dex'),
                       ('MAGIC_REQUIRED', 'mag'), ('DEFENSE_REQUIRED', 'def')):
            v = _num(t.get(k)) or _num(rec.get(k))
            if v:
                rq[src] = fmt(v)
        if rq:
            o['rq'] = rq

        # Class restriction. The DAT has no field for this at all -- it is not
        # among the 64 unnamed hashes' known names either -- so it comes from
        # TIDBI's REQ_CLASS (767 items) with alfgeir as fallback. The two agree
        # on all 758 items where both exist, and the vocabulary is exactly the
        # four player classes: Embermage, Outlander, Berserker, Engineer.
        cls = (t.get('REQ_CLASS') or '').strip() or (a.get('ClassRequirement') or '').strip()
        if cls:
            o['cls'] = cls

        # Effect text, split into the flat tooltip list and the augmented
        # blocks. Resolved here rather than beside the other effect handling
        # below because the dps needs the flat "+N Damage" affixes out of it --
        # they are per-hit damage and belong in the weapon's Damage per Second.
        fx = effects.get(name.upper())
        augs, affixes = split_effects(fx) if fx else ([], [])
        flat = flat_damage(affixes)

        # A weapon's damage range and an armour piece's armor are both
        # RECONSTRUCTED from the DAT (derived_range, derived_armor) -- the files
        # are the source and TIDBI is the cross-check. Where a derivation is
        # impossible it falls back to TIDBI's rendered min/max, and where TIDBI
        # has nothing either, to the DAT's raw scalar -- those last are flagged
        # vb so the page can say the number is a pre-scale base value rather
        # than pass it off as rendered. See the dps note below for why the
        # derived value outranks TIDBI's where the two disagree, and the armor
        # drift check at the end of the build for what the two cost each other.
        dmg, arm, base, dmg_avg = {}, {}, False, 0.0
        dv = derived_range(rec, curve)
        if dv:
            o['dv'] = 1
            for k, (lo, hi) in dv.items():
                dmg[k] = span(lo, hi)
                dmg_avg += (lo + hi) / 2.0
        else:
            for k in DMG_TYPES:
                p = tidbi_pair(t, 'DMG', k.upper())
                if p:
                    dmg[k] = span(*p)
                    dmg_avg += (p[0] + p[1]) / 2.0
                    continue
                v = _num(rec.get('DAMAGE_' + k.upper()))
                if v:
                    dmg[k], base = fmt(v), True
        da = derived_armor(rec, armor_c)
        if da:
            o['da'] = 1
            ends_f = armor_ends(rec, armor_c)
            for k, ends in da.items():
                arm[k] = span(*ends)
                p = tidbi_pair(t, 'ARM', k.upper())
                if p and p != ends:
                    arm_drift.append((name, o['t'], p, ends, ends_f[k]))
        else:
            for k in DMG_TYPES:
                p = tidbi_pair(t, 'ARM', k.upper())
                if p:
                    arm[k] = span(*p)
                    continue
                v = _num(rec.get('ARMOR_' + k.upper()))
                if v:
                    arm[k], base = fmt(v), True
        if dmg:
            o['dmg'] = dmg
        if arm:
            o['arm'] = arm
        if base:
            o['vb'] = 1

        # Speed is derived from the DAT where the item names a class the
        # divisor table covers, which is nearly all weapons; TIDBI is the
        # fallback and not the source. The two agree everywhere except
        # legendary2_sword05, where the DAT says 0.64 s and TIDBI 0.96 s, and
        # the DAT is right: it is a one-handed sword (its own UNITTYPE and its
        # two children both say so) and 0.96 is the two-handed rate, so TIDBI
        # had classified it by the wrong hand.
        sp = derived_speed(rec, name) or _num(t.get('SPEED'))
        if sp and sp <= ATTACK_SPEED_MAX:
            o['sp'] = fmt(sp)
            # dps is the average of the rendered damage range over the seconds
            # per swing, plus any flat "+N Damage" the item carries from the
            # start (see flat_damage()). That last part is this project's own
            # and is what the game does; alfgeir's `dps` is its own arithmetic
            # and omits it, so the two agree on the weapons with no such affix
            # and deliberately part company on the rest. A dps needs a rendered
            # range, so a base-value weapon gets none.
            #
            # int(x + .5), not round(x): Python rounds halves to even, so
            # round(162.5) is 162 where the game shows 163. Values are positive,
            # so the naive form is safe. The +.5 is not decoration -- it changes
            # 618 of the 1,273 values derived here.
            #
            # Two sources put this form on the game itself. alfgeir's stated dps
            # is int(mean/speed + .5) on all 461 weapons it carries. And the
            # wiki's Longfang tooltip reads 294 against damage lines of
            # 85-170 / 28-56 / 28-56 at 0.72 s: mean 211.5 / 0.72 = 293.75, so
            # 294 is half-up where floor says 293. That tooltip is a check on the
            # RULE, not on our magnitude -- we render 296, off by the same ~1%
            # balance-curve drift as the Grimbone's 180-vs-179 -- but it settles
            # the rule cleanly, since 293.75 lies either side of no other
            # boundary.
            #
            # TIDBI is not the tiebreak here, and reading it as one is a trap.
            # QItems does carry a dps (DPS_ALL, 1,276 rows -- it is a saved
            # query, so it is in QItems.csv and not in items.csv, which is why
            # an earlier pass concluded it did not exist). But DPS_ALL is
            # TIDBI's own arithmetic and rounds EACH DAMAGE TYPE before adding:
            # over the 1,273 weapons that join to TIDBI and carry a speed, that
            # per-type order reproduces DPS_ALL 1,231 times against 1,048 for
            # this single-rounding rule -- and 42 that neither reaches. Cut to
            # the 1,208 derived weapons with no flat affix the contrast is 1,081
            # against 930, with floor down at 585. TIDBI is simply
            # self-consistent in a quirk the game does not share -- the game
            # rounds the total once -- so chasing its number would fit TIDBI
            # rather than the game. Use it as a sanity check, not a target:
            # this rule still reproduces DPS_ALL four times in five.
            #
            # `flat` is then added as a whole number, not divided by the attack
            # time, which is what the game does: see flat_damage(). Writing it
            # the other way round -- add the flat, round once at the end -- is
            # NOT a different rule: flat_damage() returns an int, so
            # int(x + .5) + flat == int(x + flat + .5) identically, for every
            # item. Measured against each other the two orderings change 0 of
            # the 1,351 dps values. What the flat must not do is go in *before
            # the division* -- that is what would make the Grimbone 180.
            if dmg_avg:
                o['dps'] = int(dmg_avg / sp + 0.5) + flat
        # provenance: only meaningful on the base-value path. A rendered number
        # comes from TIDBI and has no BASEFILE behind it, so this says of a
        # fallback number whether it sat on this item's own DAT fields or was
        # reached by walking the chain.
        own = rec['_own']
        if base and not any(nonzero(own.get(k)) for k in DAMAGE_KEYS + ARMOR_KEYS):
            o['inh'] = 1
        if rec.get('SET'):
            # The DAT's SET is a token; the game prints the set file's
            # DISPLAYNAME instead. Keep the token as setid -- it is the only
            # route back to MEDIA/SETS/<token>.DAT, which is where the set's
            # per-piece-count bonuses live, and this site does not show those.
            tok = rec['SET'].strip().upper()
            o['set'] = set_names.get(tok, rec['SET'])
            o['setid'] = rec['SET']
            set_tokens.add(tok)
        if rec.get('DESCRIPTION'):
            o['ds'] = rec['DESCRIPTION']
        if rec.get('UNITTYPE'):
            o['ut'] = rec['UNITTYPE']
        # Effect text, already split above. For the 74 augmented weapons this is
        # two groups, not one flat list -- see split_effects().
        #
        # 143 items carry the slot a line belongs to as a `Weapon:` /
        # `Armor/Trinket:` prefix in the text rather than as structure. That
        # prefix is the game's own label, and the card was printing it as if it
        # were part of the effect, so it is stripped here and the slot written
        # beside the line as `fxs` instead. The answer comes from the item's
        # AFFIXES order, with TIDBI's prefixes as the fallback -- see slots.py.
        #
        # The strip is HERE, not where `affixes` is built, and that placement is
        # load-bearing: FLAT_DAMAGE is anchored `^+N <type> Damage$`, so the
        # prefix is what keeps a socketable's flat damage out of the weapon's
        # dps. flat_damage() ran on the prefixed strings back at `flat =` above.
        #
        # Every socketable is derived, not just the ones TIDBI prefixed. Two of
        # them -- Lucky Coin and Lucky Die rank 1 -- have no prefix on their
        # single line, and scoping by prefix alone would leave those two as the
        # only members of their families with no slot label. Outside the
        # socketables this fires exactly once, on a quest item.
        if affixes:
            if o.get('t') == 'Socketable' or any(slots.HEAD.match(ln)
                                                 for ln in affixes):
                pairs = slots.attribute(rec['_path'], affixes)
                o['fx'] = [ln for _, ln in pairs]
                o['fxs'] = [sl for sl, _ in pairs]
                slot_status[slots.status(rec['_path'], affixes)] += 1
            else:
                o['fx'] = affixes
        if augs:
            o['aug'] = augs
        # The 28 rare ember ranks -- 4 families x 7 -- get their two option
        # lists here. Keyed on the UNITTYPE and the level, which is all the gem
        # itself says: only these four tokens carry a pool, and the four BASE
        # templates that share them have no LEVEL, so they fall out on the
        # lookup rather than needing to be excluded. See ember_pools().
        pool = ember_pools().get((rec.get('UNITTYPE') or '').strip().upper())
        lvl = int(_num(rec.get('LEVEL')) or 0)
        if pool and lvl in ember_values.RANK_LEVELS:
            i = ember_values.RANK_LEVELS.index(lvl)
            o['ep'] = {'a': pool['a'][i], 'w': pool['w'][i]}
        if it['icon']:
            o['ic'] = it['icon']
            if it.get('inherited'):
                o['ici'] = 1
        # provenance: which source supplied the numbers
        o['p'] = rec['_path']
        if rec.get('UNIT_GUID'):
            o['g'] = rec['UNIT_GUID']
        if not (dmg or arm):
            skipped_stat += 1
        out.append(o)

    # Every token the classifier met must either have a name in the table, be a
    # name itself, or be one of the four TOKEN_UNSEEN props. A new one means a
    # new slot has appeared that no source can name -- which is what sent
    # petcollar_n13b to the TL2ARMOR folder in the first place, so it is worth
    # failing the build over rather than discovering on the site.
    _unseen = classified - set(tokens) - set(CATEGORY) - {None}
    assert _unseen == set(TOKEN_UNSEEN), \
        'unseen UNITTYPE token(s) drifted: %s' % sorted(_unseen)
    print('  UNITTYPE: %d seen, %d unseen (%s)'
          % (len(classified) - 1, len(_unseen), ', '.join(sorted(_unseen))))

    # Every SET token an item names must have resolved to a display name. An
    # unresolved one is not a cosmetic loss: the row would print a raw token like
    # U_GRAND_ARCHITECT where the game prints "Cornerstone", which is the bug
    # this lookup exists to remove -- so a token the lookup cannot find means the
    # game has a set defined somewhere this pipeline does not look, and the
    # fallback would hide it on the site rather than fail here.
    _unnamed = set_tokens - set(set_names)
    assert not _unnamed, 'unresolved SET token(s): %s' % sorted(_unnamed)
    print('  SET: %d tokens, all named (%d definitions on disk)'
          % (len(set_tokens), len(set_names)))

    # Every set item's own rarity, which the site prints beside the Set tag and
    # paints the item with. All 556 resolve to Rare or Unique, and nothing else
    # is possible: a set piece tiered Normal would be a set with no rarity at
    # all, and one tiered Set would be base_tier's `_set` name fallback firing --
    # meaning the item has no TIDBI row and no `_u`/`_m`/`_n` marker, so its
    # rarity is being read off the fact that it is in a set, which is circular.
    # Pinned as a distribution, since a shift between the two would recolour
    # hundreds of cards and 210/346 is the split TIDBI states.
    _uq = collections.Counter(o['uq'] for o in out if 'uq' in o)
    assert _uq == {'Rare': 210, 'Unique': 346}, \
        'set item rarities drifted: %s' % dict(_uq)
    assert not [o for o in out if ('uq' in o) != (o['q'] == 'Set')], \
        'uq and the Set tier must travel together'

    # Derived armor against TIDBI's rendered numbers -- the only independent
    # check the derivation has, and the reason TIDBI is still read at all now
    # that the game files answer the question. Per armor type, over the items
    # the derivation reaches and TIDBI also prices:
    #
    #   3,674 pairs   agree to the point
    #     200 pairs   one end off by exactly one
    #     110 pairs   TIDBI's flat number against a real range (33 items)
    #
    # The 200 are an artefact of where the value falls, not of the formula: 193
    # of those 400 ends land within a thousandth of a .5 boundary, where the
    # game's own arithmetic and this float64 model part ways by one. That is
    # also why the ends arrive here unrounded -- the distance to the boundary is
    # the evidence, and it is what the third assertion reads.
    #
    # The 110 are set jewellery: the files hold the spread the game prints and
    # TIDBI a single number, flat, on all 110. Two of the 33 (Formal Regent
    # Signet, Highridge Talisman) are impossible under any weight x multiplier
    # at their level, which is what settles that TIDBI's number is a capture of
    # one roll rather than a different rounding of the same formula -- and so
    # that the range is the right thing to print.
    #
    # Pinned as counts, because that is what makes this a drift alarm rather
    # than a description: a new class of disagreement means the derivation or
    # TIDBI moved, and the derivation is the one that has to be right.
    _off = lambda d: max(abs(d[2][0] - d[3][0]), abs(d[2][1] - d[3][1]))
    _drift = collections.Counter(_off(d) for d in arm_drift)
    _far = [d for d in arm_drift if _off(d) > 1]
    assert sum(_drift.values()) == 310 and _drift[1] == 200 and len(_far) == 110, \
        'derived armor vs TIDBI drifted: %s' % dict(sorted(_drift.items()))
    assert len({d[0] for d in _far}) == 33, \
        'the far class changed size: %d items' % len({d[0] for d in _far})
    assert not [d for d in _far
                if d[2][0] != d[2][1] or d[1] not in ('Ring', 'Necklace')], \
        'a far disagreement outside the flat set-jewellery class: %s' % _far[:5]
    _near = sum(1 for d in arm_drift if _off(d) == 1
                for i in (0, 1) if abs(d[4][i] % 1 - .5) < .001)
    assert _near >= 190, \
        'the one-point disagreements left the rounding boundary: %d' % _near
    print('  armor: %d items derived, checked against TIDBI -- %d pairs agree, '
          '%d one point off (%d of those ends on a .5 boundary), %d pairs of '
          'set jewellery TIDBI records flat'
          % (sum(1 for o in out if 'da' in o), 3984 - len(arm_drift),
             len(arm_drift) - len(_far), _near, len(_far)))
    print('  SET RARITY: 210 Rare, 346 Unique (none unclassified)')

    # The set-bonus ladders the site prints. One entry per token an item names,
    # carrying the display name, how many pieces of it this corpus actually
    # ships, and the rungs.
    #
    # The DAT and TIDBI each hold half of a ladder, so neither can be trusted
    # alone and the two are asserted against each other below. A TIDBI-only
    # ladder would look perfectly well formed with a rung missing -- there is
    # nothing in a set of rows that says how many rows there should be -- and a
    # DAT-only ladder would print SET_CAST_SPEED2 where the game prints "+6%
    # Cast Speed". Agreement is the only evidence either is complete.
    sets = {}
    for tok in sorted(set_tokens):
        rungs = set_bonus.get(tok)
        assert rungs, 'no bonus text for SET token %s' % tok
        _dat = set(set_thr.get(tok, []))
        _tid = {c for c, _ in rungs}
        assert _dat == _tid, \
            'SET %s: DAT thresholds %s but TIDBI %s' % (tok, sorted(_dat), sorted(_tid))
        _mine = [o for o in out if o.get('setid') == tok]
        sets[tok] = {'n': set_names[tok], 'c': len(_mine),
                     'cap': capacity({o['t'] for o in _mine}), 'b': rungs}
    # Every rung must be a real threshold. A 1-piece "bonus" is what the game
    # prints for an ordinary affix, so a ladder claiming one would be mislabelled
    # rather than merely short.
    assert min(c for s in sets.values() for c, _ in s['b']) >= 2, \
        'a set bonus rung is below 2 pieces'
    # 15 sets declare a top rung no player can reach, because the game ships
    # fewer pieces than the set file gates on -- U_GRAND_ARCHITECT gates its 8th
    # and 9th on pieces that were never shipped, and Twinferno and Two Stroke
    # gate a 2-piece bonus on a set with one piece in it. This is not a gap in
    # the corpus: the missing pieces are absent from the PAK, not filtered out by
    # this pipeline. Pinned because the site draws these rungs differently, so a
    # change in the count would silently restyle them.
    _short = {t: (s['c'], s['b'][-1][0]) for t, s in sets.items() if s['b'][-1][0] > s['c']}
    assert len(_short) == 15, \
        'sets with an unreachable top rung drifted: %d' % len(_short)
    print('  SET BONUS: %d ladders, %d rungs, %d sets gate a rung they cannot reach'
          % (len(sets), sum(len(s['b']) for s in sets.values()), len(_short)))
    # Every display string the page can print, checked for a decimal comma that
    # survived. _decimal() folds TIDBI's on the way in, but the affix text also
    # arrives from the DAT and that path is not wrapped -- the game ships
    # localized archives, so a non-English install could supply "-1,5%" where
    # the English one supplies "-1.5%". Checking the corpus at the end rather
    # than trusting either source is the only version of this that holds.
    _commas = [t for o in out
               for t in [o.get('ds', '')] + list(o.get('fx', ()))
                         + [l for a in o.get('aug', ()) for l in a['fx']]
               if DECIMAL_COMMA.search(t)]
    _commas += [t for s in sets.values() for _, ts in s['b'] for t in ts
                if DECIMAL_COMMA.search(t)]
    assert not _commas, 'comma decimals reached the output: %s' % _commas[:3]
    # `fx` and `fxs` are parallel lists -- the effect lines and the slot each
    # belongs to -- so a drift between them would move a line into the wrong
    # group on the card rather than fail. Checked corpus-wide for the same
    # reason the commas are: the invariant is a property of the output, not of
    # any one item, and nothing downstream would notice it breaking.
    _slotted = [o for o in out if 'fxs' in o]
    _bad = [o['id'] for o in _slotted if len(o['fx']) != len(o['fxs'])]
    assert not _bad, 'fx and fxs drifted apart: %s' % _bad[:3]
    # Which source settled each row is a fact about TIDBI, not a failure, so it
    # is reported rather than asserted. 'split' and 'conflict' are the rows where
    # the files overruled it; python src/slots.py names them.
    print('  SLOT: %d items split by slot (%s)'
          % (len(_slotted), ', '.join('%s %d' % (k, n)
                                      for k, n in sorted(slot_status.items()))))
    # And the other reading of the same question: `_short` counts the corpus, this
    # counts what a character can wear. The site dims a rung on _over, not on
    # _short, because a set may ship one record of a piece that fills two slots.
    # Only Cornerstone goes past its capacity -- 7 single-slot records, a 9-rung
    # ladder -- and it is the whole reason the dimmed state is drawn at all.
    _over = {t: (s['cap'], s['b'][-1][0]) for t, s in sets.items()
             if s['b'][-1][0] > s['cap']}
    assert len(_over) == 1 and 'U_GRAND_ARCHITECT' in _over, \
        'sets whose top rung exceeds their worn capacity drifted: %r' % _over

    out.sort(key=lambda o: (o['n'].lower(), o['id']))
    print('  %d base templates excluded (nameless or base_*)' % len(templates))
    if dropped:
        print('  %d dropped (no source agrees on the class): %s'
              % (len(dropped), ', '.join(dropped)))
    return out, icon_files, skipped_stat, templates, sets


def write_csv(items, path):
    cols = ['id', 'n', 't', 'c', 'q', 'lv', 'ml', 'lr', 'cls', 'sk', 'sp', 'dps',
            'base', 'arm_derived', 'dmg_derived',
            'str_req', 'dex_req', 'mag_req', 'def_req',
            'dmg_physical', 'dmg_fire', 'dmg_ice', 'dmg_electric',
            'dmg_poison', 'arm_physical', 'arm_fire', 'arm_ice', 'arm_electric',
            'arm_poison', 'set', 'ic', 'dat_path']
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for o in items:
            rq = o.get('rq', {})
            d, a = o.get('dmg', {}), o.get('arm', {})
            w.writerow([o['id'], o['n'], o['t'], o['c'], o['q'], o.get('lv', ''),
                        o.get('ml', ''), o.get('lr', ''), o.get('cls', ''), o.get('sk', ''),
                        o.get('sp', ''), o.get('dps', ''), o.get('vb', ''),
                        o.get('da', ''), o.get('dv', ''),
                        rq.get('str', ''), rq.get('dex', ''), rq.get('mag', ''),
                        rq.get('def', ''), d.get('physical', ''), d.get('fire', ''),
                        d.get('ice', ''), d.get('electric', ''), d.get('poison', ''),
                        a.get('physical', ''), a.get('fire', ''), a.get('ice', ''),
                        a.get('electric', ''), a.get('poison', ''), o.get('set', ''),
                        o.get('ic', ''), o['p']])


def write_page(items, coords, sheet_bytes, size, sets):
    app = paths.WEB
    with open(os.path.join(app, 'app.css'), encoding='utf-8') as fh:
        css = fh.read()
    with open(os.path.join(app, 'app.js'), encoding='utf-8') as fh:
        js = fh.read()
    with open(os.path.join(app, 'index.html'), encoding='utf-8') as fh:
        shell = fh.read()

    # --- the two assets the card needs that the corpus does not supply ---
    #
    # Bitter, as an @font-face rule prepended to the app's own CSS rather than a
    # token in the shell: it keeps the token count down and puts the face in the
    # file that uses it. The face is a variable font whose `wght` axis defaults
    # to 100, so the `font-weight: 400 600` range is load-bearing rather than
    # decorative -- without it every affix line in the corpus renders in Bitter
    # Thin. No `font-display`: a data URI has nothing to wait for.
    with open(os.path.join(app, 'fonts', 'bitter-latin.woff2'), 'rb') as fh:
        face = base64.b64encode(fh.read()).decode('ascii')
    css = ("@font-face{font-family:Bitter;font-style:normal;font-weight:400 600;"
           "src:url(data:font/woff2;base64,%s) format('woff2')}\n" % face) + css

    # The five element marks, a strip of five equal tiles. Its geometry is read
    # off the PNG instead of being written into app.css, so re-cutting the strip
    # cannot leave the sprite's offsets and the CSS disagreeing about the size
    # of a tile. The app's copy is its own -- see web/fonts/README.md, and the
    # card studies under test/card_mockups/ (local only, untracked) for why
    # there is more than one.
    with open(os.path.join(app, 'elements.png'), 'rb') as fh:
        strip = fh.read()
    with Image.open(io.BytesIO(strip)) as ei:
        assert ei.size[0] % len(DMG_TYPES) == 0, \
            'element strip %r does not divide into %d tiles' % (ei.size, len(DMG_TYPES))
        ew, eh = ei.size[0] // len(DMG_TYPES), ei.size[1]
    elems = base64.b64encode(strip).decode('ascii')
    # The offsets into that strip, so app.js never has to do arithmetic on a CSS
    # length. Order is DMG_TYPES's, which is also the order the marks were cut
    # in -- physical, fire, ice, electric, poison.
    elem = {k: i * ew for i, k in enumerate(DMG_TYPES)}

    data = json.dumps({'items': items, 'icons': coords, 'sheet': list(size),
                       'elem': elem, 'sets': sets},
                      separators=(',', ':'), ensure_ascii=False)
    # The rail's grouping travels with the page rather than being re-declared in
    # app.js -- one list, so the CSV's category column and the sidebar cannot
    # disagree about where a shield goes.
    tax = json.dumps([{'g': g, 's': sub, 't': ts} for g, sub, ts in TYPE_GROUPS],
                     separators=(',', ':'), ensure_ascii=False)
    sprite = base64.b64encode(sheet_bytes).decode('ascii')

    html = (shell.replace('/*__CSS__*/', css)
                 .replace('/*__DATA__*/', data)
                 .replace('/*__TAXONOMY__*/', tax)
                 .replace('/*__JS__*/', js)
                 .replace('__SPRITE__', sprite)
                 .replace('__ELEM__', elems)
                 .replace('__EW__', str(ew))
                 .replace('__EH__', str(eh)))
    path = os.path.join(OUT, 'index.html')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(html)
    return len(html.encode('utf-8'))


def main():
    os.makedirs(OUT, exist_ok=True)
    items, icon_files, no_stats, templates, sets = build()

    sheet_bytes, coords, size = build_sheet(icon_files)
    with open(os.path.join(OUT, 'icons.webp'), 'wb') as fh:
        fh.write(sheet_bytes)
    with open(os.path.join(OUT, 'icons.json'), 'w', encoding='utf-8') as fh:
        json.dump(coords, fh, separators=(',', ':'))
    print('  sprite %dx%d, %.2f MB' % (size[0], size[1], len(sheet_bytes) / 1048576))

    with open(os.path.join(OUT, 'items.json'), 'w', encoding='utf-8') as fh:
        json.dump(items, fh, separators=(',', ':'), ensure_ascii=False)
    write_csv(items, os.path.join(OUT, 'items.csv'))
    # Its own file rather than a field on items.json: a set's ladder is one
    # record shared by all its pieces, and repeating it on each of the 556 set
    # items would be 556 copies of the same 200 bytes in a file the page already
    # carries in full.
    #
    # Keys come out sorted because build() inserts them in sorted token order --
    # not from sort_keys, which would also reorder each set's own fields and
    # leave them reading c,n,b.
    with open(os.path.join(OUT, 'sets.json'), 'w', encoding='utf-8') as fh:
        json.dump(sets, fh, separators=(',', ':'), ensure_ascii=False)

    # --- invariants ---
    assert len(templates) == 85, 'expected 85 base templates, got %d' % len(templates)
    assert len(items) == 6176, 'expected 6176 items, got %d' % len(items)
    assert not [o for o in items if o['id'].lower() in DROP_ITEMS], \
        'an item in DROP_ITEMS reached the site'

    # Every emitted type must have a home in the rail's taxonomy. The rail
    # renders in declared order and would otherwise have to invent a bucket for
    # an unmapped type -- or silently drop it, which is the failure this guards.
    # It fires on a new slot appearing in the data, not on this change.
    _unmapped = sorted({o['t'] for o in items} - set(CATEGORY))
    assert not _unmapped, 'type(s) missing from TYPE_GROUPS: %s' % _unmapped
    _cat = collections.Counter(o['c'] for o in items)
    # Armor gave one item to Accessories: petcollar_n13b is a collar, and its
    # own UNITTYPE now says so instead of the TL2ARMOR folder answering for it.
    assert _cat == {'Armor': 1831, 'Weapons': 1461, 'Accessories': 2042, 'Misc': 842}, \
        'category counts drifted: %s' % dict(_cat)
    n_dmg = sum(1 for o in items if 'dmg' in o)
    n_arm = sum(1 for o in items if 'arm' in o)
    n_either = sum(1 for o in items if 'dmg' in o or 'arm' in o)
    # Sourced from the game files where the derivation reaches, else TIDBI's
    # rendered ranges, else the DAT scalar. These are the *union*: 1,274 damage
    # / 3,969 armor from TIDBI plus the fallbacks. Armor rose by 3 and "either"
    # by 2 against the old DAT-only numbers, because three items carry a
    # rendered armor value the DAT has no field for at all (one of them already
    # had damage, hence +2).
    # One lower than the 1,371/5,356 this carried before, and for one reason:
    # Polearm_Vanq01 is now dropped (see DROP_ITEMS), and it was an item with
    # damage. Nothing else moved -- armor is untouched by any of this.
    assert (n_dmg, n_arm, n_either) == (1370, 3986, 5355), \
        'stat coverage drifted: dmg=%d arm=%d either=%d' % (n_dmg, n_arm, n_either)

    # 1,274 -> 1,351 once attack speed came from the DAT. A dps needs both a
    # rendered range and a speed, and 80 weapons that TIDBI gave no speed for
    # now get one from SPEED_DIVISOR, so they arrive here rather than being
    # silently skipped.
    assert sum(1 for o in items if 'dps' in o) == 1351, 'dps count drifted'
    # 1,368 weapons render from the DAT itself rather than from TIDBI. The page
    # keys its provenance line on 'dv', because a derived number is not a TIDBI
    # number and labelling it one would be the same lie the vb flag exists to
    # prevent, pointing the other way.
    assert sum(1 for o in items if 'dv' in o) == 1367, 'derived count drifted'
    # Attack speed is now a game-file number too, for the same reason damage is:
    # the DAT states SPEED and the divisor that turns it into seconds is known.
    # 1,276 -> 1,356. The 80 gained are weapons TIDBI simply does not price --
    # monster and NPC drops, which had no speed on the page at all before.
    assert sum(1 for o in items if 'sp' in o) == 1356, 'attack-speed count drifted'

    # SPEED_DIVISOR is load-bearing, so check it against TIDBI rather than
    # trusting the fit it was measured from: every weapon TIDBI also prices has
    # to land on the same seconds. Exactly one does not, and it is deliberate.
    tid_speed = {}
    for r in read_csv(os.path.join(CSV, 'items.csv')):
        k = (r.get('ConsolNAME') or '').strip().upper()
        v = _num(r.get('SPEED'))
        if k and v:
            tid_speed[k] = v
    disagree, gained = [], 0
    for o in items:
        if 'sp' not in o:
            continue
        tv = tid_speed.get(o['id'].upper())
        if tv is None:
            gained += 1
        elif abs(float(o['sp']) - tv) > 0.0001:
            disagree.append((o['id'], float(o['sp']), tv))
    assert disagree == [('legendary2_sword05', 0.64, 0.96)], \
        'derived speed disagrees with TIDBI beyond the known item: %s' % disagree
    # 81 gained, but the sp total only rose by 80, because one item lost a
    # speed it should never have had: `axethrow` carries SPEED 1.1 with no
    # UNITTYPE and no TIDBI row, so the old rule read that raw 1.1 straight
    # through as 1.1 seconds -- it slipped under ATTACK_SPEED_MAX by accident.
    # With no class there is nothing to divide by, so it now shows no speed
    # rather than a fabricated one.
    assert gained == 81, 'expected 81 newly-priced weapons, got %d' % gained
    # 4 items still fall back to a raw DAT scalar, down from 19 now that armor
    # derives too: 2 are armor only (Witch_Boots and Witch_Boots2, whose chain
    # carries no weight and multiplier at all) and 2 are weapons the damage
    # derivation cannot reach (legendary2_shield05c, skeleton_greatsword_u03).
    # This flag is the disclosure that keeps a pre-scale scalar from reading as
    # a rendered value, so it has to be exactly the set that needs it -- not
    # more, not less.
    assert sum(1 for o in items if 'vb' in o) == 4, 'base-value count drifted'
    assert sum(1 for o in items if 'vb' in o and 'dmg' not in o) == 2, 'vb split drifted'
    assert {o['id'] for o in items if 'vb' in o} == {
        'Witch_Boots', 'Witch_Boots2', 'legendary2_shield05c',
        'skeleton_greatsword_u03'}, 'the base-value set changed'
    assert not [o for o in items if 'vb' in o and 'dv' in o], \
        'an item cannot be both derived and a base value'
    assert sum(1 for o in items if 'cls' in o) == 767, 'class-req count drifted'
    assert {o['cls'] for o in items if 'cls' in o} == {
        'Embermage', 'Outlander', 'Berserker', 'Engineer'}, 'class vocabulary drifted'
    # Requirements are alternatives, so an item listing both a level and stats
    # is the normal case, not an oddity: 5,036 do. (5,037 before Polearm_Vanq01
    # was dropped -- it was one of them.)
    assert sum(1 for o in items if 'lr' in o and 'rq' in o) == 5036, 'req shape drifted'
    assert not [o for o in items if 'sp' in o and float(o['sp']) > ATTACK_SPEED_MAX], \
        'a SPEED that is not an attack speed leaked into sp'

    # Set names. The token is what the DAT's SET field holds and what every set
    # file is named after; the display name is what the game prints. Both are
    # kept, and the two must stay in step -- a display name that drifted back to
    # a token would put "U_GRAND_ARCHITECT" on the site again.
    #
    # SENTINAL is the token that makes the case: the DAT misspells it, and only
    # the set file knows the game calls it Sentinel.
    assert sum(1 for o in items if 'set' in o) == 556, 'set membership drifted'
    assert not [o for o in items if 'set' in o and o['set'] == o['setid']], \
        'a set fell back to its raw token'
    assert not [o for o in items if ('set' in o) != ('setid' in o)], \
        'set and setid must travel together'
    assert len({o['set'] for o in items if 'set' in o}) == 80, 'distinct sets drifted'
    assert {o['set'] for o in items if o.get('setid') in ('SENTINAL', 'U_GRAND_ARCHITECT',
                                                          'STURMBEORN')} == {
        'Sentinel', 'Cornerstone', 'Runemaster'}, 'the three renamed sets changed'

    # Aenigma. Its damage is now RECONSTRUCTED from the DAT rather than read
    # out of TIDBI, and it lands on the same 169/72 -- which is the point: the
    # derivation reproduces the rendered value, so alfgeir's independently
    # scraped dps 430 confirms the formula rather than confirming TIDBI. The
    # requirements are still TIDBI's, and still differ from the DAT's pre-scale
    # 120/50 in favour of the 163/68 the game shows.
    aen = [o for o in items if o['id'] == 'legendary_axe01'][0]
    assert aen['n'] == 'Aenigma' and aen['dmg'] == {'physical': '169', 'electric': '72'}
    assert aen['rq'] == {'str': '163', 'dex': '68'} and aen['sk'] == '2'
    assert (aen['lv'], aen['ml']) == ('54', '45'), aen
    assert (aen['lr'], aen['sp'], aen['dps']) == ('61', '0.56', 430), aen
    assert aen['t'] == 'Axe' and aen['q'] == 'Legendary' and len(aen['fx']) == 3
    assert 'dv' in aen and 'vb' not in aen, 'Aenigma is DAT-derived, not a base value'

    # The three failures the user reported on this item, pinned verbatim:
    # fire armor 140-174, Focus 79, required level 81. All three were invisible
    # before because the DAT stores a single pre-scale scalar for each.
    amu = [o for o in items if o['id'] == 'heavy_g_amulet_f_alt_b'][0]
    assert amu['arm'] == {'fire': '140-174'}, amu
    assert amu['rq'] == {'mag': '79'}, amu
    assert amu['lr'] == '81', amu

    # A zero minimum is a value, not an absence. Both Sturm Shields carry fire
    # and ice armor of 0-1 in TIDBI, and reading the 0 through _num() collapsed
    # those four slots into a flat 1 -- an armor the item does not have at the
    # floor of its range.
    for sid in ('sturm_shield', 'sturm_shield02'):
        sh = [o for o in items if o['id'] == sid][0]
        assert (sh['arm'].get('fire'), sh['arm'].get('ice')) == ('0-1', '0-1'), sh['arm']

    # The Mandlebow was this corpus's one inverted range -- TIDBI and alfgeir
    # both carry its physical as 391-205. Derived from the DAT it becomes an
    # ascending 207-411, so the inversion is gone rather than reproduced, and
    # this assertion flips from "exactly one, and here it is" to "none at all".
    # The derivation cannot produce one: it scales one min and one max by the
    # same set of shares, so the two can meet but never cross.
    odd = []
    for o in items:
        for key in ('dmg', 'arm'):
            for t, v in (o.get(key) or {}).items():
                lo, sep, hi = v.partition('-')
                if sep and lo.isdigit() and hi.isdigit() and float(lo) > float(hi):
                    odd.append((o['id'], key, t, v))
    assert not odd, 'a range reads backwards: %s' % odd
    man = [o for o in items if o['id'] == 'legendary2_crossbow03'][0]
    assert man['n'] == 'The Mandlebow', man
    assert man['dmg'] == {'physical': '207-411', 'ice': '104-205',
                          'poison': '104-205'}, man
    assert (man['sp'], man['dps']) == ('0.64', 1069), man

    # Battlemage Helm: the shape of a class item. Level 65 *or* (Focus 87 and
    # Vitality 101), Embermage only -- the class restriction is a separate hard
    # gate, which is why it is its own field and not part of the or-group.
    bmh = [o for o in items if o['id'] == 'caster_04_helmet_alt_c'][0]
    assert bmh['n'] == 'Battlemage Helm' and bmh['arm'] == {'physical': '41'}, bmh
    assert bmh['lr'] == '65' and bmh['rq'] == {'mag': '87', 'def': '101'}, bmh
    assert bmh['cls'] == 'Embermage', bmh

    # Longfang: a three-type range whose dps alfgeir also states as 296, and
    # the exact speed string the user quoted from the game.
    lon = [o for o in items if o['id'] == 'sword_u03c'][0]
    assert lon['dmg'] == {'physical': '85-171', 'fire': '28-57', 'poison': '28-57'}, lon
    assert (lon['sp'], lon['dps']) == ('0.72', 296), lon

    # Augmented weapons. Grimbone Wand is the item the user reported: two stats
    # that only unlock after killing 50 Ezrohir, which must not be presented as
    # already-active affixes.
    augd = [o for o in items if o.get('aug')]
    assert len(augd) == 74, len(augd)
    assert {o['q'] for o in augd} == {'Unique', 'Normal'}, 'augmented tier drift'
    assert {o['c'] for o in augd} == {'Weapons'}, 'augmented category drift'
    assert sorted(len(o['aug'][0]['fx']) for o in augd) == [1] * 9 + [2] * 53 + [3] * 12
    assert not [o for o in augd if not o['aug'][0]['task'].lower().endswith('upgrade')]
    # The task and the header must not survive into the plain affix list.
    bad = [o['id'] for o in augd
           if any('augmented' in t.lower() or 'upgrade' in t.lower()
                  for t in o.get('fx', []))]
    assert not bad, 'augment text leaked into affixes: %s' % bad

    gri = [o for o in items if o['id'] == 'wand_u02b'][0]
    assert gri['n'] == 'Grimbone Wand' and gri['aug'] == [{
        'task': 'Kill 50 Ezrohir to Upgrade',
        'fx': ['6% chance to cast Acid Rain from target',
               '15% chance to Stun target for 2 sec.']}], gri['aug']
    assert gri['fx'] == ['40% bonus to Critical Damage', '+25 Physical Damage',
                         '-8 to All Armor per hit'], gri['fx']
    # Its rendered numbers, pinned because they were reported as wrong. They
    # are not: TIDBI and alfgeir carry these exact damage lines, and the DAT's
    # DAMAGE_PHYSICAL 90 / DAMAGE_POISON 10 off MINDAMAGE 75 are the pre-scale
    # layer underneath.
    #
    # The dps is the one number here that is assembled rather than read off a
    # source, because the game's own tooltip counts the '+25 Physical Damage'
    # affix and neither source does -- TIDBI has the 25 (as CDPS and in the
    # effect text) and never adds it, and alfgeir's dps is alfgeir's own
    # floor(avg/speed+.5) rather than a scrape, so it never saw one either. Both
    # the wiki's screenshot of this item and the game itself read 179, which is
    # floor(148 / .96 + .5) + 25 over the damage that tooltip displays.
    #
    # This row reads 180, and the difference is the damage lines, not the
    # formula: TIDBI carries 126-142 / 14-16 where the game displays
    # 125-142 / 14-15, one higher at each end, and 180 is the correct dps *for
    # the damage this row shows*. Closing that last point means rendering the
    # damage ourselves rather than trusting TIDBI's already-rounded integers.
    assert gri['dmg'] == {'physical': '126-142', 'poison': '14-16'}, gri['dmg']
    assert (gri['lv'], gri['lr'], gri['rq'], gri['sp'], gri['dps']) == \
        ('22', '26', {'mag': '80'}, '0.96', 180), gri

    # A "+N Damage" affix counts toward the dps only when the item has it from
    # the start. The Bugstomper is the case that separates the two: its +58
    # Physical Damage arrives with the augmentation, and while the item still
    # reads "Kill 20 Spiders to Upgrade (0/20 killed)" its own tooltip shows no
    # such line -- so 434 is floor(243 / .56 + .5) and nothing more. The
    # Mechano-Axe carries its +340 in the base group, so its 864 becomes 1204.
    bug = [o for o in items if o['id'] == 'fist_u05'][0]
    assert bug['dps'] == 434 and flat_damage(bug['fx']) == 0, bug
    assert '+58 Physical Damage' in [t for g in bug['aug'] for t in g['fx']], bug['aug']
    mech = [o for o in items if o['id'] == 'greataxe_u07b'][0]
    assert (flat_damage(mech['fx']), mech['dps']) == (340, 1204), mech

    # The rule reaches 64 records, and no others: the corpus has 118 flat
    # "+N <type> Damage" affix lines in the base groups and 15 in the augmented
    # ones, and only a weapon with a rendered range has a dps to add them to.
    assert sum(1 for o in items if o.get('dps') and flat_damage(o.get('fx') or [])) == 64
    # ratkiller is the one item whose divider sorts before its header. Its twin
    # zombiesummoner carries the same '90% Interrupt chance' affix, and for that
    # one the divider puts the affix outside the block -- so it is an affix
    # here too, and only '+2 Physical Damage' is unlocked.
    rat = [o for o in items if o['id'] == 'ratkiller'][0]
    assert rat['aug'] == [{'task': 'Kill 5 Ratlins to Upgrade',
                           'fx': ['+2 Physical Damage']}], rat['aug']
    assert rat['fx'] == ['90% Interrupt chance'], rat['fx']
    # The two dev test swords end on a divider with nothing after it.
    assert 'fx' not in [o for o in items if o['id'] == 'zzz_testsword_augment_25 monsters'][0]

    tiers = {t: sum(1 for o in items if o['q'] == t) for t in TIER_ORDER}
    # Unclassified is exactly the set of items TIDBI has no row for, less the
    # two NAME markers rescue (_u03, _n13b). Rare carries the two potions the
    # backtick fold recovered (see _apos).
    assert tiers == {'Normal': 2161, 'Rare': 1851, 'Unique': 1391, 'Set': 556,
                     'Legendary': 92, 'Unclassified': 125}, tiers
    assert 'Magic' not in tiers, 'Magic is not a tier in this dataset'
    tid = [r for r in read_csv(os.path.join(CSV, 'items.csv'))
           if (r.get('ConsolNAME') or '').upper() == 'LEGENDARY_AXE01']
    assert len(tid) == 1, 'TIDBI has %d rows for legendary_axe01' % len(tid)

    # Every remaining stat-less item must be structurally stat-less. The one
    # place a base-walk regression would hide is weapons, so pin that set
    # exactly: three enemy-only props that never drop and carry no numbers.
    empty = [o for o in items if 'dmg' not in o and 'arm' not in o]
    leaked = sorted(o['id'] for o in empty if o['c'] == 'Weapons')
    assert leaked == ['Skeleton_Sword_Magical', 'netherim_2h_greatmace',
                      'netherim_2h_greatmace_champ'], 'weapons lost stats: %s' % leaked

    bad = [o['ic'] for o in items if o.get('ic') and o['ic'] not in coords]
    assert not bad, 'icons missing from sprite: %s' % bad[:5]

    print('\nitems.json  %.2f MB (%d items, %.0f B/item)'
          % (os.path.getsize(os.path.join(OUT, 'items.json')) / 1048576, len(items),
             os.path.getsize(os.path.join(OUT, 'items.json')) / len(items)))
    print('no damage/armor after inheritance: %d' % no_stats)
    print('types: %d distinct | tiers: %s'
          % (len({o['t'] for o in items}),
             {t: sum(1 for o in items if o['q'] == t) for t in TIER_ORDER}))

    if '--no-app' not in sys.argv:
        shown = [o for o in items if o['q'] not in SITE_HIDDEN_TIERS]
        n = write_page(shown, coords, sheet_bytes, size, sets)
        print('index.html  %.2f MB (%d of %d items shown; %d hidden: %s)'
              % (n / 1048576, len(shown), len(items), len(items) - len(shown),
                 ', '.join(SITE_HIDDEN_TIERS)))
        assert n <= 12 * 1048576, 'page too large: %.2f MB' % (n / 1048576)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

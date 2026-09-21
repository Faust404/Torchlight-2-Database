"""Build the item-card mockups.

Standalone: this does not touch web/**, does not run the pipeline, and does not
write out/**. It reads the pipeline's *output* (items.json, sets.json) and the
icon sheet, crops the handful of icons the mockups show into a small strip, and
injects the whole lot into mock.tpl.html.

    python test/card_mockups/build_mockups.py

Writes three pages, each self-contained apart from its base64 sprite -- no local
file references, so they open off file:// and publish as-is:

    index.html   the card sheet
    affix.html   the affix block under each colour and face
    set.html     the set-bonus ladder under each treatment
"""
import base64
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# Two levels up to the repo root, then into src/ for the one module that knows
# where everything is. This used to be an ancestor walk -- normpath(join(HERE,
# '..', '..', 'db', 'out')) -- which could not fail: after the tree moved it
# would have gone on resolving, against a db/out/ that was either stale or gone,
# and written mockups from a build nobody had run. Importing paths instead means
# a wrong walk raises here, at import, before anything is read.
sys.path.insert(0, os.path.join(HERE, '..', '..', 'src'))
import paths

OUT = paths.OUT

# The five element marks the game draws beside an elemental stat, taken from
# MEDIA/UI/HUD/INGAMETEXTURESHEETS4.PNG at x=996, 27x29 each, in this order:
#   physical y=156  fire y=342  ice y=249  electric y=435  poison y=63
# Those are the shield-less variants (resist_physicalc, resist_firec,
# resist_iced, resist_electricc, resist_poisonc) -- not the shielded
# ig_resistance_* set, which is the character sheet's. The item tooltip's own
# layout, MEDIA/UI/PIECES/EQUIPMENT_ROLLOVER.LAYOUT, names exactly these five.
# Each whole 27x29 tile is scaled to 15x16 rather than each glyph being
# re-normalised, so the artist's own sizing and centring within the tile is
# what survives. See README.md for the one-off extraction.

# One item per feature the current card renders, so no variant can quietly drop
# one. Aenigma: damage, dps, speed, range, sockets, an either/or requirement.
# Mondon's Belt: armour, a class gate, a 10-rung ladder. Blood Ember Shard:
# a socketable, with no affixes at all. Adeptus Helm: class-only, no player
# level requirement. Bloodbath: the augmented (locked) group. Twinferno Wand:
# a set that gates a rung above the pieces it ships.
#
# Five Dragons Falconet is here for one number: four sockets. The other six
# carry one or two between them, which is representative -- 1,447 items in the
# corpus have exactly one socket and only 112 have two -- but a socket row is
# the one thing you cannot judge from a sample of one, so the rings rendering
# needs a full row to argue against. It also happens to be the only Slow
# weapon here, and its two-stat either/or is the widest requirement branch.
#
# Flame Ember Shard sits beside Blood Ember Shard deliberately. Blood, Chaos,
# Iron and Void Ember are cut content -- their _BASE files carry an EMPTY
# AFFIXES list, while Flame, Ice, Spark and Venom carry list(2) -- so Blood
# Ember renders a socketable card with no affixes, which is correct and looks
# like a bug. Flame Ember is the same rank of the same kind and carries the two
# effects, so the pair shows both what the card does with a live gem and what
# the dead ones actually are.
# The order the element marks sit in the strip, and the order the card prints
# them in. It must match DMGTYPES in mock.tpl.html.
DMGTYPES = ['physical', 'fire', 'ice', 'electric', 'poison']

WANT = [
    'legendary_axe01',
    'engineer_06_belt_alt_set',
    'tl2_bloodember_rank3',
    'tl2_flameember_rank3',
    'caster_03_helmet',
    'sword_u07b',
    'z_wand_m01_set',
    'cannon_m05slots',
    # Two more ladders, because the two above between them show only one state
    # of the block. Grand Architect's is the only set in the corpus whose top
    # rungs sit above what a character can wear, so it is the only place the
    # muted rung appears at all; Aristocrat's has a rung carrying four bonuses,
    # which is where the blank continuation figure does.
    'engineer_05_chest_alt_set',
    'pimp_01_belt_alt_set',
]

# The affix sheet's specimens. Every shape an affix line takes is here, so a
# colour or face that breaks one of them is visible rather than argued about:
# Aenigma has a percent, a bare number, and one line carrying two numbers;
# Bloodbath a negative and an element; Adeptus Helm an element and a "per 3
# meters"; Flame Ember a socketable's slot prefix, which is the only structural
# distinction an affix string carries and which none of these variants touches;
# Riftplane Destroyer a line with no number at all, which no amount of emphasis
# can reach. Dragon Heartfire carries the longest affix in the corpus (70
# characters), so the wide faces have something to wrap on -- the rest are short
# enough that every variant measures the same height for want of a second line.
AFFIX_SPEC = [
    'legendary_axe01',
    'sword_u07b',
    'caster_03_helmet',
    'tl2_flameember_rank3',
    'legendary2_cannon04',
    'tl2_dragon_heartfire',
]

# The set sheet's specimens. One item per set, three sets because each is a
# different failure of the same heading, and no single ladder shows all three:
#   Mondon's Vestment -- the inflated count (16 records over 9 slots) and the
#                        only ladder long enough to read as a ladder.
#   Twinferno         -- one record, one slot, rung 2: the muted state, and the
#                        heading's "1 pieces".
#   Aristocrat        -- a set that agrees with itself, and the only specimen
#                        whose rung carries four bonuses, which is the only
#                        place the blank continuation marker appears.
SET_SPEC = [
    'engineer_06_belt_alt_set',
    'z_wand_m01_set',
    'pimp_01_belt_alt_set',
]

def write(tpl_name, out_name, data, token):
    tpl = open(os.path.join(HERE, tpl_name), encoding='utf-8').read()
    html = tpl.replace(token, json.dumps(data, separators=(',', ':'),
                                          ensure_ascii=False))
    out = os.path.join(HERE, out_name)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote %s  (%.1f KB)' % (out, len(html) / 1024.0))


def main():
    items = json.load(open(os.path.join(OUT, 'items.json'), encoding='utf-8'))
    sets = json.load(open(os.path.join(OUT, 'sets.json'), encoding='utf-8'))
    icons = json.load(open(os.path.join(OUT, 'icons.json'), encoding='utf-8'))
    by = {o['id']: o for o in items}

    missing = [i for i in WANT + AFFIX_SPEC + SET_SPEC if i not in by]
    if missing:
        sys.exit('items.json has no record for: %s' % ', '.join(missing))
    picked = [by[i] for i in WANT]

    # Each shown item's own set, and nothing else -- a mockup has no business
    # carrying 80 ladders it never draws. `cap` comes from sets.json now: the
    # card dims a rung against what a character can wear, and one definition of
    # that lives in the pipeline rather than one per tree.
    used = {}
    for o in picked:
        sid = o.get('setid')
        if sid and sid in sets:
            used[sid] = sets[sid]

    # The icons arrive as one 4.7 MB sheet addressed by coordinates. Cropping
    # the six tiles out into a 270x45 strip keeps the page a few KB and keeps
    # the mockup rendering the way the app does -- background-position on a
    # spritesheet, not an <img> per tile.
    from PIL import Image
    sheet = Image.open(os.path.join(OUT, 'icons.png')).convert('RGBA')
    order = []
    for o in picked:
        if o.get('ic') and o['ic'] in icons and o['ic'] not in order:
            order.append(o['ic'])
    strip = Image.new('RGBA', (45 * len(order), 45), (0, 0, 0, 0))
    pos = {}
    for i, name in enumerate(order):
        x, y, w, h = icons[name]
        strip.paste(sheet.crop((x, y, x + w, y + h)), (i * 45, 0))
        pos[name] = i * 45
    buf = io.BytesIO()
    strip.save(buf, 'PNG', optimize=True)
    sprite = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')

    # The element marks arrive as one small strip already, 15px a tile.
    esprit = Image.open(os.path.join(HERE, 'elements.png')).convert('RGBA')
    ebuf = io.BytesIO()
    esprit.save(ebuf, 'PNG', optimize=True)
    esprite = 'data:image/png;base64,' + base64.b64encode(ebuf.getvalue()).decode('ascii')
    ew = esprit.size[0] // 5
    elem = {n: i * ew for i, n in enumerate(DMGTYPES)}

    data = {'items': picked, 'sets': used, 'pos': pos, 'sprite': sprite,
            'elem': elem, 'esprite': esprite, 'ew': ew, 'eh': esprit.size[1]}
    write('mock.tpl.html', 'index.html', data, '/*__DATA__*/')
    print('  %d items, %d icons, %d sets' % (len(picked), len(order), len(used)))

    # The affix sheet is the affix block alone, on the ground the card gives it,
    # under five colour treatments and four faces.
    spec = []
    for i in AFFIX_SPEC:
        o = by[i]
        if not o.get('fx'):
            sys.exit('affix sheet: %s carries no affixes' % i)
        spec.append({'n': o['n'], 'id': o['id'], 'fx': o['fx']})
    write('affix.tpl.html', 'affix.html', {'spec': spec}, '/*__AFFIX__*/')
    print('  %d specimens' % len(spec))

    # The set sheet is the ladder alone. Each specimen carries its set's rung
    # list plus the three numbers the card's heading and its dimming disagree
    # about: `c`, the records in items.json carrying that setid; `slots`, how
    # many distinct item types those records are; and `cap`, how many of them a
    # character can be wearing at once. The divergence is the finding the sheet
    # exists to show, so all three travel to the page.
    sspec = []
    for i in SET_SPEC:
        o = by[i]
        sid = o.get('setid')
        if not sid or sid not in sets:
            sys.exit('set sheet: %s belongs to no set' % i)
        s = sets[sid]
        if not s['b']:
            sys.exit('set sheet: %s has an empty ladder' % sid)
        types = set(x['t'] for x in items if x.get('setid') == sid)
        sspec.append({'n': o['n'], 'id': o['id'], 'set': s['n'], 'c': s['c'],
                      'slots': len(types), 'cap': s['cap'], 'b': s['b']})
        print('    %-22s %-14s records=%-3d slots=%-3d capacity=%-3d top rung=%d' %
              (i, s['n'], s['c'], len(types), s['cap'], s['b'][-1][0]))
    write('set.tpl.html', 'set.html', {'spec': sspec}, '/*__SETS__*/')
    print('  %d specimens' % len(sspec))


if __name__ == '__main__':
    main()

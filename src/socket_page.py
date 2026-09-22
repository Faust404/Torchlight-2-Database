# -*- coding: utf-8 -*-
"""The socketables page: every gem, ember, skull and eye the game ships, in one
table, written to out/socketables.html beside out/index.html.

Why a table, against the site's cards -- 162 socketables is the wrong shape for
a grid of cards. There are only five facts about each one, and the useful
question is comparative -- what does a level 40 gem give me, and what did the
level 30 one give -- which is reading down a column, not across a card. The
wiki's own Gems (T2) page is a table for the same reason.

The two effect columns are the point of the page. A socketable grants one thing
in armor or a trinket and a different thing in a weapon, and the game files them
separately; a card that prints both in one block makes them read as one effect.
That split is the reason this page is worth having.

Everything else comes from the site: the same :root tokens, the same tier
colours, the same Bitter for effect text, the same icon sheet -- which this page
references from beside itself rather than inlining, since out/icons.webp is
already served and the main page's copy is its own.

The split itself comes from slots.py, which reads it out of the game files --
each item's ordered AFFIXES list, and each affix's own applicability list --
rather than out of TIDBI's tooltip headings. That is stricter than it sounds: it
independently confirms TIDBI on 121 of the 162 rows, and on six it does not --
three where TIDBI lost a heading and the line boundary inside a merged block had
to be inferred, three where TIDBI printed a heading the files contradict. The
page marks those rather than quietly fixing them.

This module began as test/socketables_mockup/build_mockup.py, a design study.
It is a study no longer -- build.py calls write() from main(). The study is left
where it is, untracked, as the record of the design.
"""
import collections
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths

import build as B          # noqa: E402  (sibling; build.py imports this module
import slots               # noqa: E402   from inside main(), so there is no cycle)

PAGE = 'socketables.html'

# Section order. The kinds are the game's own families -- an ember is an ember,
# a skull is a skull -- which is what a player shops by, because the family is
# what decides the kind of bonus.
#
# A sixth kind, Components, is gone -- heading and rows both. Its five members
# (TL2_PARTS_WEAPON1-5) are handed out by MEDIA/SPAWNCLASSES/RECIPE_COMPONENT.DAT
# -- the only file in the 16,084-file corpus that names any of them, and a
# sibling of RECIPE_3RINGS_* and RECIPE_SET_ITEM -- so "Component" is the
# Transmuter's word for a recipe input, not a family a player shops by. No row
# on the wiki's `Gems (T2)` page carries the word either. The five are still in
# the database and still on the site, under Misc; this page is the families, and
# a recipe input is not one. load() drops them by file name.
KINDS = ['Embers', 'Skulls', 'Eyes', 'Gems', 'Other']

QUALITY = {'Normal': 'normal', 'Rare': 'rare', 'Unique': 'unique'}

# The ember section's own order, which is not level order. Family-major,
# tier-minor: all seven Flames Speck-to-Giant, then all seven Ices, and so on.
# Two of the three things wanted fall out of that rather than needing rules of
# their own -- the four normal families (flame, ice, spark, venom) come before
# the four rare ones (blood, chaos, iron, void) because the list is written in
# that order, and each family reads top-to-bottom as its own ladder, which is
# the comparison this table exists for.
#
# The tier is the DAT's own rank number and not the display name, which spells
# it three ways around the word Ember: rank 1 is "Flame Ember Speck", rank 4 is
# bare "Flame Ember", rank 7 is "Giant Flame Ember". Rank is exact.
#
# Named for the order, not for the families: build.py has an EMBER_FAMILIES of
# its own that maps each family to the column its affix writes into, and
# slots.py's docstring cross-references that one by name. This list is a sort
# key and nothing else.
EMBER_ORDER = ['flame', 'ice', 'spark', 'venom',
               'blood', 'chaos', 'iron', 'void']


def ember_key(r):
    """(family, tier) for an ember row. Anything else -- Rift Ember, every gem,
    skull and eye -- takes the end of the range and sorts by level instead."""
    m = re.match(r'tl2_([a-z]+)ember_rank(\d+)$', r['id'])
    if m and m.group(1) in EMBER_ORDER:
        return EMBER_ORDER.index(m.group(1)), int(m.group(2))
    return len(EMBER_ORDER), 0


def kind_of(it):
    """Which section a socketable belongs in, from its DAT basename -- where
    the game files its own kinds -- falling back to the display name."""
    base = os.path.splitext(os.path.basename(it['p']))[0].upper()
    name = it['n']
    if 'EMBER' in base or 'Ember' in name:
        return 'Embers'
    if base.startswith('TL2_SKULL') or 'Skull' in name:
        return 'Skulls'
    if 'EYE' in base or 'Eye' in name:
        return 'Eyes'
    if 'GEM' in base:
        return 'Gems'
    return 'Other'


def load(items, coords):
    """One row per socketable, with its split resolved from the game files.

    `items` is the main build's shown list -- the same one write_page() gets --
    so this page can never carry an item the site hides.

    TIDBI's raw tooltip text is read from the loader build.py itself uses. The
    shipped items.json carries the split, not the headings it was read from, so
    'split' and 'conflict' can only be reported by asking the build's own
    question of the build's own input. Reusing load_tidbi()/split_effects() --
    rather than a private copy of them -- is what keeps this page and the build
    from ever disagreeing about what TIDBI said.
    """
    _, effects = B.load_tidbi()
    rows = []
    for it in items:
        if it['t'] != 'Socketable':
            continue
        # One row this rule exists for, and it is not the one the name suggests:
        # tl2_bloodember_BASE. It is a template -- no level, no effects, nothing
        # a player can hold -- but its tier is Rare and its display name is
        # "Blood Ember", so SITE_HIDDEN_TIERS does not catch it and `items` does
        # carry it. Without this it would put a phantom "Blood Ember", em-dashes
        # down every column, between Giant and the rest of the Embers.
        #
        # The other seven _BASE files are also templates, and this rule does drop
        # them, but the tier rule already had: their display names end in
        # "NOSPAWN", so all seven are Unclassified and the site hides them
        # already. Both rules are kept because they are not the same rule --
        # `items` is the tier gate that keeps this page and the site from
        # disagreeing about what is hidden, and this one is about templates.
        if it['id'].lower().endswith('_base'):
            continue
        # The five Components are a Transmuter recipe input, not a family a
        # player shops by -- see KINDS.
        if 'PARTS_WEAPON' in os.path.basename(it['p']).upper():
            continue
        # Keyed on the DAT's NAME -- which `id` is, lowercased -- because that
        # is what TIDBI's effects.csv uses and what the build looks up. The
        # display name is not a key: two different items are both called
        # "Rift Ember" and would collide on it.
        raw = effects.get(it['id'].upper())
        _, affixes = B.split_effects(raw) if raw else ([], [])
        armor, weapon, shared, status = slots.resolve(it['p'], affixes)
        # The split is re-derived from the game files, where the card renders the
        # `fxs` the build already worked out. This is what keeps the two honest:
        # the columns are a partition of the item's flat effect list, so
        # |armor| + |weapon| - |shared| has to come back to |fx| exactly -- a
        # shared line is in both columns and so counted twice. If the files ever
        # stop accounting for a line the card prints, this is where it surfaces
        # rather than as a row quietly missing an effect.
        assert (len(armor) + len(weapon) - len(shared)
                == len(it.get('fx') or [])), \
            'the split does not partition %s: %s' % (it['id'], status)
        ep = it.get('ep') or {}
        rows.append({
            'id': it['id'], 'name': it['n'], 'kind': kind_of(it),
            'q': QUALITY.get(it['q'], 'none'),
            'lv': int(it['lv']) if it.get('lv') else None,
            # The character level the game requires for this socketable, read
            # from its own ITEM_LEVEL_REQUIREMENTS_SOCKETABLE curve. It is `lr`,
            # the same field every other item's requirement arrives in -- not
            # MINLEVEL, which is the drop band and sits in the column beside it.
            'lr': int(it['lr']) if it.get('lr') else None,
            'ml': int(it['ml']) if it.get('ml') else None,
            'xl': int(it['xl']) if it.get('xl') else None,
            'armor': armor, 'weapon': weapon, 'shared': shared, 'status': status,
            'pa': ep.get('a') or [], 'pw': ep.get('w') or [],
            'co': coords.get(it.get('ic', '')),
            'desc': (it.get('ds') or '').strip(),
        })
    return rows


# --------------------------------------------------------------------- pieces

def cell(fx, pool, shared, uid):
    """One effect column.

    Three shapes: a rare ember's rolled pool, a list of fixed lines, or an
    em-dash. A line in `shared` belongs to an affix that allows either slot --
    the gold and luck gems, the fish scales -- and is tagged so it does not read
    as a second, separate bonus.

    The pool is a disclosure, not a list. Twenty-eight items roll one effect
    from each of two pools, so opening every list at once would put 56 of them
    on a 162-row table and bury the column it is meant to be read down. Closed,
    it says the one thing a reader needs at a glance -- that this bonus is not
    fixed -- and gives the options to whoever asks for them.
    """
    if pool:
        pid = 'pool-%s' % uid
        opts = ''.join('<li>%s</li>' % html.escape(o) for o in pool)
        return ('<div class="pool">'
                '<button class="unbtn oneof" type="button" aria-expanded="false"'
                ' aria-controls="%s">one of %d'
                '<span class="car" aria-hidden="true"></span></button>'
                '<ul id="%s" class="hidden">%s</ul></div>'
                % (pid, len(pool), pid, opts))
    parts = []
    for l in fx:
        tag = '<i class="tag">either</i>' if l in shared else ''
        parts.append('<p class="fx%s">%s%s</p>'
                     % (' shared' if l in shared else '', html.escape(l), tag))
    return ''.join(parts) if parts else '<span class="none">&mdash;</span>'


def icon(r):
    if not r['co']:
        return '<i class="noicon"></i>'
    x, y, w, h = r['co']
    return ('<i class="ic" style="background-position:-%dpx -%dpx;'
            'width:%dpx;height:%dpx"></i>' % (x, y, w, h))


def row(r):
    marks = []
    if r['status'] == 'split':
        marks.append('<span class="mark ok" title="TIDBI lost the heading that '
                     'separates these two effects, so its lines run together. '
                     'The game files say where the break is.">heading lost'
                     '</span>')
    elif r['status'] == 'conflict':
        marks.append('<span class="mark warn" title="TIDBI prints a heading the '
                     'game files contradict. The files are shown, but a wrong '
                     'heading is not something the files can prove wrong, so '
                     'this row is flagged rather than fixed.">sources differ'
                     '</span>')
    if r['pa'] or r['pw']:
        marks.append('<span class="mark roll" title="Its bonus is rolled from a '
                     'pool when it drops, not fixed.">rolled</span>')
    search = ' '.join([r['name']] + r['armor'] + r['weapon']
                      + r['pa'] + r['pw'] + [r['desc']]).lower()
    # data-fam is the family and tier collapsed into one sortable number, so the
    # client-side sort can put the embers in the same order the document ships
    # in -- and reverse it -- without carrying the family table into the page.
    fam, tier = ember_key(r)
    def dash(v):
        return v if v is not None else '&mdash;'
    return (
        '<tr class="q-%s" data-kind="%s" data-q="%s" data-lv="%s" data-lr="%s"'
        ' data-ml="%s" data-xl="%s" data-fam="%s" data-name="%s"'
        ' data-fx="%s">'
        '<td class="c-ic">%s</td>'
        '<td class="c-n"><a class="nm" href="index.html#item=%s"'
        ' target="_blank" rel="noopener">%s</a>%s</td>'
        '<td class="c-lv num">%s</td><td class="c-lr num">%s</td>'
        '<td class="c-a">%s</td><td class="c-w">%s</td>'
        '<td class="c-ml num">%s</td><td class="c-xl num">%s</td></tr>' % (
            r['q'], r['kind'], r['q'], r['lv'] or 0, r['lr'] or 0,
            r['ml'] or 0, r['xl'] or 0, fam * 1000 + tier,
            html.escape(r['name'].lower()), html.escape(search),
            icon(r), html.escape(r['id'], quote=True), html.escape(r['name']),
            ''.join(marks),
            dash(r['lv']), dash(r['lr']),
            cell(r['armor'], r['pa'], r['shared'], r['id'] + '-a'),
            cell(r['weapon'], r['pw'], r['shared'], r['id'] + '-w'),
            dash(r['ml']), dash(r['xl'])))


# Every column class here is also on the matching <td> below, and it has to be
# on both. The table is table-layout:fixed, which takes its column widths from
# the FIRST ROW -- these cells -- and ignores every width declared further down.
# The <td>s carried the classes and the <th>s did not, so seven of the eight
# columns had no width at all as far as the layout was concerned and the table
# silently split into eight equal ones: 161px for the item name, for a three
# digit level, and for content lines up to 347px long. `.c-ic` was the only one
# that worked, and only because its <th> was the one that had the class.
HEAD = ('<thead><tr>'
        '<th class="c-ic"></th>'
        '<th class="c-n" data-key="name">Socketable</th>'
        '<th class="c-lv num" data-key="lv">Item Lv</th>'
        '<th class="c-lr num" data-key="lr">Req. Lv</th>'
        '<th class="c-a" data-key="a">Armor / Trinket</th>'
        '<th class="c-w" data-key="w">Weapon</th>'
        '<th class="c-ml num" data-key="ml">Min Lv</th>'
        '<th class="c-xl num" data-key="xl">Max Lv</th>'
        '</tr></thead>')


def sections(rows):
    out = []
    for k in KINDS:
        kr = [r for r in rows if r['kind'] == k]
        if not kr:
            continue
        # The heading is the disclosure control, so it is a real button rather
        # than a click handler on the h2: it is focusable, it announces its
        # state, and it is reachable by keyboard without a tabindex bolted on.
        # aria-controls points at the wrapper rather than the table, because the
        # table is what gets hidden and the id has to sit on the element the
        # attribute names.
        sid = 'sec-' + k.lower()
        out.append(
            '<section data-kind="%s">'
            '<h2><button class="unbtn fold" type="button" aria-expanded="true"'
            ' aria-controls="%s"><span class="car" aria-hidden="true"></span>'
            '%s<span class="n">%d</span></button>'
            '<span class="rule"></span></h2>'
            '<div class="scroll" id="%s"><table>%s<tbody>%s</tbody></table></div>'
            '</section>' % (k, sid, k, len(kr), sid, HEAD,
                            ''.join(row(r) for r in kr)))
    return ''.join(out)


CSS = """
:root{
  --bg:#12110f; --panel:#171614; --line:#211e1c; --div:#2b251b;
  --head:#dec2a3; --label:#a88054; --gold:#e3ba6b; --teal:#4db4b9; --muted:#999;
  --t-normal:#e6e6e6; --t-rare:#2182ff; --t-unique:#ef6100; --t-none:#8a8a8a;
  --body:#c9c2b6; --val:#d8cfc0; --dim:#8b837b; --faint:#6f6862;
  --doc:Bitter,Georgia,"Times New Roman",serif;
}
*{box-sizing:border-box}
body{margin:0; background:var(--bg); color:var(--body);
  font:13px/1.45 "Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1220px; margin:0 auto; padding:0 20px}
a{color:inherit; text-decoration:none}

header.top{border-bottom:1px solid var(--line); background:var(--panel)}
header.top .wrap{padding-top:20px; padding-bottom:16px}
h1{margin:0; font-size:21px; font-weight:600; color:var(--head)}
h1 small{display:block; margin-top:2px; font-size:11px; font-weight:400;
  color:var(--label); letter-spacing:.09em; text-transform:uppercase}
.lede{margin:11px 0 0; max-width:72ch; color:var(--dim)}
.lede b{color:var(--val); font-weight:600}
/* The way back. This is the site's first outbound link of any kind, so it is
   written plainly and put above the title rather than dressed as a control. */
.back{margin:0 0 10px; font-size:11px; letter-spacing:.09em;
  text-transform:uppercase; color:var(--label)}
.back a:hover{color:var(--gold)}

.bar{position:sticky; top:0; z-index:6; background:var(--bg);
  border-bottom:1px solid var(--line)}
.bar .wrap{display:flex; flex-wrap:wrap; align-items:center; gap:9px;
  padding-top:9px; padding-bottom:9px}
/* A fixed height, not padding: the sticky header below is pinned at the
   toolbar's exact height, so the toolbar's height has to be a known number
   rather than whatever the font metrics happen to produce. 32 + 9 + 9 + 1. */
input[type=search],input[type=number],select,button{
  height:32px;
  font:inherit; color:var(--body); background:var(--panel);
  border:1px solid var(--line); border-radius:3px; padding:0 8px}
input[type=search]{min-width:220px}
input[type=number]{width:62px}
input[type=search]::placeholder{color:var(--faint)}
select{color:var(--body)}
button{cursor:pointer; color:var(--dim)}
button:hover{border-color:var(--div)}
button[aria-pressed=true]{border-color:var(--gold); color:var(--gold)}
button:focus-visible,input:focus-visible,select:focus-visible{
  outline:1px solid var(--teal); outline-offset:1px}
/* The shared rule above hands every `button` a 32px box with a panel
   background, a border and a radius. Two buttons on this page have to look like
   something else -- a section heading, and the small gold "one of N" label --
   so both take this class, which gives all of it back. Written once instead of
   as two hand-copied resets that drift apart. */
.unbtn{height:auto; padding:0; background:none; border:0; border-radius:0;
  font:inherit; color:inherit; cursor:pointer}
.lbl{color:var(--label); font-size:12px}
.count{margin-left:auto; color:var(--dim); font-variant-numeric:tabular-nums;
  font-size:12px}

section{margin:24px 0 0}
h2{display:flex; align-items:baseline; gap:9px; margin:0 0 7px;
  font-size:14px; font-weight:600; color:var(--head);
  letter-spacing:.02em}
h2 .n{font-size:11px; font-weight:400; color:var(--label);
  font-variant-numeric:tabular-nums}
h2 .rule{flex:1; height:1px; background:var(--line)}
/* The heading doubles as the section's disclosure control. */
h2 .fold{display:flex; align-items:baseline; gap:9px}
h2 .fold:hover{color:var(--gold)}
h2 .fold:focus-visible{outline:1px solid var(--teal); outline-offset:2px}
/* A CSS triangle rather than a glyph: at 10px a character caret lands on a
   different pixel in every font, and this has to line up with the rule. It
   points right when its control is closed and down when it is open -- which is
   what the attribute selector keys on, so the section headings and the "one of
   N" cells share one rule without either knowing about the other. */
.car{width:0; height:0; align-self:center;
  border-left:5px solid var(--label); border-top:4px solid transparent;
  border-bottom:4px solid transparent;
  transform:rotate(90deg); transition:transform .12s ease}
[aria-expanded=false] .car{transform:rotate(0)}
@media (prefers-reduced-motion:reduce){.car{transition:none}}

/* No overflow on .scroll, deliberately. `overflow-x:auto` makes an element a
   scroll container in BOTH axes -- the spec turns a `visible` axis into `auto`
   as soon as the other one isn't visible -- and a sticky element sticks to its
   nearest scrollport, not to the viewport. So the header below would measure
   its `top` from the top of the table, see that its natural position (0) was
   already above the 51px it was told to hold, and push itself DOWN 51px, on
   top of the first row of data. The horizontal scroll this buys is only needed
   where the header is static anyway; see the media query. */
table{width:100%; border-collapse:collapse; table-layout:fixed}
/* 51px is the toolbar's own height -- 9px padding, a 32px control, 9px
   padding, 1px border -- so the header pins flush beneath it. The control
   height is fixed above to keep that arithmetic true. */
thead th{position:sticky; top:51px; z-index:4; background:var(--panel);
  border-top:1px solid var(--line); border-bottom:1px solid var(--div);
  padding:7px 10px; text-align:left; font-size:10px; font-weight:600;
  letter-spacing:.09em; text-transform:uppercase; color:var(--label);
  cursor:pointer; user-select:none; white-space:nowrap}
thead th:hover{color:var(--head)}
.num{text-align:right; font-variant-numeric:tabular-nums}
tbody tr{border-bottom:1px solid var(--line)}
tbody tr:hover{background:var(--panel)}
tbody td{padding:6px 10px; vertical-align:top}

/* 60px, not 50: the sprite's own cells run to 45px (the inline width comes from
   the coordinate table) and the shared 10px cell padding left 30px for them. */
.c-ic{width:60px; padding-left:7px; padding-right:6px}
/* The one asset this page fetches rather than carries. out/icons.webp is served
   from beside this document because wrangler uploads all of out/, and the main
   page's copy of the same sheet is its own -- inlined, at 4.8 MB of base64, for
   a page that has no second document to share it with. */
.ic{display:block; background-image:url(icons.webp);
  background-repeat:no-repeat}
.noicon{display:block; width:42px; height:42px; border:1px dashed var(--line)}
.c-n{width:158px}
/* At most three digits live in these four, so each gets the width of three
   digits and nothing else. The labels wrap onto two lines rather than setting
   the column width, which is why they are written with a plain space. */
.c-lv,.c-lr,.c-ml,.c-xl{width:44px; padding-left:6px; padding-right:6px;
  color:var(--dim); white-space:normal}
/* auto, so these two take whatever the five fixed columns leave -- 382px each
   at this width, against the longest line in the corpus at 347px. They were
   35% and are auto now because the fixed five already name their widths: a
   percentage here would only restate what the leftover space already decides.
   (The 161px they used to render at was not this rule's doing -- see HEAD.) */
.c-a,.c-w{width:auto}

.nm{color:var(--val)}
.c-n a:hover{color:var(--gold)}
tr.q-rare .nm{color:var(--t-rare)}
tr.q-unique .nm{color:var(--t-unique)}
tr.q-normal .nm{color:var(--t-normal)}
.mark{display:inline-block; margin:4px 4px 0 0; padding:1px 5px;
  border:1px solid var(--div); border-radius:2px; font-size:9px;
  letter-spacing:.07em; text-transform:uppercase; color:var(--label)}
.mark.roll{color:var(--gold); border-color:rgba(227,186,107,.35)}
.mark.warn{color:#e0a06a; border-color:rgba(224,160,106,.4)}

.fx{margin:0 0 3px; font-family:var(--doc); font-size:13px; color:var(--val)}
.fx:last-child{margin-bottom:0}
.fx.loose{color:var(--dim)}
.tag{margin-left:6px; font-family:"Segoe UI",sans-serif; font-size:9px;
  font-style:normal; letter-spacing:.07em; text-transform:uppercase;
  color:var(--teal)}
.none{color:var(--faint)}
/* Closed, the cell states the one thing worth knowing at a glance: the bonus is
   not fixed. The list is behind the button rather than beside it. */
.oneof{display:inline-flex; align-items:center; gap:5px;
  font-size:9px; letter-spacing:.08em; text-transform:uppercase;
  color:var(--gold)}
.oneof:hover,.oneof:focus-visible{color:var(--head)}
.oneof:focus-visible{outline:1px solid var(--teal); outline-offset:2px}
.pool ul{margin:3px 0 0; padding:0; list-style:none}
.pool li{font-family:var(--doc); font-size:13px; color:var(--val);
  padding-left:11px; position:relative}
.pool li:before{content:"\\2022"; position:absolute; left:0; color:var(--faint)}
.hidden{display:none}

footer{margin:32px 0 64px; padding-top:15px; border-top:1px solid var(--line);
  color:var(--dim); font-size:12px; max-width:80ch}
footer h3{margin:0 0 7px; font-size:11px; color:var(--label);
  letter-spacing:.09em; text-transform:uppercase}
footer p{margin:0 0 8px}
footer code{font-family:Consolas,monospace; color:var(--val); font-size:11px}
footer b{color:var(--val); font-weight:600}
footer a{color:var(--label)}
footer a:hover{color:var(--gold)}

/* Below this the toolbar can wrap onto a second line -- which would make the
   51px offset wrong and hide the header behind it -- and the table needs to
   scroll sideways. So the header stops sticking, and horizontal overflow moves
   here, where being a scroll container costs nothing. */
@media (max-width:1040px){
  .bar{position:static}
  thead th{position:static}
  .scroll{overflow-x:auto}
  table{min-width:1040px}
}
"""

JS = """
(function(){
  var q=document.getElementById('q'), minlv=document.getElementById('minlv'),
      sortsel=document.getElementById('sortsel'), dir=document.getElementById('dir'),
      count=document.getElementById('count'),
      rows=[].slice.call(document.querySelectorAll('tbody tr')),
      quals=[].slice.call(document.querySelectorAll('button[data-q]')),
      secs=[].slice.call(document.querySelectorAll('section')),
      tables=document.getElementById('tables'), asc=true;

  function active(){
    return quals.filter(function(b){return b.getAttribute('aria-pressed')==='true';})
                .map(function(b){return b.getAttribute('data-q');});
  }
  function apply(){
    var term=q.value.trim().toLowerCase(), min=parseInt(minlv.value,10)||0,
        on=active(), shown=0;
    rows.forEach(function(tr){
      var ok=(!term||tr.getAttribute('data-name').indexOf(term)>=0
                       ||tr.getAttribute('data-fx').indexOf(term)>=0)
          && (parseInt(tr.getAttribute('data-lv'),10)>=min)
          && (!on.length||on.indexOf(tr.getAttribute('data-q'))>=0);
      tr.classList.toggle('hidden',!ok);
      if(ok) shown++;
    });
    secs.forEach(function(s){
      var n=s.querySelectorAll('tbody tr:not(.hidden)').length;
      s.classList.toggle('hidden',n===0);
      s.querySelector('h2 .n').textContent=n;
    });
    tables.classList.toggle('hidden',shown===0);
    count.textContent=shown===rows.length
      ? rows.length+' socketables'
      : shown+' of '+rows.length+' socketables';
  }
  function resort(){
    var key=sortsel.value, sign=asc?1:-1;
    rows.sort(function(a,b){
      if(key==='name') return sign*a.getAttribute('data-name')
                                     .localeCompare(b.getAttribute('data-name'));
      var x=parseInt(a.getAttribute('data-'+key),10)||0,
          y=parseInt(b.getAttribute('data-'+key),10)||0;
      // data-fam already carries the tier, so reversing it reverses a family's
      // ladder as well as the families. The level below it only ever breaks a
      // tie between rows that are not embers, where data-fam is a constant --
      // it is what keeps a section that has no families in level order.
      if(key==='fam')
        return sign*(x-y)
            || (parseInt(a.getAttribute('data-lv'),10)||0)
             - (parseInt(b.getAttribute('data-lv'),10)||0)
            || a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
      return sign*(x-y)
          || a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
    });
    rows.forEach(function(tr){ tr.parentNode.appendChild(tr); });
  }
  q.addEventListener('input',apply);
  minlv.addEventListener('input',apply);
  quals.forEach(function(b){
    b.addEventListener('click',function(){
      b.setAttribute('aria-pressed',
        b.getAttribute('aria-pressed')==='true'?'false':'true');
      apply();
    });
  });
  // Collapsing is the reader's, not the filter's. A folded section keeps its
  // heading and its count -- which apply() keeps current, so a search still
  // says how much is waiting behind a fold -- and nothing here unfolds a
  // section on the reader's behalf, because a filter that silently reopens
  // what you closed is worse than one that leaves it alone.
  secs.forEach(function(s){
    var b=s.querySelector('h2 .fold'), box=s.querySelector('.scroll');
    if(!b||!box) return;
    b.addEventListener('click',function(){
      var open=b.getAttribute('aria-expanded')==='true';
      b.setAttribute('aria-expanded',open?'false':'true');
      box.classList.toggle('hidden',open);
    });
  });
  // A rolled pool expands in place, under the label that named it. Same
  // contract as a section fold: it opens when asked and closes when asked, and
  // filtering never touches it.
  [].slice.call(document.querySelectorAll('.oneof')).forEach(function(b){
    var box=document.getElementById(b.getAttribute('aria-controls'));
    if(!box) return;
    b.addEventListener('click',function(){
      var open=b.getAttribute('aria-expanded')==='true';
      b.setAttribute('aria-expanded',open?'false':'true');
      box.classList.toggle('hidden',open);
    });
  });
  sortsel.addEventListener('change',function(){resort();apply();});
  dir.addEventListener('click',function(){
    asc=!asc; dir.innerHTML=asc?'&#8595;':'&#8593;'; resort(); apply();
  });
  [].slice.call(document.querySelectorAll('thead th[data-key]')).forEach(function(th){
    if(th.getAttribute('data-key')==='a'||th.getAttribute('data-key')==='w') return;
    th.addEventListener('click',function(){
      sortsel.value=th.getAttribute('data-key'); resort(); apply();
    });
  });
  resort(); apply();
})();
"""

# The document, with markers rather than %-formatting: the CSS and JS below are
# full of characters that a format string would eat. build.write_page() has the
# same shape for the same reason.
DOC = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Socketables &mdash; Torchlight II</title>
<style>
__CSS__</style>
</head>
<body>
<header class="top"><div class="wrap">
  <p class="back"><a href="index.html">&larr; Item Database</a></p>
  <h1>Socketables<small>Torchlight II</small></h1>
  <p class="lede">Every gem, ember, skull and eye the game ships, in one table.
  A socketable grants <b>one thing in armor or a trinket and a different thing
  in a weapon</b>, and the game files them separately &mdash; so they get a
  column each. The embers run family by family, Speck up to Giant; everything
  else runs by item level.</p>
</div></header>

<div class="bar"><div class="wrap">
  <input id="q" type="search" placeholder="Search name or effect&hellip;"
         autocomplete="off" aria-label="Search socketables">
  <span class="lbl">Item level &ge;</span>
  <input id="minlv" type="number" min="0" max="99" value="0"
         aria-label="Minimum item level">
  <button data-q="normal" aria-pressed="false">Normal</button>
  <button data-q="rare" aria-pressed="false">Rare</button>
  <button data-q="unique" aria-pressed="false">Unique</button>
  <span class="lbl">Sort</span>
  <select id="sortsel" aria-label="Sort by">
    <option value="fam" selected>Family, then tier</option>
    <option value="lv">Item level</option>
    <option value="lr">Required level</option>
    <option value="ml">Minimum level</option>
    <option value="xl">Maximum level</option>
    <option value="name">Name</option>
  </select>
  <button id="dir" title="Reverse the order" aria-label="Reverse the order">
    &#8595;</button>
  <span class="count" id="count"></span>
</div></div>

<div class="wrap"><div id="tables">__SECTIONS__</div>
<footer>
  <h3>Reading the columns</h3>
  <p><b>Req. Lv</b> is the character level the game requires for this
  socketable. No socketable item file carries it and TIDBI's 2014 export has it
  for none of them, so it is read from the game's own curve &mdash;
  <code>MEDIA/GRAPHS/STATS/ITEM_LEVEL_REQUIREMENTS_SOCKETABLE.DAT</code>, whose
  105 points are every one of them <code>max(1, level &minus; 8)</code>. The
  wiki's <code>Gems (T2)</code> column follows the same rule, which is what
  settles the nine skull rows where its own numbers do not.</p>
  <p><b>Min Lv</b> and <b>Max Lv</b> are the game's <code>MINLEVEL</code> and
  <code>MAXLEVEL</code>: the band of item levels this socketable drops in, not a
  requirement of any kind. An earlier version of this page read
  <code>MINLEVEL</code> as a socketing gate and printed it under the heading
  "Req. Item Lv", which stated a requirement the game does not have while hiding
  the one it does. The two agree for an ember by coincidence &mdash; both are
  level &minus; 8 &mdash; and come apart for a skull, where the band floor is
  level &minus; 2. A <code>MAXLEVEL</code> above 999 is the game's way of saying
  "never stops dropping": the files hold four different runs of nines (9999,
  99999, 999999, 9999999) for the same idea, so 256 items were collapsed to the
  999 the rest of them already use. <code>MINLEVEL</code> sentinels are left
  alone.</p>
  <p><b>rolled</b> marks the __POOLED__ rare embers (Blood, Chaos, Iron, Void).
  Their item files declare an empty affix list, so what one grants is not fixed:
  the game rolls one effect from the armor pool and one from the weapon pool
  when it drops. Each cell lists the whole pool it rolls from, behind its own
  disclosure.</p>
  <p><b>either</b> marks the __EITHER__ socketables whose bonus applies in
  whichever slot it goes &mdash; the six Lucky Coins and the six Lucky Dice.
  Their affixes declare both armor and weapon in the game files, so the line
  appears in both columns rather than being assigned to one. The three
  Torchlight 1 fish scales were the other three until they left the database;
  the corpus still holds their affixes, which is why the files count 15.</p>
  <p><b>heading lost</b> and <b>sources differ</b> together mark __MARKED__ rows
  where the two sources for this split disagree. TIDBI's 2014 export carries the
  split as <code>Weapon:</code> / <code>Armor/Trinket:</code> lines, and the game
  files carry it as an ordered affix list where each affix declares its own
  slots. They agree on __AGREE__ of the __ROWS__. Where a heading is simply
  missing, TIDBI's lines run into the block above and are reassigned from the
  files &mdash; Skull of Quato is the clearest case, its four <code>+64
  &lt;element&gt; Armor</code> lines sitting under a Weapon heading when the
  wiki also files them under Armor/Trinket. Where TIDBI prints a heading the
  files contradict, the row is flagged instead of silently corrected: a missing
  heading is provably a gap, but a wrong one is not something the files alone
  can settle.</p>
  <p>Five socketables are deliberately <b>not</b> on this page: Unusual, Magic,
  Enchanted, Marvelous and Runic Component. They are the Transmuter's recipe
  inputs &mdash; handed out by
  <code>MEDIA/SPAWNCLASSES/RECIPE_COMPONENT.DAT</code> &mdash; and this page is
  the socketable families. They are still in the database and still on the
  site, under Misc.</p>
  <p style="margin-top:13px;color:var(--faint)">Built from
  <code>out/items.json</code> by <code>src/socket_page.py</code>, which
  <code>src/build.py</code> runs. Nothing here modifies the game files.
  <a href="index.html">Item Database &rarr;</a></p>
</footer>
</div>
<script>
__JS__</script>
</body>
</html>
"""


def write(items, coords):
    """Write out/socketables.html. Returns (bytes, stats).

    `stats` carries what the build prints and pins: the row count, the
    per-section counts, and how many rows carry each mark.
    """
    rows = load(items, coords)

    # Level order inside a section: the question a gem table answers is "what
    # can I use now, and what does it become". The embers are the exception --
    # ember_key() orders them family-major, tier-minor, and because a family's
    # seven ranks ascend by level anyway, the same question is still answered,
    # just one family at a time instead of all eight interleaved.
    order = {k: i for i, k in enumerate(KINDS)}
    rows.sort(key=lambda r: (order[r['kind']], ember_key(r),
                             r['lv'] or 0, r['name']))

    by_kind = collections.Counter(r['kind'] for r in rows)
    splits = collections.Counter(r['status'] for r in rows)
    pooled = sum(1 for r in rows if r['pa'] or r['pw'])
    shared = sum(1 for r in rows if r['shared'])
    marked = splits['split'] + splits['conflict']
    # 'files' is the status that means the two sources agreed -- see slots.
    # _classify: the files decided it and TIDBI either printed the same heading
    # or printed none. It is NOT rows-minus-marked: 'text' (7) is a row the
    # files could not decide so TIDBI's headings stand, and 'none' (28) is the
    # pooled embers, which have no effect lines at all. Neither is agreement,
    # and counting them as agreement would overstate this by 35.
    agree = splits['files']

    doc = (DOC
           .replace('__CSS__', B.bitter_face() + CSS)
           .replace('__SECTIONS__', sections(rows))
           .replace('__JS__', JS)
           .replace('__POOLED__', str(pooled))
           .replace('__EITHER__', str(shared))
           .replace('__MARKED__', str(marked))
           .replace('__AGREE__', str(agree))
           .replace('__ROWS__', str(len(rows))))

    path = os.path.join(paths.OUT, PAGE)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(doc)
    return len(doc.encode('utf-8')), {
        'rows': len(rows), 'by_kind': by_kind, 'pooled': pooled,
        'shared': shared, 'marked': marked, 'agree': agree,
        'splits': splits,
    }

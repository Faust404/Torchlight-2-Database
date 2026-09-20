# Item card studies

The tooltip card as settled — the P3 corner, the requirement block as chips, the
spawn band under it — on ten items. **Nothing here is wired into the site** —
`db/app/**` is untouched and `db/out/index.html` is unaffected.

    python card_mockups/build_mockups.py     # -> card_mockups/index.html
                                             #    card_mockups/affix.html
                                             #    card_mockups/set.html

`build_mockups.py` reads only the pipeline's *output* (`db/out/items.json`,
`sets.json`, `icons.json`, `icons.png`). It does not run the pipeline and does
not write to `db/out/`. The three pages are generated — `index.html` from
`mock.tpl.html`, `affix.html` from `affix.tpl.html`, `set.html` from
`set.tpl.html`. Edit the template and rebuild.

## Settled

The card is the tooltip shape with **P3** in the top-right corner — the slab
serif, in the case the words are written in — and the requirement block as
**chips**. The four readings are off the page; what follows is the one that
survived.

**Structure.** The `Aug` badge is gone. Item level moved to the corner and reads
`Level 50`, not `Item Level 50`. The class gate sits beneath it and is printed
once — it does not appear under Requirements. Sockets are in the corner too. A
weapon's numbers are stated in one block at the top: damage per second, then
attack speed with the band and the seconds in brackets
(`Slow attack speed (1.21 seconds)`), then weapon range, then the damage the
weapon is made of. The augmented group sits **below** the base affixes, so the
weapon's own stats are read before the ones it could grow into.

**The element marks.** Every damage and armour line carries the game's own glyph
for its type, between the value and the word (`169`, glyph, `Physical Damage`).
The order is not a preference: the item tooltip's own layout,
`MEDIA/UI/PIECES/EQUIPMENT_ROLLOVER.LAYOUT`, names a value widget, then an image
widget, then a label, and that is the order the card reads in. It is also what
keeps the numbers in a column — leading with the mark would step each row across
by that glyph's own width.

The five are the **shield-less** variants — `resist_physicalc`, `resist_firec`,
`resist_iced`, `resist_electricc`, `resist_poisonc`. The shielded
`ig_resistance_*` set is the one a player is likelier to picture, but that one is
the character sheet's (`INSPECT`, `PET_INVENTORY`);
`EQUIPMENT_ROLLOVER.LAYOUT` names exactly the shield-less five, so the rollover
in game draws these.

They are a one-off out of `MEDIA/UI/HUD/INGAMETEXTURESHEETS4.PNG`, five 27×29
tiles at x=996 — physical y=156, fire y=342, ice y=249, electric y=435,
poison y=63 — committed as `elements.png` (75×16, five 15×16 tiles). So the
mockup still reads nothing at build time but the pipeline's output; the PAK is
opened once, by hand, not by `build_mockups.py`. The recipe, re-run to check it
and byte-identical to the committed file:

```python
tile = sheet.crop((996, y, 996 + 27, y + 29))
r, g, b, a = px[x, y]
if a < 16:
    px[x, y] = (r, g, b, 0)          # the ice glyph arrives with a faint halo
strip.paste(tile.resize((15, 16), Image.LANCZOS), (i * 15, 0))
```

Each whole tile is scaled rather than each glyph's ink box being re-normalised,
so the artist's own sizing and centring within the tile is what survives — the
marks keep their relative weight instead of being forced to a common height.

**They cost no height.** Every card measures identically to the pixel with them
and without them, at all four viewports: at this size the mark sits inside the
12.5px leading the line already had. `--esprite`, `--ew` and `--eh` are set the
same way `--sprite` is. `DMGTYPES` in `mock.tpl.html` has to stay in step with
the same list in `build_mockups.py` — it is both the order of the strip and the
order the card prints the lines in.

**Set colour.** The ladder's heading — `Set: Mondon's Vestment`, name and prefix
alike — takes the set purple (`--t-set`, `#a855f7`) and the rung figures are
tints of it. The rungs a set gates above what a
character can actually wear drop to a muted shade of the same hue rather than the
grey they used to be. The bonus text itself takes neither the purple nor the
affixes' magic green — it is an effect, not a set fact, and either colour would
file it as one. It is `#bdb4a6` in the card's own serif, its numbers lifted by
the same rule the affixes use.

**Augmented weapons.** The group on Bloodbath uses the shipping page's own three
devices, lifted from `db/app/app.css`: the task as a gold chip (`.task` —
`#241d12` ground, gold text, `#2b251b` border), a dashed ruled divider stating
the condition in words (`.cond`), and the gated stats behind a left rule with
dim bullets (`.fx.locked`). The base affixes keep the tooltip's magic green, so
*active* and *conditional* are told apart by colour as well as by rule.

**Requirements.** Each value is a chip in the corner's own voice — the slab
serif, sentence case, the same 3px radius — so the card has one chip language
rather than two. The `or` sits between the level chip and the attribute chips as
a word, which makes the either/or structural instead of a rule drawn across the
card. Above them, one `Requirements` heading does the work the word `Required`
was doing on every line, and that is what makes `Player Level` affordable
spelled out in full.

**The spawn band.** `Min Level 45 · Max Level 34` in plain text under the
requirements. Deliberately *not* chips: a requirement is something the player
has to be or do, and this is a fact about where the item comes from. Boxing it
would file it as a third gate. The numbers print as the data has them —
`999` is shown as `999`, not rewritten to `uncapped`.

## The ten items

| Item | id | Carries |
|---|---|---|
| Aenigma | `legendary_axe01` | damage, DPS, speed, range, 2 sockets, an either/or requirement, a min with no max |
| Mondon's Belt | `engineer_06_belt_alt_set` | armour, a class gate, a ten-rung ladder, a `999` max |
| Blood Ember Shard | `tl2_bloodember_rank3` | a socketable with no affixes — cut content, see below |
| Flame Ember Shard | `tl2_flameember_rank3` | a live socketable: two affixes and the socket line |
| Adeptus Helm | `caster_03_helmet` | a class gate, a requirement with no player-level branch, a closed band |
| Bloodbath | `sword_u07b` | the augmented (locked) group, a max with no min |
| Twinferno Wand | `z_wand_m01_set` | a set built to be worn as a pair — the rung the shipped dimming test wrongly muted |
| Five Dragons Falconet | `cannon_m05slots` | four sockets, an either/or with two attributes, a `ml` above its own level |
| Grand Architect Tunic | `engineer_05_chest_alt_set` | the one ladder in the corpus that gates a rung past what a character can wear |
| Aristocrat Belt | `pimp_01_belt_alt_set` | a ladder that agrees with itself, and a rung carrying four bonuses |

The last two are here for the ladder alone — the only two states of it the first
eight never reach. See *Set bonuses* below.

## What the measurements say

Taken at a 1600px viewport, cards at 366px, filled in at render time from
`getBoundingClientRect`. Every card is the same width, so these are comparable.
The heights are identical at 1200/900/500px — the cards are fixed-width and the
row simply wraps (4 columns → 2 → 2 → 1).

| Item | Height |
|---|---|
| Aenigma | 494 |
| Mondon's Belt | 670 |
| Blood Ember Shard | 261 |
| Flame Ember Shard | 319 |
| Adeptus Helm | 407 |
| Bloodbath | 645 |
| Twinferno Wand | 489 |
| Five Dragons Falconet | 427 |
| Grand Architect Tunic | 634 |
| Aristocrat Belt | 485 |

**Two corrections against the first pass of these numbers.** Mondon's Belt read
782 and Twinferno Wand 530 until the ladder was fixed: each rung is a `<p>`, and
`.rung` was the only paragraph in the card that never got a `margin:0` reset, so
every rung was carrying the browser's default `1em` top and bottom — 12.5px at
this size. On a ten-rung ladder that is ~112px of margin nobody asked for, and
on Twinferno Wand it put a blank line between the last rung and the rule above
Requirements. Mondon's Belt is now 670; the other nine are unchanged by this.

**The `set ships N` note is gone.** A rung the set cannot reach used to carry it
on the right, and it was the mockup talking rather than the game: the only set
text in `sets.json` is the name and the bonus, and the `1 pieces (2 piece set)`
in the ladder's own heading already states the count. It was also long enough to
force Twinferno Wand's rung onto a third line, so dropping it takes that card
from 518 to 489.

For comparison, on the same items the four readings measured: **R1** stated in
full 504, **R2** trimmed 504, **R3** headed 500, **R4** chips 441 — on Aenigma.
The settled card is 494, so the heading, the spelled-out `Player Level` and the
spawn band together cost 53px over bare R4, and it still lands 10px shorter than
R1 while stating strictly more.

**R2 saved nothing.** It measured identically to R1 on all seven items —
`Required Player Level: 61` and `Player Level 61` are both one line. The
repetition cost reading, not height.

**R3 was a wash, and on four items a loss.** The heading buys the collapse of the
attribute branch onto one line, worth 3–4px on the three items that have both a
level and two attributes, and costs a full 16–17px on the four where the branch
collapses to nothing. Adeptus Helm went 397 → 414. The heading earns its place
here only because R4's chips give it a block to name.

## The either/or, and two exceptions

**A requirement is a player level *or* all of the attributes**, whichever the
player reaches first — not a conjunction. A reader who takes it for an "and" has
been told something false about the item. The class gate in the corner is a
separate, harder restriction on top of that, and is why it is not repeated under
Requirements. The `or` is set in `--dim` (4.95:1) rather than the faintest
colour on the card, since it is the one word that must not be misread.

**Socketables are read differently.** A gem's `MINLEVEL` is a gate on the item it
is socketed into, not on the player, so Blood Ember Shard states
`Required Item Level to Socket: 28` on its own line instead of as a chip. The
phrase does not survive being shortened, and it does not fit the pattern the
other cards use.

**Socketables get no spawn band.** It is the same field, so printing
`Min Level 28 · Max Level 46` underneath would put the number 28 on the card
twice under two different labels.

### Four Ember families are cut content

Blood Ember Shard renders with no affixes at all, which looks like a bug and is
not one. The game's own files settle it:

- Its `.DAT` is a five-string shell that inherits from
  `tl2_bloodember_BASE.dat`.
- That BASE carries an `AFFIXES` list, and for Blood Ember it is **`list(0)` —
  empty**. For Flame, Ice, Spark and Venom Ember it is **`list(2)`**, and those
  two entries are exactly the effects TIDBI records
  (`Weapon: +22 Fire Damage`, `Armor/Trinket: +40 Fire Armor`).
- Corroborating: the live four declare `UNITTYPE = SOCKETABLE` and carry a
  `RARITY` spawn weight on their rank files; the dead four declare
  `UNITTYPE = BLOOD EMBER` and carry none.

So **Blood, Chaos, Iron and Void Ember — 32 gems, four families of eight ranks —
were cut before shipping.** Models, icons, names and drop-level bands exist;
effects were never written. TIDBI is right to have no `effects.csv` rows for
them, and the pipeline is right to emit them with no `fx`. It reads as a bug
because the pipeline's effect text comes from TIDBI, not the DAT — but here the
DAT agrees.

Flame Ember Shard sits beside it in the grid precisely so the socketable case is
represented by a gem that drops. Same rank, same family shape, two affixes.

Worth deciding separately: whether a site should show cut content at all. Thirty
two of the 178 socketables in the corpus never spawn.

## MINLEVEL and MAXLEVEL

Established while adding the band, and worth writing down because the previous
conclusion was that `MINLEVEL` is a socketing ladder.

`MINLEVEL` and `MAXLEVEL` are the band the item **drops in**. `ml <= lv <= xl`
holds on 1,862 of the 1,955 items carrying all three. The Blood Ember ranks
settle it — both fields step by 14 per rank, exactly as the gem's own level does:

| rank | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| `lv` | 8 | 22 | 36 | 50 | 64 | 78 | 92 |
| `ml` | 1 | 14 | 28 | 42 | 56 | 70 | 84 |
| `xl` | 18 | 32 | 46 | 60 | 74 | 88 | 999 |

A *maximum* level for socketing something is not a thing that can exist, which
is what rules the socketing reading out.

**Not every item has the field, and the pattern is meaningful.** Of the 5,334
weapons, armor and accessories, **2,263 (42%) carry at least one of the two**;
3,071 carry neither. Broken down by tier it is the hand-authored items that have
a band:

| Tier | Items | Has a band | |
|---|---|---|---|
| Legendary | 92 | 92 | 100% |
| Set | 556 | 527 | 95% |
| Unique | 1,272 | 847 | 67% |
| Unclassified | 111 | 31 | 28% |
| Rare | 1,743 | 547 | 31% |
| Normal | 1,560 | 219 | 14% |

That is what a spawn band should look like: a fixed band is a property of an
authored drop, while a randomly-generated magic item takes its level from where
it dropped. It is also further evidence against the socketing reading — a
socketing gate would have to exist on every socketable, not on the 14% of
normals that happen to be authored.

By category, for completeness:

| Category | Items | Has `ml` | Has `xl` | Both | Neither |
|---|---|---|---|---|---|
| Armor | 1,831 | 778 | 802 | 663 | 914 |
| Weapons | 1,461 | 418 | 369 | 199 | 873 |
| Accessories | 2,042 | 567 | 700 | 509 | 1,284 |
| Misc | 842 | 656 | 795 | 656 | 47 |

Misc is the best covered of the four, which is unsurprising — spells, quest
items and maps are all authored.

### Neither other source has these fields

Before accepting a 42% coverage figure it is worth asking whether the other two
sources fill the rest. They do not, and one of them only looks like it would.

**TIDBI carries both columns and is still not a second source.** `items.csv` has
`MINLEVEL` (col 19) and `MAXLEVEL` (col 45), which reads like a fallback for
exactly the items the DAT leaves blank. Joined through the pipeline's own key
(`ConsolNAME` uppercased ↔ the DAT's `NAME`) across all 6,262 records:

| | result |
|---|---|
| Both present, `MINLEVEL` | 2,362 — identical 2,362 |
| Both present, `MAXLEVEL` | 694 — identical 694 |
| Disagreements | **0** |
| DAT blank, TIDBI has it | **0 of 3,202** |
| DAT has one only, TIDBI supplies the other | **0 of 392 and 0 of 641** |

Its 2,499 banded records are a strict subset of the DAT's 3,060 — it never knows
anything the DAT does not. That is what TIDBI is: a 2014 scrape of the same
files, so its columns echo them, and a field the file omits has nothing to echo.

**Alfgeir has no such field at all.** Its 1,781 records carry one level key,
`LevelRequirement` — the player-level gate, which is `lr` on the card, a
different thing. Nothing min/max-level-shaped appears in any record's
`properties` either.

So **for the 3,071 equipment items with no band there is nowhere else to
look.** The number is absent because the file omits it, not because the pipeline
dropped it — `MINLEVEL` and `MAXLEVEL` are both in `scalar_fields`' `KEEP` list,
read whenever a file carries them. The pipeline's fallback list at
`db/build.py:984` takes `ml` and `xl` from the DAT record alone, and that is the
right scope for it.

Worth splitting that 3,071 when judging how much is really missing:

| Tier | No band | Of | |
|---|---|---|---|
| Normal | 1,341 | 1,560 | |
| Rare | 1,196 | 1,743 | |
| Unclassified | 80 | 111 | |
| Unique | 425 | 1,272 | |
| Set | 29 | 556 | |
| Legendary | 0 | 92 | |

2,617 of the 3,071 are Normal, Rare and Unclassified — tiers whose level comes
from where the item dropped, so having no authored band is the correct state
rather than a hole. The genuinely authored-but-silent residue is **454 items**:
425 Unique and 29 Set, with Legendary fully covered.

### The sentinel values, printed as they are

The card prints whatever the fields say. `999` says "no ceiling" to anyone who
has played the game, and rewriting it to `uncapped` was editorialising a number
the reader can see. Two things worth knowing about the raw values:

- `999` is not the only ceiling — `999999` (133 items) and `9999999` (112) also
  appear, along with a handful of others. All mean the same thing.
- A **`MINLEVEL` of `777`** (26 items: `axe_bandit`, `Cursed Fire Sword`,
  `C_Sturm_Melee_Axe` and similar) marks **monster-only gear**, which never drops
  for a player. Those items have `lv = 1`. `998` appears 8 times, on `_BASE`
  template files such as `tl2_bloodember_BASE`, which are not real items at all.

An item carrying only one of the two shows only that one — Aenigma has `ml` and
no `xl`, Bloodbath the reverse.

## Affix text: colour and font

`affix.html` is a second sheet, on the affix block alone: five colour
treatments of the same six specimens, then four settings of the face. Every
specimen sits on `--panel` rather than the page ground, because that is the
ground it will be read on — the page's own darker `--bg` flatters all of them
equally and tells you nothing.

Six specimens, because every shape an affix string takes had to appear: a
percent, a bare number, a line carrying two numbers, a negative, an element, a
plain sentence with no number at all (`Explosion On Death`, which no amount of
emphasis can touch), a socketable's slot prefix, and — added after the first
pass measured every variant identical — the longest affix in the corpus, 70
characters, so the wide faces would have something to wrap on.

### The game colours blocks, not stats

The item rollover's own layout settles what the question even is.
`MEDIA/UI/PIECES/EQUIPMENT_ROLLOVER.LAYOUT` gives a colour to each *kind of
block*, and never to a stat:

| Widget | Role | Colour |
|---|---|---|
| `Effects`, `Sets` | the headings over those blocks | `#1596EF` |
| `Enchantments` | the enchanter count | `#F7AF09` |
| `SocketName` | a socketed gem's name | `#D6B300` |
| `SocketEffects` | what the gem grants | `#FBE204` |
| `FlavoredText` | the flavour line | `#00FF40` |
| `Description` | **the affix body** | none — left to the magic green |

So the affix body is the one block the layout does not colour, and the game has
no vocabulary at all for painting one stat differently from the next. This sheet
does not invent one; every variant either reweights what is already in the
string or restates the colour the game does use.

**Two candidates died before they were drawn**, and both are worth recording
because each looks obviously right until it is checked.

**Element tint** — sample the five element marks for a hue, paint an elemental
affix line with it. It fails on the art. The marks are drawn to be told apart by
*shape*, not by colour: their most saturated pixels give physical `#8C8131`
against fire `#89812F`, two colours nobody can separate, and poison lands on
`#3D9032`, which is the magic green it would be replacing. The five-way
distinction does not exist in the source art, so it cannot be borrowed from it.
This agrees with the layout above, which is two independent lines of evidence
saying the same thing.

**Penalty marked by its sign** — 125 unique affix lines carry a negative number,
and the sign does not mean what it looks like. `-10% Physical Damage Taken` and
`-1 to all item character stat requirements` are both things the player wants.
Sorting the penalties from the benefits here means reading the prose, which is
classification, not emphasis.

### The five colour treatments

| | | Contrast on `--panel` |
|---|---|---|
| **C1** | one green, `#7CC24A` — today | 8.33:1 |
| **C2** | value lifted to `--head`, words green | 10.64:1 / 8.33:1 |
| **C3** | value lifted to `--val`, words dimmed `#5F8F3E` | 11.72:1 / 4.72:1 |
| **C4** | no green — lines `--body`, values `--head` | 10.23:1 / 10.64:1 |
| **C5** | the game's own `#319C00`, unlifted, unemphasised | 5.07:1 |

**A correction, and it is against this project's own note.** The card carries a
comment saying the magic green was "lifted to reach 4.5:1 on the panel". That is
not true — `#319C00` measures **5.07:1** and passes AA on its own. The lift is a
preference, not a repair: `#7CC24A` takes it to 8.33:1, which is about how
bright a line wants to be in a card read against a dark ground. C5 is on the
sheet so the choice can be seen rather than argued, and the comment now says
what actually happened. (The other lift in the project — set `#7B00CE` to
`#A855F7` — does hold up: `#7B00CE` measures 2.35:1.)

**No colour variant costs anything.** All five measure a 713px card and a 40px
long line — two lines — at a 268px card width. The only geometric effect of any
of them is the value's weight: lifting it to 600 widens the first specimen line
from 135.23 to **135.86px**, a third of a pixel nobody can see.

**C2 is chosen.** It is not a new idea — it is the rule the card already uses
two sections above, where every damage value is set in `--head` against a
`--body` label. The affix block was the one place it was not applied.

C3 is a step further and starts to read as disabled rather than secondary. C4
reads perfectly well in isolation and is still the one to refuse: the augmented
group's whole argument is that *green here means active*, and a card whose
active affixes are warm grey has given that up to gain nothing.

### The four faces

| | | Width of the same line |
|---|---|---|
| **F1** | today — the app stack, Segoe UI 13px | 135.23px |
| **F2** | the game's tooltip — Arial bold | 145.59px (+7.7%) |
| **F3** | today's face, tabular figures | 135.23px |
| **F4** | the card's serif — Bitter | 139.34px (+3.0%) |

**F2 is what the game actually does.** `MEDIA/UI/ARIAL.FONT` is
`media/ui/arial.TTF`, size 14, `Bold="true"` — the tooltip body is not just
Arial, it is *bold* Arial, and it reads that way: heavier than the card's own
voice and about 8% wider.

**The game's serif is not available.** The item name above the affixes is
`SerifBig` in the rollover, which resolves through `SERIFBIG.FONT` to
`media/ui/SlingBold.ttf`. That file is copyright 1994 STAR Retrieval Systems,
all rights reserved, with no licence permitting redistribution — so it is not in
this repo and cannot be. F4 tests the card's own serif, Bitter, in its place.
Worth knowing before anyone wonders why the cards do not match the game's name
face: they cannot.

**F3 measured nothing at all, which is the expected result and worth having
confirmed.** It is pixel-identical to F1 — 135.23px, same height, every
specimen. Tabular figures align digits across rows, and an affix is a sentence:
`+8% Critical Hit Chance` and `+93 Ice Armor` have nothing to align with each
other. The device earns its place in the damage block and the requirement chips,
where values do stack; it does nothing here.

**No face changes the wrap.** The 70-character specimen runs to two lines in all
four, and every card measures 676px.

### C2 in each face

The two axes are independent in the stylesheet, so the four cards as they would
actually ship are `.v2` composed with each of `.f1` to `.f4`. All four measure
**676px** — the face costs nothing vertically.

The one thing the composition exposes is the value's weight. C2 lifts it to 600
against 400 words; F2 sets the whole line at 700, so under Arial bold **the words
gain a weight the value does not**:

| | words | value | |
|---|---|---|---|
| C2 × F1 | 400 | 600 | value heavier *and* brighter |
| C2 × F2 | 700 | 600 | words heavier — the cream is doing all the work |
| C2 × F3 | 400 | 600 | identical to C2 × F1, as measured |
| C2 × F4 | 400 | 600 | as C2 × F1, in Bitter |

That is a trade, not a defect to patch in the CSS: Arial bold is bold all the
way through, so choosing the game's own face means choosing colour-only
emphasis. It still reads — 10.64:1 against 8.33:1, warm against cool — but it is
a smaller lift than C2 gets under F1.

### Not decided here

**The socketable's slot prefix.** 243 unique affix lines — every one of them on
a Misc item — open with `Weapon:` or `Armor/Trinket:`, and it is the only
structural distinction an affix string carries. Today it reads as part of the
stat. It is not on this sheet as a variant because it is a different question
from colour and font, and because it wants its own answer: the gate is the same
in every one of the five treatments above.

## Set bonuses: the heading and the ladder

The ladder is the set block — one row per rung, the rung's count at the left, the
bonus beside it. The study is `set.html`, over three sets, and what it turned up
was a data fault rather than a styling one.

**S7 is applied to the card, with S8's heading.** The sheet keeps all eight
variations, because the reasons the others lost are the part worth keeping;
`mock.tpl.html` carries S8 alone.

### `10 pieces` from nine items

The heading reads `16 pieces (10 piece set)` on Mondon's Vestment. The 16 is
`sets.json`'s `c`: how many entries in `items.json` carry that `setid`. Mondon's
ships two item levels of the same seven armour slots — Mondon's at 99, Outercore
at 105 — plus one necklace and one ring, so 7×2+1+1 = **16 records across 9 item
types**. 19 of the 80 sets disagree with themselves this way, and the trinket
sets are the worst: `OUTLANDER_TRINKETS_WARFARE` is one ring and one necklace
with ten item-level variants, and its heading offers `10 pieces (3 piece set)`.

**The 10 is right, though, and it is not a contradiction** — the ladder counts
pieces *worn*, and a character has two ring slots. That is the game's own slot
list rather than an inference: `MEDIA/INVENTORY/` ships `HEAD`, `TORSO`,
`SHOULDERS`, `GLOVES`, `PANTS`, `BOOTS`, `BELT`, `NECKLACE`, `RING1`, `RING2`,
`RIGHTHAND`, `LEFTHAND`, and `RING1.DAT` and `RING2.DAT` differ only in their own
names — both declare `UNIT_TYPE = RING`. Mondon's Ring fills both, so nine item
types wear as ten pieces.

**S2 changes the heading alone** — it quotes the top rung, with the plural fixed.
Twinferno reads `1 pieces` today because the plural is hard-coded. Every specimen
carries `N records · M item types · K worn` in its header.

**The shipped heading is neither S1 nor S2 — it is S8, and it keeps both
numbers.** S2's fix was to drop `c`; the card instead gives the two quantities
two different words, so neither is lost:

```
Set: Mondon's Vestment   16 items · 10 piece set
Set: Twinferno            1 item  ·  2 piece set
Set: Cornerstone          7 items ·  9 piece set
Set: Aristocrat           8 items ·  4 piece set
```

`16 items` is what there is to collect, `10 piece set` is what goes on. The
contradiction was never the arithmetic, it was the word `pieces` doing both jobs.
The set name also takes a `Set:` prefix, which is what tells a reader that
`Cornerstone` is a set and not another affix group.

**Cornerstone is the case for keeping both.** It reads `7 items · 9 piece set`,
and that gap is the whole anomaly in one line — a set file gating nine pieces on
seven that the game ships. S2's heading would have printed `9 pieces`, losing it.
Its plural is built too: Twinferno reads `1 item`, not `1 items`.

### The same number decides which rungs are dimmed

A rung above `c` renders muted. But the number that means "how many pieces can I
be wearing" is not the record count: it is **2 for a ring, 2 for each one-handed
weapon type, 1 for everything else**. Across the corpus that number is the
ladder's own target — **52 of the 80 sets top out at exactly it**, and none goes
above except Cornerstone, seven single-slot items under a nine-rung ladder.
Xtro's Blades is the clearest: a claw and a ring, two item types, a ladder that
runs to 4. Twinferno is the same shape and names itself for it — one wand, a
ladder of two, worn as a pair.

Against that, the shipped test errs in **one direction only**: it dims **15 rungs
across 14 sets** that a character can reach, and admits none that it cannot.
Twinferno's only rung is one of the 15 — the card dims the single bonus of a set
built to be dual-wielded.

**S3 corrects it.** The old heuristic was not unprincipled — a rung above the
record count is unreachable, and that part holds — it simply used a number that
is always at least as large as the right one, so it could only ever be too
strict.

### The treatments

| | |
|---|---|
| **S1** | what ships — sans, flat `#bdb4a6` values, purple pill |
| **S2** | the heading quotes the top rung |
| **S3** | the dimming measures slot capacity, not records |
| **S4** | the bonus text takes `--doc`, as the affixes now do |
| **S5** | C2 applied here: numbers in `--head` at 600, words unchanged |
| **S6** | the pill becomes a plain figure in the set purple |
| **S7** | all of it |
| **S8** | S7, with the shipped heading — the `Set:` prefix and both counts |

Three specimens. Mondon's is the inflated heading and the only ladder long enough
to read as one. Twinferno is one wand with a two-piece ladder — the `1 pieces`
and the wrongly dimmed rung at once. Aristocrat agrees with itself on every count
and is the only specimen with a rung carrying four bonuses, which is where the
blank continuation marker appears.

**S7 is the one taken, and S8 is S7 plus the shipped heading.** Everything below
is about S7's three changes — the serif, the lifted values and the quiet rung.
It removes the one place where the card set two faces in a row — the affixes in
Bitter, the ladder immediately below them in Segoe UI. The serif is not quite
free here as it was on the affix sheet: on `set.html` S1, S2, S3, S5 and S6 each
measure **602px**, S4, S7 and S8 **605px**.

**The three pixels are baseline alignment, not wrapping.** They land entirely on
Aristocrat: measured per specimen, its block goes 197 → 200 under the serif while
Mondon's stays 275 and Twinferno's 95. Aristocrat is the specimen whose top rung
carries four bonuses, so it is the only one with a multi-line `.rt` — and a
multi-line block aligns to its *last* line's baseline, which is where a face with
a taller ascent moves the 16px rung figure beside it. Every `.rt` still renders
the same lines in either face, so nothing here is a wrap.

**On the card the three pixels do not appear at all.** Measured on all four
ladder-bearing cards at 366px, forcing `.rung .rt` back to the UI stack changes
nothing: Mondon's Belt 670/670, Twinferno Wand 489/489, Grand Architect Tunic
634/634, Aristocrat Belt 485/485 — **delta 0** everywhere, including Aristocrat,
whose multi-line rung is on the card too. So the cost belongs to `set.html`'s own
column, not to the ladder.

**Lifting the values broke the muting.** `.rung .rt .n` sets `--head` on the
number and out-specifies `.rung.over .rt`, so an unreachable rung kept the
brightest thing on it. S5 and S7 restate `color:inherit` on the number inside an
`over` rung: the weight stays, the colour dims with the words. Measured
`rgb(141,133,121)` wherever an `over` rung renders.

**The quiet rung costs the muted state most of its signal, and the card is where
that got checked.** In S1 the pill's ground goes dark, which is unmistakable;
with the lozenge gone the state survives only as a colour shift on a 10px figure.
S7 does not remove the rung's box — it keeps the 16px height as the column's
alignment and drops only the ground, the padding and the radius. `set.html`
cannot settle this — none of its three specimens has a rung out of
reach once S3 is applied, so the sheet shows the muted state in S1, S2, S4, S5
and S6 and never in S7. Cornerstone is the only set in the corpus whose ladder
runs past its capacity, so it went onto the card sheet as a tenth item for that
one reason, and its rungs 8 and 9 do read as dimmer than 7 under S7 with no pill
to help: the figure and the text shift together, and the number inside an `over`
rung dims with them instead of keeping its lift.

## Still open

**Card width.** Whether the tooltip stays around 366–400px in the detail pane or
stretches to its 760px is undecided, and it is the one remaining question the
page cannot answer for itself.

**Dual-wield is assumed, not checked.** The capacity model counts every
one-handed weapon type twice. In game that depends on the class, and the shipped
set ladders assume it: Twinferno and Xtro's Blades are built to be worn as pairs.
If a class cannot dual-wield, those top rungs are further away than S3 draws
them — but the game's own ladders are the better authority on intent, and they
say two.

**Cornerstone.** `U_GRAND_ARCHITECT` is the one set whose ladder exceeds its
capacity: seven single-slot items, nothing doubling, a top rung of 9. Either cut
content or a ladder nobody trimmed. Its rungs 8 and 9 are unreachable and both
the old test and the new one dim them, so nothing on `set.html` turns on it. It
is on the card sheet for the opposite reason — it is the only item there whose
ladder reaches the muted state at all.

## Not a proposal

The grid tiles — the 350px `.card`s in the results grid — are untouched. These
studies are about the card shown for one item, which is what the grimtools
reference shows.

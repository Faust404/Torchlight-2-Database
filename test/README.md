# Torchlight II data extraction

Pulling structured data out of Torchlight II's game files, with an eye toward an
item/skill/monster database in the style of <https://www.grimtools.com/db/>.

Standalone project. No dependency on, and no shared code with, the Grim Dawn
work in `D:\Code\Others\grim_dawn_db`.

```
torchlight2_db\
  tl2\      PAK/MAN extraction — the game's own files
  tidbi\    TIDBI item database — a third-party 2014 Access DB (see below)
  db\       the built item database and browser (§7)
```

---

## 1. Where the data lives

Game install: `E:\Games\Steam\steamapps\common\Torchlight II`

**There is no loose game data.** No `MEDIA\`, no `MODS\` — only the exe, DLLs
and `PAKS\`. Everything is in two containers:

| File | Size | Role |
|---|---|---|
| `PAKS\DATA.PAK` | 869,065,014 | the payload |
| `PAKS\DATA.PAK.MAN` | 5,309,883 | the index |

Both formats are cracked; `tl2\index.tsv` holds **70,437 validated file paths**.

---

## 2. Container formats

### DATA.PAK

An 8-byte header (`9d 3a 69 00 45 46 04 7e`), then repeated:

```
u32 uncompressed_size
u32 compressed_size      # 0 = stored raw; the file then occupies uncompressed_size bytes
zlib stream              # absent when compressed_size == 0
```

Sizes are stored explicitly, so entries chain without decompressing.

> **Trap:** assuming a 16-byte entry header misaligns everything after the
> first entry. The header is 8 bytes, and the first entry's own header sits
> immediately after the archive's 8-byte one. The wrong walk still resyncs by
> luck for a while, which is why it looks plausible — validate against real
> offsets rather than trusting a clean-looking chain.

### DATA.PAK.MAN

Header `[u16 version=2][u32 id]`, then records of:

```
u16 charlen
charlen * 2 bytes, UTF-16LE, ASCII-only
tail
```

> **Trap:** the tail length is *not* constant. File records carry 21 bytes:
>
> ```
> u32 pak_offset
> u32 uncompressed_size
> u64 FILETIME          # decodes to ~2012-06-01
> u32 crc
> u8  flags
> ```
>
> Directory records carry 9 or 16. A fixed-stride walk dies at the first
> directory boundary — offset 3879 in the real file, where `WAYPOINTS/` is
> followed by 16 bytes instead of 21. There is also a bad early assumption
> that the walk can start at offset 0.

**What rescues it:** a file record is *self-verifying*. Its `pak_offset` must
land on a PAK entry whose stored uncompressed size equals the record's. So the
walk becomes a search pruned by the archive itself, and a wrong tail cannot
survive. `parse_man.py` does exactly this.

Names are stored **relative to the directory being listed**, and a directory
appears twice — once by short name in its parent's child list, and again by
*full path* where the walk descends into it. That second form is what maintains
the directory stack.

Result: 77,243 records (6,805 directories + 70,437 files), walk landing exactly
on EOF, every file record validated against the PAK.

### .DAT

Header at offset 0:

```
u32 version        # 2
u32 string_count
u32 ...
```

then exactly `string_count` records of

```
u32 type
u16 charlen
charlen * 2 bytes UTF-16LE
```

then a **binary field section**, decoded as of 2026-09-18 (§2.1).

> **Trap:** the records begin at **offset 8**, not 0. A walk from 0 derails
> immediately. Also: a naive parser that rejects the whole file when the walk
> hits the binary section reports "no layout found" on a file that parses
> perfectly — keep the good prefix.

The `type` ids are **not hashes** — they run in ascending blocks and separate
one kind of field from the next. Diffing two files of the same kind shows which
id carries what.

### .DAT binary field section

```
u32 magic = 0x006BB174
u32 n_scalars
n_scalars * [u32 field_hash][u32 type][u32 value]
u32 n_lists
n_lists   * ( [u32 field_hash][u32 entry_count]
              entry_count * [u32 hash][u32 type][u32 value]
              [u32 0] )
```

`field_hash` is **Knuth's DEK hash** of the field's uppercase ASCII name:

```
h = len(name)
for c in name: h = ((h << 5) ^ (h >> 27) ^ c) & 0xFFFFFFFF
```

That is `rotl32(h, 5) ^ c`, hence invertible — so a known name proves a hash,
and a hash can be tested against candidate names. `DEK("STRENGTH_REQUIRED")` is
`0x27DD296B`, the field holding 60/75/90 in every melee-weapon DAT.

Type ids: `1` int, `2` float, `3` list, `5` asset string, `6` bool, `8` localized
string. Values of type 5/8 are ids into the file's **own** string block, so every
DAT is self-contained — no localization table is needed to read one.

> **Trap:** the word after a list's hash is the **entry count**, not a type, and
> there is no need to scan for the zero terminator — a list whose entry *value*
> is 0 (e.g. `MAGIC_REQUIRED: 0`) would stop the walk early. Measured across all
> 6,262 item DATs, the stated count matches the real entry count in 4,200/4,200
> non-empty lists.

`BASEFILE` carries inheritance across DATs, and its spellings are
**inconsistent** — `media/units/...` (forward slash, lowercase) and
`media\units\items\axes\base_axe_unique.dat` (backslash) both occur. Normalize
with `.replace('\\','/').lstrip('/').upper()` before looking a path up.

`MEDIA/UNITS/ITEMS/` holds **6,262 DATs; all 6,262 decode, 0 failures.**

---

## 3. Tools

`tl2\` holds the extractors, `db\` the build. Python 3.10, plus Pillow for the
sprite sheet (`pip install pillow`). Note `strings` is **not** installed in this
Git Bash — do binary scanning in Python.

| Script | Status | Purpose |
|---|---|---|
| `tl2\dat_decode.py` | **current** | Decodes a `.DAT` in full: header, string block and binary field section. `python dat_decode.py <file.dat\|path/in/pak> [--raw] [--strings]`. |
| `tl2\dat_hash.py` | **current** | The DEK hash and the verified field-name table. `python dat_hash.py NAME` hashes a name; `--fields` prints the table. |
| `tl2\parse_man.py` | **current** | Walks the MAN using the PAK as validator. `--dump index.tsv` regenerates the index. |
| `tl2\extract.py` | **current** | `python extract.py <pak-path> [outdir]`; `--grep <substr>` lists matching paths. |
| `tl2\dump_dat.py` | superseded | Decodes a `.DAT`'s header and string block only. Superseded by `dat_decode.py`. |
| `db\build.py` | **current** | Builds the item database and browser into `db\out\` (§7). `--no-app` skips the page. |
| `db\check_page.js` | **current** | Drives the built page in a real DOM and asserts the behaviour (§7). Needs `npm i jsdom`; optional. |
| `scan_pak_blocks.py` | superseded | Early PAK walk; validated offsets but its chained walk drifts at a `comp=0` boundary. |
| `probe_man.py`, `fit_man_layout.py`, `diag_man.py`, `parse_pak_man.py` | superseded | Layout probes that found the real tail sizes. Useful as a record of how the format was derived. |
| `index.tsv` | generated | 5.1 MB, 70,437 rows: `pak_offset \t size \t path`. Delete freely; regenerate with `parse_man.py --dump`. |
| `sample\` | extracted | `1X1_CLIFF_CONCAVE_S1E1_LM_A.LAYOUT`, `BOSS_BLOATFANG.DAT`, `CHAMPION_TREASURE.DAT`, `TREASURE_MONSTERLOOT_BOSS.DAT`, `FROSTEDHILLS_RULES.TEMPLATE`, `A3-OASIS.DAT`, `GLOBALS.DAT`. |

---

## 4. What's in the archive

### World / map

**TL2 levels are procedurally assembled — there is no one map file per level.**
What exists is *pieces* plus *rules for stitching them*:

| Path | Count | What |
|---|---|---|
| `MEDIA/LAYOUTS/**/*.TEMPLATE` | **186** | The level definition — music, textures, and the piece roster |
| `MEDIA/LAYOUTS/**/*.LAYOUT` | **1,293** | The pieces, each paired 1:1 with a `.MPP` (also 1,293) |
| `MEDIA/LEVELSETS/**/*.LAYOUT` | **1,447** | More pieces |
| `MEDIA/DUNGEONS/*.DAT` | **187** | Binds level → theme → template |

> `MEDIA/LAYOUTS/` totals 2,804 files: 1,293 `.LAYOUT` + 1,293 `.MPP` +
> 186 `.TEMPLATE` + 31 `.JPG` + 1 `.DAT`. A count of 8,985 `.LAYOUT` across the
> whole archive is misleading — most are particle/skill/missile rooms, not
> level pieces.

`FROSTEDHILLS_RULES.TEMPLATE` (28,808 bytes) is the Frosted Hills "map". After
the zone id, display name, music and textures, it lists **68 piece references
(36 unique)**:

```
1X1_ENTRANCE_N3E2W2
1X1_OPEN_N0S3E3W0_WROAD_SE_LANDMARK
1X1_CONVEX_N2S0E1W0
1X1_WALL_N2S2W0_LANDMARK_AVALANCHE
1X1_CONCAVE_S2W1
```

**The piece names encode their own connectivity** — `N3E2W2` is *3 north, 2
east, 2 west openings* on a 1×1 tile. That is the generator's join grammar, and
it is plain readable text.

Chain: `A3-OASIS.DAT` → theme `ACT3_ELEMENTALOASIS` → template
`media/layouts/generic_cave/elementaloasis_rules.template`.

The **geometry inside** a `.LAYOUT` is still binary (UTF-16 names, f32
transforms, hash ids). "Which pieces make up Frosted Hills" is answerable
today; "where the walls are inside `1X1_CONCAVE_S2W1`" is not.

### Items and creatures

| Path | Count |
|---|---|
| `MEDIA/UNITS/ITEMS/` | 6,262 |
| `MEDIA/UNITS/MONSTERS/` | 1,142 (incl. `BOSSES/` 42) |
| `MEDIA/SKILLS/MONSTERS/` | 2,152 |
| `MEDIA/AFFIXES/ITEMS/` | 1,688 |
| `MEDIA/AFFIXES/SKILLS/` | 2,091 |
| `MEDIA/SKILLS/` (by class) | 3,804 total — RAILMAN 292, WANDERER 255, ARBITER 244, BERSERKER 185, VANQUISHER 92, ALCHEMIST 91, WARRIOR 55 |
| `MEDIA/UNITTYPES/` 105 · `UNITTHEMES/` 218 · `SPAWNCLASSES/` 862 · `SETS/` 88 · `INVENTORY/` 67 · `RECIPES/` 19 · `STATS/` 150 | |

Display text: `MEDIA/TRANSLATIONS/` (3,170) plus root `TAGS.DAT`.

### Drop tables

Confirmed present, named, and nested. **98 `TREASURE_*.DAT` in
`MEDIA/SPAWNCLASSES/`.**

A monster's `.DAT` names its tables. `BOSS_BLOATFANG.DAT` (41 declared strings,
all 41 decoded) carries:

```
TREASURE_EYECHANCE_BLOATFANG
TREASURE_MONSTERLOOT_BOSS
```

Tables reference further tables. `TREASURE_MONSTERLOOT_BOSS.DAT` (502 bytes):

```
TREASURE_A_UNIQUE
CHAMPION_TREASURE
GOLD_PIECES
TREASURE_LEGENDARY_CHAMPCHANCE
TREASURE_MONSTERLOOT_BOSS      ← self-reference
```

And the unique pools tier down:

- `TREASURE_A_UNIQUE` → `_ARMOR`, `_TRINKET`, `_WEAPON`
- `TREASURE_LEGENDARY_NORMALCHANCE` / `TREASURE_LEGENDARY_CHAMPCHANCE`
- **21 `EYECHANCE` tables, one per boss** — the per-boss unique pool:
  BLOATFANG, ARTIFICER, ALEERA, ARIKITARA, CACKLESPIT, DARKALCHEMIST, DRAGON,
  EZREK, GROM, JUTHAMA, KILLBOT, MANAFORGED, MANAGUARDIAN, MANTICORE,
  MARISHKA, NETHERLORD, TIAMAT, VERONA, WEREWOLF, BASILISK

Same mechanism for containers: `CHEST_TREASURE_PRIMARY` (+ `_GOOD`, `_GOODER`,
`_SMALL`), `CHEST_TREASURE_SECONDARY`, `BARREL_TREASURE`, `CHAMPION_TREASURE`.

> **Not yet decoded:** the weights/odds live in the `.DAT` binary section. The
> tables name their contents but not their probabilities.

---

## 5. TIDBI — the item database shortcut

`C:\Users\faust\Downloads\TIDBI-eng v1\` — a third-party 2014 item viewer:
`base.mdb` (3.8 MB) + `TIDBI.exe` + `icons\` (1,053 PNG) + `pic\` (35).

**This is the way around the `.DAT` binary section for item stats.** The
numbers that section hides are already sitting in plain columns here.

Jet 4 (Access 2000/2003). No installs needed: Python has no MDB reader on this
machine and mdbtools is absent, but Microsoft's ACE OLEDB provider is
registered, so .NET's `System.Data.OleDb` reads it directly. `pip install
pyodbc` would work through the same driver.

`tidbi\export_tidbi.ps1` dumps the tables to CSV. **Already run** — the output
is in `tidbi\csv\` (UTF-8 with BOM, headers quoted):

| Table | Rows | |
|---|---|---|
| `items` | **6,050** | 47 columns |
| `QItems` | **6,050** | the same rows + 6 dps columns — a saved *query*, easy to miss |
| `effects` | **7,646** | item → effect text + value |
| `sets` | 365 | |
| `SetsSpisok` | 81 | |

`items` carries min/max damage **and** armor for all five damage types
(physical/ice/fire/electric/poison), the requirement columns (`LEVEL_REQUIRED`,
`STRENGTH_REQUIRED`, `DEXTERITY_REQUIRED`, `MAGIC_REQUIRED` = **Focus**,
`DEFENSE_REQUIRED` = **Vitality**, and `REQ_CLASS`), speed, sockets, iLevel,
min/max level, icon, mesh, wardrobe, set.

Naming those columns is worth the space: the requirements are *not* one field,
and reading past them is what produced the original round of wrong output. Three
traps sit in the same place:

- **`iLEVEL` is the item's level, not the player level required.** It matches the
  DAT's `LEVEL`.
- **`CDPS` is not a dps.** Only 93 rows populate it, and every one of those 93
  carries the number as a flat `+N Physical Damage` affix in its own effect text
  — 93 for 93, no exceptions. It is the affix's bonus, not a rate: the Grimbone
  Wand's `CDPS` is 25 against a `+25 Physical Damage` affix, The Mandlebow's is
  103 against `+103 Physical Damage`. Read it as a dps and you will be off by
  roughly the weapon's whole affix.
- **`QItems` is a query, not a table**, so enumerating tables misses it and an
  export built from `items` alone silently drops six columns — `DPS_ALL` and one
  dps per damage type. They are TIDBI's own dps figures and this project does not
  use them (§7), but they are what TIDBI reports, and not having them exported is
  how "TIDBI says 182" becomes unanswerable. `export_tidbi.ps1` exports it too.

`QItems` returns the same 6,050 rows as `items` — verified cell by cell across
all 47 shared columns: **0 differences**. The view adds columns, it does not
rewrite rows.

**1,736 uniques, 2,061 rares**, 556 items in sets, max iLevel 105. Every item
has an `ICON` value and the shipped `icons\` folder matches.

**Join:** `effects.item` → `items.ConsolNAME` (a unit name like
`crossbow_m01slots`), **not** `items.id`. The key is text — quoting matters in
queries, and comparing it to a number raises "Data type mismatch in criteria
expression".

Verified reassembly — *Netherrealm Sword* (id 711, iLEVEL 105, 337–675
physical) joins to `+15% to All Damage` / `5% chance to cast Meteor Strike on
kill`.

### Limits — read before building on it

1. **It's a rendered DB, not a raw one.** Effects are *display text plus a
   number* (`"+15% to All Damage"`, `15`), not structured stat ids. A
   grimtools-style filter for "items with fire damage" must text-match rather
   than query a stat model. Workable, but it caps filtering precision.
2. **Coverage is partial.** Only 2,317 / 6,050 items have real effect lines
   (7,526 lines total); the rest are base whites carrying `BLANK_NO_EFFECTS`.
3. **Rarity is a word inside `UNITTYPE`** (`"Unique Sword"`, `"Rare Ring"`,
   `"Rare Crossbows"`). The `RARITY` column is an *internal id* — values are
   near-perfect squares (0, 1, 4, 9, … 2704, 4500) — not a tier.
4. **It's from Oct 2014**, so it predates later patches. The PAK has 6,262 item
   DATs vs 6,050 rows here — and 85 of the 6,262 are abstract `BASE_*` /
   `BASEARMOR_*` templates with no `NAME`, leaving **6,177 real items**. The PAK
   is the truth about *structure* — which items exist, what they inherit, what
   set they belong to — and §7 has since made it the truth about weapon damage
   too; armor and requirements are still TIDBI's, because the PAK stores those
   pre-scale with no formula recovered. One of the 6,177 is then withheld as
   unreconcilable, so **6,176** ship (§7).
5. Names are English in `DISPLAYNAME`, Russian in `iTRANSLATION`.

---

## 6. Open threads

**The old blocker is gone.** The `.DAT` binary field section is decoded (§2.1)
and items are built from it (§7). What remains:

1. **Drop weights.** The `TREASURE_*` graph is mapped by name but its
   probabilities are list fields still unnamed. `TREASURE_MONSTERLOOT_BOSS.DAT`
   decodes, so this is a matter of labelling the remaining hashes, not of
   cracking a format — the same "guess the name, check the hash" loop that
   named `STRENGTH_REQUIRED` works here.
2. **64 field hashes are still unnamed**, covering 7,493 of 90,561 field
   occurrences (8.3%) and touching 1,962 of the 6,262 items. The rest are named
   in `tl2\dat_hash.py`.
3. **Level geometry.** Dump all pieces and diff a few from one zone to find the
   record stride and where the transform floats sit. The `.MPP` companion is
   the obvious next thing to look at — it likely holds the piece metadata and
   would bridge the readable roster to the binary geometry.
4. **821 items carry no damage or armor** after inheritance, and they are
   structurally stat-less: spells, socketables, quest items, maps, potions,
   fish. Only three are weapons (two Netherim props and a Skeleton sword, all
   enemy-only). Two Legendary shields in `LEGENDARY2/` genuinely have no
   `ARMOR_*` field in the source — TL2's "Legendary 2.0" items take their power
   from affixes. The builder asserts this set stays exactly this small.
5. ~~**Field values TIDBI disagrees with.**~~ **Resolved.** The disagreement was
   not a conflict to reconcile but a category error on our side: the DAT's
   damage, armor and requirement fields are *pre-scale*, and TIDBI holds the
   rendered values. The build now reads TIDBI first and flags the 114 items where
   it has to fall back (§7).
6. **Drop weights and the 64 unnamed field hashes** stay the real blockers —
   nothing about the above touches them.

**Nothing here modifies game files.** All reads.

---

## 7. The item database (`db\`)

`python db\build.py` merges three sources into `db\out\`:

| Source | Rows | Supplies | Join key | Join rate |
|---|---|---|---|---|
| TIDBI 2014 Access DB | 6,050 | **the numbers** — rendered in-game values, plus display text, effects, icons | `ConsolNAME` | 6,050 / 6,050 |
| PAK item `.DAT`s | 6,262 | the fallback where TIDBI has no range; names, inheritance, sets, GUIDs | `NAME` | — |
| alfgeir site | 1,781 | curated name, type, classification; independent check on dps and class | `tag` | 1,781 / 1,781 |

The TIDBI join is a full 6,050 / 6,050, but it needed one repair to get there:
the Access export mangled apostrophes to backticks, and exactly two keys were
affected — ``BROM`S ROUGHHIDE TONIC`` and ``OVERSEER`S EYE``. The DATs spell both
with a real apostrophe, so the two potions silently missed their tier, icon and
effect text. Folding `` ` `` → `'` on the lookup key (`_apos` in `build.py`)
recovers them and moves the pair from Unclassified to Rare.

### The numbers are rendered, not raw — the correction that matters

**The `.DAT` `DAMAGE_*`, `ARMOR_*` and `*_REQUIRED` fields hold *pre-scale* base
values. The game multiplies them by level and difficulty at spawn time, and TIDBI
holds the *rendered* result the player actually sees.** The two disagree on
essentially every item: the DAT's `ARMOR_PHYSICAL` equals TIDBI's rendered max in
**3 of 2,114** cases. The build originally read the DAT and was therefore showing
wrong numbers for most of the corpus — not slightly wrong, a different layer of
the data.

Concretely, on Aenigma the DAT says 70 physical / 30 electric and 120 STR / 50
DEX; the game shows **169 / 72 and 163 / 68**. On `heavy_g_amulet_f_alt_b` the DAT
has a single pre-scale scaler per type and no `LEVEL_REQUIRED` at all, where the
game shows **140-174 fire armor, 79 Focus, level 81 required**.

So each number comes from the best source that can actually produce it — the
DAT's own formula where that reaches, TIDBI's rendered value otherwise:

| | TIDBI has it | the DAT has it | both | **DAT-only** | TIDBI-only |
|---|---|---|---|---|---|
| Armor | 3,969 | 3,983 | 3,966 | **17** | 3 |
| Damage | 1,273 | 1,370 | 1,273 | **97** | 0 |
| `LEVEL_REQUIRED` | 5,473 | 844 | 810 | 34 | 4,663 |

Weapon **damage is no longer read from TIDBI**. It is reconstructed from the DAT
by the formula in *"The damage formula, recovered"* below, which reaches 1,367 of
the 1,370 damaged items. Armor and requirements have no such formula and still
come from TIDBI. The 97 items where only the DAT has damage are almost all
monster, NPC and test weapons — skeletons, trolls, varkolyn, bandits — which a
2014 viewer of *player* items never listed.

**Damage and armor are min-max ranges**, not scalars — `MIN_ARM_*`/`MAX_ARM_*` and
`MIN_DMG_*`/`MAX_DMG_*`. They render the way the game writes them: `140-174` when
the value varies, `100` when it does not. Of the 8,583 populated damage and armor
type slots in `items.json`, 5,450 are a real range and 3,133 a single value.
TIDBI never has a MIN without its MAX.

The **19 items** that fall back to a raw DAT scalar — 17 showing armor, 2 showing
damage, one of them both — are
flagged `vb` and shown as *"base values, not rendered"* in the detail view — a
pre-scale number must not be passed off as an in-game one. A further **1,367** are
flagged `dv` and labelled *"reconstructed from PAK game files"*: a derived number
is not a TIDBI number either, and calling it one would be the same misattribution
pointing the other way. The CSV carries both as the `base` and `derived` columns.

**`LEVEL_REQUIRED` is a third field**, distinct from both `LEVEL` and `MINLEVEL`.
TIDBI's own `iLEVEL` is the item's level and agrees with the DAT's `LEVEL` in all
5,945 cases where both exist, so `LEVEL` needed no such treatment.

### Requirements are alternatives — and the class gate is not

An item's player-level requirement and its stat requirements are **not** a
conjunction. The game grants equip as soon as you meet *either* branch, whichever
you reach first. A class item lists both, so rendering them as one flat list
states the opposite of how equipping works. The detail view separates the two
branches with an `or` divider:

```
Requirements
  Player Level Required   65
  ······· or ·······
  Focus                   87
  Vitality                101
  Class                   Embermage only
```

That block is titled **Requirements**; it read "Requires" until the user asked
for the rename.

Across the 6,176 items: **5,036 have both branches**, 471 a level only, 98 stats
only, and 571 neither.

**The class line is not a third alternative.** It is a hard restriction layered
on top of whichever branch you satisfy, so it is labelled `<Class> only` and kept
outside the options rather than placed among them.

`REQ_CLASS` is a **TIDBI-only field** — the PAK has no class field at all in any
of the 6,262 item DATs. 767 items carry it, across exactly four values (Embermage
194, Outlander 193, Berserker 191, Engineer 189). alfgeir carries a class for 758
of those same items and **the two sources disagree on none of them**, which is
what establishes that the field means what its name says.

### Augmented weapons — the stats that are not there yet

**74 weapons are TL2's "Augmented Weapon" line** — 69 Unique and 5 Normal, the
latter being the two early quest rewards (Rat Killer, Ritual Wrench) and three
dev test swords. Each carries a kill-count task — *Kill 50 Ezrohir to Upgrade* —
and completing it unlocks 1–3 extra stats. Those stats are **not on the weapon
when you find it**, so showing them as affixes states the opposite of the truth.

The problem is that TIDBI hands the whole tooltip over as one flat list, task
and unlocked stats and ordinary affixes interleaved, with nothing but the game's
own dashed rule between the two groups:

```
Augmented Weapon:                      <- header
Kill 50 Ezrohir to Upgrade             <- the task
6% chance to cast Acid Rain from target  ┐ unlocked by the task
15% chance to Stun target for 2 sec.     ┘
------------------                     <- the divider, present on all 74
40% bonus to Critical Damage           ┐
+25 Physical Damage                    ├ the weapon's actual affixes
-8 to All Armor per hit                ┘
```

That divider is the boundary, and it is a reliable one: it appears on exactly
the 74 items that carry an `Augmented Weapon:` header and on no other item in
the corpus. `split_effects()` in `build.py` cuts there and emits `aug`
(`[{task, fx}]`) separately from `fx`, and the detail view renders the unlockable
group **before** the affixes — the order the game's own tooltip uses — with the
task as a chip, an explicit *"locked until the task above is complete"* divider,
and the stats set apart so they cannot be read as already active.

Three things this took getting right, all of them measured:

- **The divider's position is not always where it looks.** On `ratkiller` its row
  id sorts *below* the header's, so it arrives first and cannot bound the block
  from the left. There the block ends at the last row contiguous with the header
  instead. Its near-twin `zombiesummoner` — same base stats, same task shape —
  confirms the split: both carry a `90% Interrupt chance` affix, and for
  `zombiesummoner` the divider places that affix *outside* the block, so on
  `ratkiller` it is an affix too and only `+2 Physical Damage` is unlocked.
- **One item chains three augments.** `zzz_testsword_augment_many` is a dev test
  sword with three headers and three tasks, so `aug` is a list. It is also the
  only item in the corpus whose effect list contains the stray field-name tokens
  `TRANSLATE` and `AFFIXES` in place of stats; both are dropped.
- **The DAT cannot help here.** `wand_u02b`'s field set is byte-for-byte the same
  set as `wand_u04`'s — there is no augment field to read. The task and the
  unlocked stats exist only in TIDBI's effects table.

1–3 unlocked stats: 9 items have one, 53 have two, 12 have three.

### Damage per second, and attack speed

Weapons get a `dps`, computed as the **midpoint** of the damage range over the
seconds per swing:

```
dps = Σ over damage types of (MIN + MAX) / 2   ÷   SPEED
```

Using the *average* rather than the maximum is the whole trick. alfgeir states a
`dps` for 461 items and this base figure matches all **461 exactly** — but read
that as a check on the formula, not on the game: alfgeir computes that number
rather than scraping it, so it can only confirm the arithmetic, never the inputs
(§7, "Why neither source has this number"). The 13 half-cases are why the code
uses `int(x + .5)` and not `round(x)` — Python rounds halves to even, so
`round(162.5)` is 162 where alfgeir shows 163.

1,351 items get a dps. That is up from 1,274, and the reason is the attack-speed
derivation below: 81 weapons TIDBI does not price at all now get a speed, and a
dps needs both a range and a speed. The 19 base-value items get none: a
pre-scale number cannot produce a rendered dps.

**TIDBI has its own dps, and this project does not use it.** `QItems` carries
`DPS_ALL` plus one column per damage type (§5). The difference is where the
rounding happens: TIDBI rounds *each damage type* and then adds, where the game
rounds the total once. The Grimbone Wand is the clean example — TIDBI's
`DPS_PHYSICAL 140` is 139.6 rounded up and `DPS_POISON 16` is 15.6 rounded up, so
`DPS_ALL` is **156**, while rounding the total once gives 155.2 → **155**. Across
all 1,273 weapons TIDBI's column matches the per-type order 1,231 times and the
single-rounding order only 1,048 times, and 42 match neither. Two extra facts
worth having: TIDBI's `DPS_ALL` **omits the flat affixes** — The Mandlebow's is
946, its three damage ranges alone, where counting its own `+103 Physical Damage`
gives 1048 — and TIDBI's `CDPS` column, which sits right beside it, is not a dps
at all but that affix's value. Neither is what the game shows; see below.

Attack speed renders as the game words it — `Very Fast Attack Speed (0.72
seconds)`. The bands come from alfgeir's own tooltips, which cover all 29 distinct
speed values in the corpus with **zero ambiguity**:

| Band | | Values |
|---|---|---|
| Very Fast | ≤ 0.72 | 0.4, 0.48, 0.56, 0.64, 0.7, 0.72 |
| Fast | ≤ 0.88 | 0.8, 0.84, 0.88 |
| **Average** | ≤ 1.08 | 0.9, 0.96, 0.99, 1.0, 1.04, 1.08 |
| Slow | ≤ 1.21 | 1.1, 1.12, 1.2, 1.21 |
| Very Slow | above | 1.3 … 1.68 |

The middle band is **Average**, not "Normal".

**Attack speed is derived from the DAT as well**, and the divisor that makes it
possible was the last unknown in this area. The DAT stores `SPEED` raw; seconds
are `SPEED ÷ divisor`, and the divisor is a constant per weapon **type**:

| Divisor | Types |
|---|---|
| **125** | 1H axe / mace / sword, bow, crossbow, fist, pistol, wand |
| **83⅓** | 2H axe / mace / sword, polearm, staff |
| **90.909** | cannon |
| **100** | rifle |

It is measured, not assumed: over the 1,273 weapons both sources carry a speed
for, `SPEED ÷ divisor` reproduces TIDBI's rendered seconds to within 0.005 on all
but one, and that one is a deliberate disagreement rather than drift —
`legendary2_sword05`, where the DAT says **0.64 s** and TIDBI says 0.96 s. The DAT
is right: 0.96 is the *two-handed* rate for its raw 80, so TIDBI had filed a
one-handed sword under the wrong hand, and the item's own `UNITTYPE` and both of
its children agree with the DAT.

The class is read from `UNITTYPE`, which fails on two items, and both are treated
as named exceptions rather than papered over: `sturm_polearm` carries `NORMAL
AXE` despite being a polearm, so `SPEED_CLASS_OVERRIDE` names its class directly,
and `Polearm_Vanq01` has the same conflict and is dropped instead (below).

Note the divisor is **not** a one-handed / two-handed split, which is a
different axis. Bows and crossbows are held in two hands but divide by 125
exactly like the one-handers, and rifles divide by 100; fitting a 1H/2H rule
onto them would move every bow in the corpus away from a value TIDBI gets
right. Real attack speeds top out at 1.68, and anything above that after
division is still dropped.

The result: **1,356 items carry an attack speed**, up from 1,276. 64 of the 81
newly-priced weapons name their class outright in `UNITTYPE`; the other 17 are a
bare `SWORD` / `AXE` / `MACE` — a type with no hand attached — and so rest
entirely on the rule above that a bare type name is one-handed: `axe_bandit`,
`C_Sturm_Melee_Axe`, `C_Sturm_Melee_Axe02`, `Cursed Electric Sword`,
`Cursed Fire Sword`, `Cursed Ice Sword`, `Cursed Poison Sword`, `destro_axe`,
`destro_mug`, `Djinn Fire Sword`, `Engineer_Wrench`, `mon_axe_goblinchamp`,
`mon_axe_goblinpickaxe`, `Scimitar`, `Sword_DesertSkeleton`, `Sword_Ezrohir01`,
`Sword_Ezrohir02`. `axethrow` moves the other way:
it carries a raw `SPEED` of 1.1 with no `UNITTYPE` at all, which the old rule
read straight through as 1.1 seconds because it slipped under the cap. With no
class there is nothing to divide by, so it now shows no speed rather than a
fabricated one.

An earlier version of this section called these values "a `SPEED` that is not an
attack speed". That was wrong — they are attack speeds, stored raw, and the
divisor was simply unknown at the time.

### The damage formula, recovered

The `.DAT` holds no rendered damage number, and for a long time this project
treated its pre-scale fields as unusable. They are usable — the formula is:

```
nominal   = BASE_WEAPON_DAMAGE(LEVEL) x SPEED_DMG_MOD/100
                                      x RARITY_DMG_MOD/100
                                      x sum(DAMAGE_*)/100
min_total = nominal x MINDAMAGE/100      (both are PERCENTAGES, carried on base
max_total = nominal x MAXDAMAGE/100       templates and inherited by BASEFILE)
per type  = total x that type's share of the DAT's damage sum
```

`MINDAMAGE`/`MAXDAMAGE` are the two fields that make this work, and they are easy
to mistake for absolute values: the Bow of Heroes' DAT holds `DAMAGE_PHYSICAL 75`
and `DAMAGE_FIRE 25` with no range anywhere, and its `65`/`90` come from
`BASE_BOW.DAT`. `SPEED_DMG_MOD` and `RARITY_DMG_MOD` are per-class and per-tier
multipliers on the same chain. All four were already decoded and inherited here
and simply never read.

`BASE_WEAPON_DAMAGE(LEVEL)` is in no item file. It is a 105-point curve in
`MEDIA/GRAPHS/STATS/BASE_WEAPON_DAMAGE.DAT` — `21` at level 1, `363` at 77, `489`
at 105 — and it parses with the same decoder as everything else. Its two members
are spelled with the DEK hashes `0x78`/`0x79` because `dat_hash.FIELDS` has no
name for them, which is why nothing here had read it before.

Agreement with the shipped game, over the 1,272 weapons the derivation reaches
that TIDBI can also price — the other 95 it reaches are monster and test weapons
TIDBI never listed, so there is nothing to compare them against. An item counts
as identical only if every damage type matches on both ends of its range:

| | |
|---|---|
| bit-identical to TIDBI's rendered range | **1,161** (91.3%) |
| differ by 1–3 — a rounding edge | 46 |
| differ by more | **65** |

A type one source lists and the other does not counts as "differ by more", which
is where the Cerulean Nightmare's poison sits.

**The 65 are not obviously our error, and not obviously TIDBI's.** They cluster:
every one-handed axe is off by a consistent ~1.2x, which points at a per-class
damage factor living outside the item DATs — the same place the per-class `SPEED`
divisor turned out to live (raw `90` is 1.08 s on a 2H sword but 0.72 s on a 1H).
It is not a single factor, though: the `legendary2_*` items imply multipliers
scattering from 0.73 to 1.30, so something else is going on there too.

Where the two conflict **the derivation ships**, because the `.DAT` is the shipped
build and TIDBI is a 2014 export the game has since moved past. That is checkable
rather than assumed, and it checks out: the wiki's Cerulean Nightmare
(`legendary2_sword05`) carries **no poison damage**, matching the DAT's
`DAMAGE_PHYSICAL 50 / DAMAGE_ICE 50` and contradicting TIDBI *and* alfgeir, which
both still show a poison line. The 2014 sources agree with each other because they
are both old, not because they are both right.

### The rendered numbers were audited, not spot-checked

Everything above is only as good as the two sources behind it, so every displayed
range was re-derived from TIDBI's own `MIN_*`/`MAX_*` columns and compared back,
and the derived `dps` was checked both against the formula and against alfgeir:

| Check | Scope | Result |
|---|---|---|
| our armor == TIDBI's `MIN`/`MAX` | 6,470 armor slots | 0 unexplained |
| our damage == alfgeir's | 461 weapons both cover | **70 differ** — the same one-handed-axe cluster as above, which is what you would expect: alfgeir and TIDBI are both 2014 and agree with each other rather than with the shipped build |
| `int(mean ÷ speed + .5)` — does the rounding rule matter? | all 1,351 weapons | **yes: floor would change 618 of them.** Longfang is the worked case, on the wiki's own numbers: its tooltip damage lines are `85-170` / `28-56` / `28-56` at 0.72 s, so the mean is 211.5, 211.5 ÷ 0.72 = 293.75, and the tooltip's **294** is half-up where floor says 293. alfgeir's stated dps is this same form on all 461 weapons it carries. (We render **296** for this item — off by the same ~1% balance-curve drift as the Grimbone, so that tooltip settles the rule, not our magnitude.) TIDBI is not a counterexample: its `DPS_ALL` rounds each damage type *before* adding (§5), a quirk the game does not share |
| our `dps` == alfgeir's, restricted to weapons neither side carries a flat affix for | 398 both cover | **331 agree (83.2%)**; the other 67 are the damage disagreements above propagating through, not a separate failure. alfgeir's dps omits flat affixes entirely, so any weapon carrying one is uncomparable without adjusting for it — 63 were dropped for that |
| a minimum above its maximum | our 8,583 damage and armor slots | **0** |

**The Mandlebow** (`legendary2_crossbow03`) used to be the one such range: TIDBI
and alfgeir both carry its physical as `391-205`, and an earlier version of this
section argued the pair should be reproduced rather than swapped, on the grounds
that two sources agreeing made it the game's own value. Deriving it from the DAT
instead gives an ascending `207-411`, which is what ships — and `main()` now
asserts no range anywhere reads backwards, which the derivation cannot violate in
the first place, since it scales one min and one max by the same per-type shares.

Four other slots *were* wrong, and are fixed. `_num()` reads a literal `0` as
"absent", which is right for a field holding `melee` or nothing at all but wrong
for an armor value: both **Sturm Shields** carry `MIN_ARM_FIRE` and `MIN_ARM_ICE`
of `0` against a max of `1`, and collapsing those to a flat `1` claimed an armor
the item does not have at the floor of its range. They read `0-1` now. A zero
minimum against a real maximum occurs on exactly those four slots and nowhere
else, and a blank minimum against a real maximum occurs nowhere at all — so a
maximum arriving on its own always means a flat value, which is what the parser
now assumes.

One more thing worth knowing before trusting a dps: **the tooltip's dps line
counts the flat `+N Damage` affixes the item carries from the start**, added as a
whole number on top of the per-second figure rather than divided by the attack
time. Both of the sources this project rests on miss that, and for different
reasons — see "Why neither source has this number" below.

**Grimbone Wand** (`wand_u02b`) is the worked example for all of this. TIDBI's row
is `126-142` physical / `14-16` poison at 0.96 s; the DAT holds the pre-scale
layer, `DAMAGE_PHYSICAL 90` / `DAMAGE_POISON 10` off `MINDAMAGE 75` at `SPEED 120`
(120 ÷ 125 = 0.96); alfgeir carries the same `126-142`, `14-16` and "Average Attack
Speed (0.96 seconds)"; and the wiki's entry gives item level 22, required level 26,
Focus 80. TIDBI and alfgeir agree, and they agree on 155 for the dps.

They are both wrong about that one number, and the same wiki page is what shows it:
**its image of the item is a screenshot of the real tooltip**, and it reads
**179 Damage per Second**.

### Why neither source has this number

Both sources omit the flat affix, and neither omission is evidence about the game —
which is worth spelling out, because an earlier version of this section read
alfgeir's agreement as a second opinion. It is not one.

**TIDBI stores the affix and never uses it.** `CDPS` holds the `N` itself (25 for
the Grimbone), the effect text spells out `+25 Physical Damage`, and `DPS_ALL` adds
up one per-type figure per damage type and stops: 139.6 → 140 plus 15.6 → 16.

**alfgeir's `dps` is not a scrape; it is alfgeir's own arithmetic.** Across all 461
weapons it carries, the stated dps is `floor(avg ÷ speed + .5)` with zero
exceptions, and the `offensiveBase` string holds that same number. The 13 that look
like exceptions are every exact `.5` case — 162.5, 462.5, 912.5 — where alfgeir
rounds halves up and Python's `round()` does not. A field that reproduces a formula
461 out of 461 is that formula's output, and it has never seen an affix.

**The game's tooltip does count it.** That screenshot gives the game's own
arithmetic: 148 average damage per hit, 0.96 s, `+25` —
`floor(148 ÷ .96 + .5) + 25 = 154 + 25 = 179`. Folding the 25 in *before* dividing
would give `(148 + 25) ÷ .96 = 180.2`, so the affix lands on the dps as a flat
figure, not as per-hit damage. Adding it after the division but before the
rounding is the same thing, not a third rule: `flat` is always an integer, so
`int(x + .5) + flat` and `int(x + flat + .5)` are identically equal and agree on
all 1,351 records. The second screenshot on that page — the same wand
with its augment unlocked, hence "Kill 50 Ezrohir" gone and two new stats — still
reads 179, because what the augmentation adds is a proc and a stun rather than
damage.

Only the affixes present from the start count. A `+N Damage` that arrives with an
augmentation is not on the item until the task is done: the Bugstomper's own
tooltip shows no `+58 Physical Damage` while it still reads "Kill 20 Spiders to
Upgrade (0/20 killed)", and its 434 is `floor(243 ÷ .56 + .5)` and nothing more.
This is why the pipeline calls `flat_damage()` with the base group only, never with
`split_effects()`'s augments.

The rule reaches **64** of the 1,351 records carrying a dps — median shift +61, the
largest being The Mechano-Axe, whose `+340 Physical Damage` moves it from 864 to
1204. The Mandlebow moves from 945 to 1048.

Three things stay open, and none is dressed up as settled:

- Our Grimbone still reads **180** against the game's 179, and deriving the damage
  from the DAT does **not** close it — an earlier version of this section predicted
  it would, and that prediction was wrong. The derivation returns `126-142` /
  `14-16`, bit-identical to TIDBI, so the gap was never between our arithmetic and
  TIDBI's rounding. It is between the PAK's balance curve and the shipped build's:
  the implied curve runs ~0.5–1% low, consistently, across every wiki sample we
  have (Longfang 0.990, Bow of Heroes 0.996, Grimbone 0.995). Root cause unknown.
- Two other wiki screenshots resist the rule rather than confirm it: Lovescratch,
  which has a Chaos Ember Chip socketed ("7% Damage bonus when dual-wielding", so
  contaminated), and Misery, whose 245 sits between the 224 its damage lines give
  and the 263 the rule predicts — with an empty socket and a base `+39 Physical
  Damage`. Neither is explained.

The socketables are a related but separate thing: TL2's gems grant flat damage on
weapons — 35 of the 146 do, in tiers of +7, +14, +22, +29, +37, +45 and +52 (Ember
Speck, Chip, Shard, Ember, Large, Huge, Giant) — but a socketed gem is an item in
its own right and none of the three sources here folds one into a weapon's damage
lines. They ship here too (178 of them), under their own names.

```
db\
  build.py      the pipeline
  check_page.js optional DOM test of the built page (§7, Verifying)
  app\          the browser's source: index.html, app.css, app.js
  out\          generated
    index.html  8.24 MB, self-contained — open it straight off disk
    items.json  2.27 MB, 6,176 items
    items.csv   flat table for Excel/pandas
    sets.json   the 80 set bonus ladders, shared by the 556 set pieces
    icons.png   1,485x1,440 sprite of all 1,053 icons
    icons.json  icon name -> [x, y, w, h]
```

**6,176 items** ship. The 85 excluded templates are not obtainable and exist only
to be inherited *from*: 78 carry no `NAME` at all (`BASE_2HAXE`,
`BASEARMOR_CHEST`), and 7 are named but still abstract (`base_cannon`,
`base_fist`, `base_rifle_NOSKILL`). Every shipped row decodes from the PAK;
nothing is scraped or invented.

### Inheritance is asymmetric — the main finding

3,257 items carry `DAMAGE_*`/`ARMOR_*` on their own fields. Of the 2,919 that
don't, walking `BASEFILE` gets **armor onto 1,995 of them but damage onto only
103**. Final coverage **5,355 / 6,176** with damage or armor. Chains are shallow
and never break — hop histogram `{0:14, 1:265, 3:1}`, zero cycles, zero unresolved
paths.

The inheritance walk still runs on the DAT, because that is where the base
relationships live; only the *displayed* numbers come over from TIDBI. The two
extra items against the old 5,354 are ones TIDBI gives a rendered armor value
that the DAT has no field for at all.

The builder asserts the resolved totals exactly, so a regression in the walk
fails the build rather than silently emptying the corpus.

### Tiers: what the data actually says

TIDBI's tier vocabulary is exactly `{RARE, UNIQUE, LEGENDARY}` plus bare types
(`"Boots"`, `"Ring"`, `"Spell"`). It has **no Magic word at all** — all 576
items named `*_m<digit>` are tiered Rare by TIDBI. So no Magic tier is offered.

| Tier | Items | On the site |
|---|---|---|
| Normal | 2,161 | yes |
| Rare | 2,061 | yes |
| Unique | 1,737 | yes |
| Legendary | 92 | yes |
| Unclassified | 125 | **no** |

**Set is a membership, not a rarity.** 556 items carry a non-empty `SET` field,
which is the DAT itself asserting membership; TIDBI tiers those 210 Rare / 346
Unique. The builder emits that displaced rarity as **`uq`** on set items only,
and `ownTier(o)` returns `o.uq || o.q`. That single function drives the card's
colour, the detail's name, the type line's first word **and the tier facet**, so
each of the 556 is filed under the rarity it actually is — which is why the two
rows above carry 2,061 and 1,737 rather than the builder's own 1,851 and 1,391,
and why the four tiers still sum to 6,051. The game paints a set piece in the
colour of what it
actually is and prints **"Unique Set Belt"**, not "Set Belt".

Set membership is therefore a filter *over* the rarities, not a fifth tier: the
toolbar carries a **`setonly`** toggle for "in any set at all" and a `set`
select for one named set, and the two are independent state, so clearing the
select does not silently drop the toggle.

The build asserts the split exactly `210 / 346` — the `_set` name fallback in
`base_tier()` is the one path that could return `Set` as a rarity, and a set
piece reaching it would mean its rarity was being read off the fact that it is
in a set, which is circular. `uq` stays out of `items.csv`, whose `q` column
keeps the pipeline's own classification — `Set` for all 556 — so the CSV and the
site are answering different questions, and only the site needs the displaced
rarity.

**A set's name is not its token.** The `SET` field holds a bare token —
`SENTINAL`, `U_GRAND_ARCHITECT`, `BERSERKER_FINAL` — which is what the site used
to print. The name the game shows lives in that set's own file under
`MEDIA/SETS/`, whose `NAME` field carries the token and whose `DISPLAYNAME`
carries the name: **Sentinel**, **Cornerstone**, **Harbinger**. `load_set_names()`
reads all 88 files, and `build.py` asserts that every token the corpus references
resolved — so a set the lookup cannot find fails the build rather than putting a
raw token back on the site. Look the token up by `NAME`, never by filename: the
set `STURMBEORN` is defined in `TL2_STURMBEORN.DAT`, and matching on the filename
misses it. The `_BIG` variants name themselves `<token>_BIG`, so they cannot
shadow a token an item actually references. `load_set_defs()` reads all 88 files
and returns both the names and the bonus thresholds, because they live in the
same files.

TIDBI carries the same names in `tidbi/csv/sets.csv` and agrees on **73 of the
80** tokens this corpus uses. It differs on two — `ASPHYX` is "The Asphyx" to
TIDBI against "Asphyx" in the DAT, and `GHASTLY` is "Haunt" against "Ghastly" —
and its Access export turned the apostrophe in five more into a backtick
(``Xtro`s Blades``, ``Winter`s Reach``, ``Ole`s Tools``, ``Grundig`s Bastion``,
``Grell`s Arsenal``). The `.DAT` is the game's own data, so it wins on all seven;
which is the reason this field is not simply read out of TIDBI.

The raw token is kept as **`setid`** beside the display name. It is the only
route back to `MEDIA/SETS/<token>.DAT` — unguessable from the name, since
Sentinel's file is misspelled `SENTINAL.DAT` — and that file is where the set's
per-piece-count bonuses live. `setid` is in `items.json` only; the CSV's `set`
column carries the display name. The browser keys each item's bonus ladder off
it.

### Set bonuses: the DAT has the ladder, TIDBI has the words

Wearing more pieces of a set unlocks bonuses at 2, 3, 4 pieces and up, and every
set piece's page shows the whole ladder. No single source holds one:

- **The DAT holds the shape.** A set file lists one `AFFIX` triple per rung —
  piece count (`0x0E16DD94`), an affix level (`0xF4C3B4CE`), and the affix to
  grant (`SET_CAST_SPEED2`). So the thresholds are the game's own, and the
  affixes are named, not rendered: reading `SET_CAST_SPEED2`'s own DAT gives a
  `TYPE` of `PERCENT CAST SPEED` and a value, not the `+6% Cast Speed` a player
  sees. Rendering that is the same job as rendering item affixes, which this
  pipeline declines to do — item affix text comes from TIDBI's `effects.csv`,
  and set bonus text comes from TIDBI's `sets.csv` the same way.
- **TIDBI holds the words.** `tidbi/csv/sets.csv` carries 365 rows keyed on the
  same DAT token, with the rendered text and its piece count. Rows are grouped by
  count, because one rung can carry several lines: Aristocrat's 4-piece bonus is
  four separate elemental bonuses.

The two are **asserted against each other** on all 80 tokens. Neither can be
trusted alone — a TIDBI-only ladder would look perfectly well formed with a rung
missing, since nothing in a set of rows says how many rows there should be, and
a DAT-only ladder would print `SET_CAST_SPEED2` where the game prints `+6% Cast
Speed`. Agreement is the only evidence either is complete. They agree on all 80
today: 327 rungs.

**15 sets gate a rung above the number of pieces that ship.** `U_GRAND_ARCHITECT`
declares bonuses at 8 and 9 pieces and ships 7; `TWINFERNO` and `TWOSTROKE`
declare a 2-piece bonus on sets with one piece in them. The missing pieces are
absent from the PAK — not filtered out by this pipeline — and the site draws
those rungs anyway, dimmed and labelled `9 pieces · set ships 7`, because the
game's own set file declares them and a player comparing this page to a wiki
should see the same ladder. The count is asserted in the build, since a change
in it would silently restyle them.

The ladders ship in `out/sets.json`, keyed on the token, one record per set
rather than repeated on each of the 556 pieces: `n` is the display name, `c` how
many pieces the corpus ships, `b` the rungs as `[count, [text, ...]]`. The page
carries the same object as `DB.sets`.

The 125 Unclassified are absent from TIDBI entirely — monster-only weapons,
`zzz_*` test props, the cursed swords. That is honest, not a gap in the join.

That relationship is exact in one direction: **all 125 Unclassified items have no
TIDBI row**. It does not hold in the other — 127 items lack a TIDBI row, and two
of them still got tiered from `NAME` markers (`skeleton_greatsword_u03` →
Unique via `_u03`, `petcollar_n13b` → Normal via `_n13b`).

**The tier is kept in the db and withheld from the site.** `SITE_HIDDEN_TIERS`
drops `Unclassified` when writing `index.html`, so the page shows **6,051** of the
6,176 rows in `items.json` and says so. They stay in the JSON and the CSV —
nothing here guesses a tier to make a number look tidier, and an item the sources
cannot place is a fact about the item.

**One item is dropped outright** (`DROP_ITEMS`): `Polearm_Vanq01`. It is the one
place the class rules genuinely conflict. The item sits in `POLEARMS/` and TIDBI
carries it at 1.08 s — which is exactly `90 ÷ 83⅓`, the polearm rate — but TIDBI's
own `UNITTYPE` for it reads `NORMAL AXE`, so the bare-type rule reads its raw `90`
as a one-hander's and makes it 0.72 s. Two rules, two answers, one item: it is
left out of the db and the site rather than given a guess, and `build()` asserts
the drop happened.

### Type facet, and the rail's taxonomy

39 values. **The item's own DAT decides the type; TIDBI says what to call it.**

The DAT states a `UNITTYPE` for 6,175 of the 6,176 items — the exception is
`collar_unique_vampire_master10` — so that token is the game's own answer and is
read first. It is not a display name, though: it is tier + slot, written in the
engine's spelling. `UNIQUE PANTS` is Leggings, `1HMACE` is Mace, `NORMAL_STUD`
is the `Tag` slot. TIDBI is mostly title case ("Unique Chest Armor") where the
DATs are shouty-underscore ("NORMAL_COLLAR"), so both are normalized to one
vocabulary.

`token_names()` derives the translation from the corpus at build time — for each
token, what did TIDBI call the items carrying it? — rather than hand-copying a
table that could drift from the data it describes. **45 of the 46 tokens answer
with exactly one name.** `POTION` is the single real ambiguity, covering both
potions and the fish filed alongside them, and is the only token still resolved
per item against TIDBI. That is what keeps `Trufflesnout Fish` a Fish and
`Luck Potion` a Potion without a rule naming either.

Three tokens (`DAGGER`, `GOLD`, `MACE`) are already display names and are taken
as-is. Four carry an elemental suffix and are listed in `TOKEN_UNSEEN`; they fall
through to the chain below, which is where they were before this change — see
that constant for why they are left alone.

That chain — TIDBI → alfgeir → folder → `RESOURCEDIRECTORY` → `NAME` suffix — is
now only the fallback. Its folder step ends in `.title()`, so it answers for
every item that has a folder; the last two steps are reachable only from the
items root, which is where the two items that use them sit. Reaching the folder
is what put `petcollar_n13b` under `Armor` in the first place: `TL2ARMOR/` is a
catch-all, not a slot, and the collar's own `NORMAL_COLLAR` is the better answer.

Those 39 types are then grouped three levels deep, in `TYPE_GROUPS` in
`build.py` — **group → subgroup → type**. That list is the single source: the
CSV's `c` column and the sidebar's grouping are both derived from it, and
`build()` fails if the data ever emits a type it does not name. The groups
follow grimtools' own `/db/` rail, which is why they are not what this project
used to call things:

| Group | | Types | items.json | on the site |
|---|---|---|---|---|
| **Armor** | | Helmet, Shoulder Armor, Chest Armor, Gloves, Leggings, Boots, `Armor` | 1,831 | 1,827 |
| **Weapons** | One-Handed | Sword, Axe, Mace, Dagger, Claw, Wand, Pistol | 599 | 540 |
| | Two-Handed | Greatsword, Greataxe, Greathammer, Polearm, Staff, Bow, Crossbow, Shotgonne, Cannon | 773 | 738 |
| | Off-Hand | Shield | 89 | 76 |
| **Accessories** | | Ring, Necklace, Collar, Belt | 2,042 | 2,042 |
| **Misc** | | Spell, Socketable, Quest Item, Tag, Map, Fish, Potion, Location Item, Scroll, Gold, Dynamite | 842 | 828 |

Two placements are deliberate moves away from the old flat `CATEGORY` map, and
both match grimtools' own code: **a shield is a weapon**, not armour
(`WeaponArmor_Shield` sits with the weapons there), and **a belt is an
accessory**, not armour (`ArmorProtective_Waist` sits in its jewellery branch
beside Ring/Amulet/Medal). The group this project called `Jewelry` is renamed
`Accessories` for the same reason. A shield is neither one- nor two-handed,
which is why Weapons needs the third subgroup — grimtools lists Shields and
Off-Hands as their own entries for exactly that reason.

Order within a group is declared rather than computed: armour runs in body
order, weapons melee-then-ranged. A curated taxonomy that reshuffled itself as
counts moved would lose the ordering that carries the meaning.

**This is a different axis from the attack-speed divisor above, and the two must
not be reconciled.** The rail calls Bow and Crossbow two-handed, and they are —
but they divide by **125**, the one-handers' constant, not 83⅓. Both statements
are true because handedness and the divisor's fit are separate questions: the
divisor is a per-class constant recovered by fitting, not a derived property of
grip. Fitting a 1H/2H rule onto the divisors would move every bow in the corpus
away from a value TIDBI gets right.

Four types are named in `TYPE_GROUPS` but never appear in the data — `Fist`,
`Rifle`, `2H Mace`, `2H Sword`. `2H Mace` and `2H Sword` are kept because the
data could yet emit them; `Fist` and `Rifle` are now unreachable, since the token
table translates `FIST` to `Claw` and `RIFLE` to `Shotgonne` before anything can
emit them, and are kept only as a guard on the fallback chain. Because they have
no items they render no checkbox. `Dagger` (1 item), `Gold` (6) and `Armor` (1,
the collar no source can place) do have items, but all of them are Unclassified
and the site hides that tier, so those three render no row either — a type with
nothing visible to match is not worth a checkbox. The rail therefore shows 36
rows against the 39 types the data emits.

### Icons

Better than expected: **6,242 of 6,262** items resolve an icon — 6,213 from the
DAT's own `ICON` or TIDBI's column, plus 29 inherited from a sibling sharing the
same `RESOURCEDIRECTORY`/`MESHFILE`. Only 20 fall back to a type-tinted
placeholder. All 1,053 icons pack into one 1,485×1,440 sheet at native size
(1,052 are 45×45, one is 44×44); a 2× sheet would be 13.5 MB and is a non-starter.

### The browser

`out\index.html` opens from `file://` with no server and no network. Filters live
in the rail with live counts — type, damage type, level range, stat-requirement
caps, sockets — except for the two that sit with the results they order: the
**rarity strip** of count-bearing pills between the toolbar and the grid, and
the toolbar's own **set** toggle and set select. The default sort is
tier-then-level, the same order the strip reads in. **Type is grouped** into the three-level
taxonomy above rather than listed flat, and each group header is itself a
control — clicking it checks or clears every type beneath it, and it carries a
tri-state marker so it is visible whether the group is fully, partly or not at
all applied. The four categories also carry the **fold glyph** the rail's own
sections have: Armor, Weapons, Accessories and Misc each open with `−` and close
to `+`, which hides the rows that follow them — a category's subgroups and their
rows together. Only the glyph folds; the rest of the header is still the bulk
toggle. A fold is a view state and not a filter: it never reaches the hash,
changes no count, and is re-applied after the rail is rebuilt, because a rebuild
renders every category open. A subgroup header carries no glyph — its one action
is the bulk toggle — but it still emits the span, which is what keeps the
indent ladder straight. That ladder had to be paid for: the fold glyph added 9px
to each category header, so the rows beneath step in by the same 9px
(`.f.s0` 23px, `.f.s1` 35px) and every existing relationship — 19px category,
27px subgroup, rows below both — survives in the same order it had. The damage
types below read as words (`Fire`, `Physical`) while the keys underneath stay
lower-case, because the URL and the data are keyed on the lower-case token and
only the display string is capitalised. There is no separate Category facet: since the header toggles the
types it names, "category is Weapons" and "every weapon type is checked" are the
same filter, and keeping both would only restore the empty grid that the
grouping exists to remove. Results are 350px cards showing **every type the item
carries**, each as an element mark and its own value, in the detail view's order
— a weapon leads with its `dps` figure, which is the one value with no element
and so the one that carries a word. Never a summed total, which the game never
shows, and the row wraps rather than dropping a type. Measured against the built
page at the card's fixed 350px, the stat column is 270px and holds `dps` plus
three damage types — the tightest of those 1,235 one-line cards
(`legendary_greathammer03`) fills exactly 270px — so the 38 weapons carrying
four or five types take a second line, inside a 98px card with nothing clipped.
The pair is `stv-dps`, not `dps`: the detail view names its own headline `.dps`
as a bare selector, and a card pair sharing that name silently inherited its
15px gold figure and stood taller than the numbers beside it. Clicking one opens a full detail view
with the leader-dot stat rows, affix lines and a provenance footer naming the
`.DAT` path and whether the numbers are TIDBI's rendered values or a flagged
DAT base value. Its **Item** block lists Item Level, attack speed, **Weapon
Range**, sockets and set. Three built fields are **deliberately not rendered**,
and all stay in `items.json` (none was ever a CSV column — that export carries
`lv`, `ml` and `lr`):

- **`xl` (`MAXLEVEL`)** — the level the item stops scaling at, a property of the
  drop rather than of the item. Present on 2,666 of the 6,176 records.
- **`skm` (`MAX_SOCKETS`)** — **not** the item's own cap, which is why it is
  gone. It is the ceiling across the item's variants: `legendary2_sword05`
  (Cerulean Nightmare) declares `SOCKETS` 2 and `MAX_SOCKETS` 4, and the 4
  belongs to its `c` variant, the **Netherrealm Sword**, which is the one that
  spawns with four. Rendering it read as "you can socket this to 4", which the
  game does not allow. Every legendary trio in the corpus has this shape — the
  1H axe 2/2/4, the greataxe, greatsword and bow 3/3/5 — and on 1,857 of the
  2,168 records carrying an `skm` it exceeds the socket count shown beside it.
  `SOCKETS` itself is what the item spawns with, not a cap either: the
  `*SLOTS` files in `2HAXE/` are separate pre-socketed items, not rolls of the
  plain ones.
- **`ml` (`MINLEVEL`)** on everything you *wear* — it is neither of the two
  numbers around it. The Aenigma reads `lv` 54, `ml` 45, `lr` 61: three
  unrelated levels on one item, and it is `lr` that gates equipping. It equals
  `lv` on 64 of the 2,245 records carrying one, and is 1 on 258 where `lr` is
  the real requirement, so a "Min level" row said nothing a player could use.

`MINLEVEL` keeps its row on **socketables**, where it is a different field
entirely and is labelled **Required Item Level to Socket** — the item level a
gem needs before it can go into a socket. The evidence is a clean ladder: the
seven ranks of every gem family carry exactly **1, 14, 28, 42, 56, 70, 84** (a
step of 14) against their own levels of 8, 22, 36, 50, 64, 78, 92 — a fixed 8
higher — and all eight ember families agree on all seven numbers. Nothing else
in a gem's record explains a second level field, and the only level-shaped
requirement a gem has is the item it goes into. The `*_BASE` templates carry
`998`, a sentinel rather than a requirement. The reading is the user's and it is
an inference from that ladder, not a figure the game states on the gem.

Damage and armor render as ranges. Weapons also show **Damage per Second** and
the attack speed in the game's wording (`Very Fast Attack Speed (0.72 seconds)`).
Requirements are labelled with the game's names — **Focus** and **Vitality**,
which the DAT still calls `MAGIC_REQUIRED` and `DEFENSE_REQUIRED`. The level and
stat branches are shown as the alternatives they are, joined by an `or`, with any
class restriction named underneath as `<Class> only`; the rail's stat-cap filters
use the same four names. On the 74 **augmented weapons** the kill-count task and
the stats it unlocks are their own block, ahead of the affixes and marked as
locked until the task is done (§7).

**Weapon Range is the attack's reach**, not a damage range — and the two used to
sit close enough to be mistaken for each other, because `RANGE` rendered in the
type line as `Axe · Legendary · 0.6 range` while the item's actual damage range
appeared two blocks below. It is the distance at which the weapon's attack
connects, and it is read off the **weapon base templates**
(`MEDIA/UNITS/ITEMS/SWORDS/BASE_SWORD.DAT`, `.../BOWS/BASE_BOW.DAT`) in the same
field group as `MINDAMAGE`/`MAXDAMAGE`. That is why it is near-constant per type
and says less about an individual item than the number suggests. All **1,372**
records carrying it are weapons; no other record in the corpus has the field.
The two bands do not overlap: melee **0.5–1.8** (Claw 0.5, Sword/Mace/Axe 0.6,
Greatsword/Greataxe/Greathammer/Staff 0.8, Polearm 1.8) against ranged **5–12**
(Cannon 5, Pistol/Shotgonne 6, Wand 7, Bow 9, Crossbow 12) — an ordering that
matches the game, crossbows out-ranging bows and cannons the shortest firearm.
The exceptions are what make the row worth showing: `axe_u05x` **The Axe of
Throwing** is **9** where 93 of the 101 Axes are 0.6, and the two rifles filed
under Shotgonne (the corpus has no `Rifle` type) read 17 and 12. Three caveats:
**Wands** are the one type that genuinely varies (6–8 common, up to 20);
**Staff**'s 0.8 files it with the two-handed melee weapons rather than the ranged
group, which is how the `.DAT` groups it and consistent with staves being a 2H
melee class, but is not the intuitive placement; and **`Dagger01`**'s 1.8 is what
a lone cut item's value looks like — `ml` 777, no tier, unspawnable. The `.DAT`
names the field `RANGE` and nothing more, and **TIDBI has no column for it**, so
unlike damage and armor there is nothing to cross-check against: the reach
reading is an inference from the data, not a figure the game states anywhere.

A **Set Bonuses** block sits under the affixes on all 556 set pieces, showing the
whole set's ladder — one ruled `N pieces` divider per rung, its bonuses beneath
it, and a header stating **two** numbers: how many pieces exist and how many a
full set needs, `<set name> 16 pieces (10 piece set)`. The two differ on 47 of
the 80 sets, in both directions — Mondon's Vestment ships 16 against a 10-piece
ladder, Cornerstone ships 7 against a 9-piece one. This is the block the game and
TIDBI both print and the item itself cannot answer. The set's name in that header
is **the tooltip's one link**: clicking it drops every other filter — the search
box, the facets, the tier strip, the sockets and the other set controls — and
hands back the grid filtered to that set alone. It carries the record's own `set`
field rather than the definition's name, because that is the string the set
filter matches on; `build.py` writes both from the same `DISPLAYNAME`, so the
button cannot name a set the filter would then refuse — checked against all 556
pieces, which agree on every one. A `<button>` and not an `<a>`: it is an
action on this page, and the hash it writes is a filter state the page owns. The
clear it runs is the same `resetState()` `#reset` runs, extracted for exactly
that reason — the two cannot drift apart. Rungs the set gates above what
it ships are drawn dimmed and labelled (`9 pieces · set ships 7`) rather than on
the assumption a reader knows the set is incomplete. The rungs reuse the
`.or`/`.cond` divider, but not `.fx.locked` — that means something else (a stat
the item has behind a task the player can still finish) and the page test asserts
on it by name, so borrowing it would make those assertions quietly match more
than they were written to.

**Tier colours are read out of the game's own art**, not chosen by eye. TL2 paints
item quality with the `QUALITY_OVERLAY_*` images declared in
`MEDIA/UI/HUD/INGAMETEXTURESHEETS6.IMAGESET` and stored in the matching `.DDS`;
sampling the saturated pixels of each 48×48 tile gives `magical #319C00`,
`rare #2182FF`, `unique #EF6100`, `set #7B00CE`, `quest #D38E00` and
`unidentified #E90008`. Three of those name tiers this site has and are used
verbatim. `set` is the exception: `#7B00CE` is a glow meant to sit on icon art
and only reaches **2.35:1** against the panel, so it is lifted to `#A855F7`
(4.57:1) along the same hue — the page test fails if the raw value is pasted
back. Two tiers have no overlay to read at all: the game draws Normal items
uncoloured, and it ships no legendary overlay, so `--t-legendary` keeps this
project's existing red. Note the game's ladder is one rung longer than this
site's — its *magical* (green) tier is not a tier the facet emits, so the 576
`*_m<digit>` items sit under **Rare** (blue) here. The `set` colour is defined
but no longer worn: because Set is a membership rather than a rarity, every set
piece is now painted in its own rarity's colour (below), leaving `--t-set` as
the game's value on record — it still paints the set-name line in the detail
view — rather than as anything a card wears.

**The rarity filter is a strip of pills above the grid**, not a rail section: it
is the one filter that pairs with the default sort, so it sits next to the
results it orders. One pill per rarity, each carrying its own count and inked in
its own colour, in the same order the list runs. It is the same facet as before
— same key, same values, same cross-facet counts — rendered somewhere else.

**The detail's type line reads tier-then-type** — `Legendary Axe`, `Rare Sword`,
`Set Shoulder Armor` — with the tier word painted in its own tier colour, so the
line reads as one glance rather than two. It used to read `Axe Legendary` with
the tier in a flat teal that no tier owns. Painting the word needs a class that
colours **the element it is put on** (`.t-rare`), which the `.q-*` set cannot do:
those colour a *descendant* `.nm` and rule a card's left edge, and the type line
is neither a card nor an `.nm`. `app.js` derives the `.t-` name from the `.q-`
one, and the page test requires both sets to name the same variable for the same
tier, so a tier cannot be added to one and forgotten in the other.

Rendering follows grimtools: each card's HTML is **built once and memoized by
item id**, results are committed as **one `innerHTML`**, `content-visibility:
auto` skips offscreen cards, and filtering applies **on Enter or a checkbox
click, never per keystroke** — which is what keeps the memo cache effective.
Results cap at 500 with the truncation stated and a **Show all** button, rather
than silently dropping items.

State lives in the location hash (`#tier=Legendary&type=Axe&item=legendary_axe01`)
so a filtered view is shareable and survives reload. This diverges from
grimtools, which uses an LZ-compressed `?query=` — a query string is unreliable
on `file://`, and legibility was worth more than shortness here. Note chrome
refuses `history.replaceState` on `file://`, so `writeHash` falls back to
assigning `location.hash`.

A retired `#cat=` link is still accepted and expanded into the types of the
group it names, so an old bookmark filters rather than silently doing nothing —
silently showing all 6,051 items is the one failure mode worth avoiding here.
It resolves to the group as the taxonomy defines it *today*: `#cat=Armor` is now
1,827 items, not the 2,206 the old flat category held, because Belt and Shield
have moved out. `Jewelry` is aliased to `Accessories`; nothing writes `cat=` any
more, so the URL normalises to `type=…` on the first checkbox touch.

### Verifying

`build.py` self-checks: 6,262 decoded / 0 failures, 85 templates, 6,176 emitted,
exact damage/armor totals, the dps and base-value counts, the Aenigma and Longfang
rows against ground truth (theirs *and* alfgeir's — both dps figures are alfgeir's
own), the `heavy_g_amulet_f_alt_b` row as a regression test for the three reported
bugs, the stat-less weapon set, tier counts, and that every referenced icon has
sprite coordinates. It also asserts that `TYPE_GROUPS` names every type the
corpus emits — a type missing from the taxonomy would otherwise render in the
wrong group, or vanish from the rail, without failing anything. It also asserts
that every referenced set token has a name *and* a bonus ladder, that TIDBI's
thresholds equal the DATs' on all 80 sets, that no rung sits below 2 pieces, and
that exactly 15 sets gate a rung they cannot reach — the last because the page
styles those rungs differently and a change in the count would restyle them
silently. It also asserts the set-item rarity split is exactly 210 Rare / 346
Unique, since that number is what colours 556 cards.

`db\check_page.js` goes further and drives the built page in a real DOM — 173
assertions covering filtering, multi-select, search, sort, the detail view,
provenance, hash deep links, the three reported bugs, the base-value badge, the
grouped rail (that Shield and Belt sit where the taxonomy puts them, that a
group's count equals the sum of its rows, that a group header checks the boxes
it stands in for, that a retired `#cat=` link still resolves, that the four
categories carry a fold glyph and a subgroup none, that folding takes a
category's subgroups and rows and nothing else, survives the rail being
rebuilt, and is not a filter, and that the damage rows read as words while the
keys underneath still filter), the set bonus
ladder in three shapes (a set that ships every piece it gates on, one that does
not, one gated on more pieces than exist), and a set piece's rarity (the type
line, the word that carries the colour, the card class for both rarities, and a
stale `#tier=Set` failing legibly), the tier strip (its pill order and counts,
that the four counts are the data's own with the set pieces folded in and sum to
the corpus, and that no pill names Set), the set controls (the toggle's 556, the
select's 9, that the two spell themselves separately in the URL and narrow
rather than union, and that the tooltip's set name clears everything else and
lands on that set alone), and both halves of `MINLEVEL` — absent on the Aenigma,
present and relabelled on a gem. It needs jsdom, which is not a project
dependency:

```
npm i jsdom          # anywhere on NODE_PATH
node db\check_page.js
```

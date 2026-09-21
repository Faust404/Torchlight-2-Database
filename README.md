# Torchlight II item database

Torchlight II's items, extracted from the game's own files and built into a
single browsable HTML page — 6,176 items with damage, armor, requirements, set
bonuses, socketables and icons, each one traced back to the `.DAT` file it came
from. The page shows 6,051 of them; the other 125 are monster-only weapons and
test props that carry no tier the sources agree on, so they stay in the JSON and
the CSV but out of the listing.

There is no server and no database. The build reads the game's archives and
inlines everything into one self-contained `out/index.html` (8.4 MB) that works
offline, straight off disk.

## Building it

**You need Torchlight II installed.** The build reads `DATA.PAK` and
`DATA.PAK.MAN` from a local copy of the game; it cannot run in CI, and this repo
does not contain them. Nothing here writes to the game — all reads.

```sh
python src/build.py          # writes out/
```

It finds the game at the default Steam path, or wherever `TL2_GAME_DIR` points:

```sh
TL2_GAME_DIR='/d/Games/Torchlight II' python src/build.py      # bash
```
```powershell
$env:TL2_GAME_DIR = 'D:\Games\Torchlight II'; python src/build.py   # PowerShell
```

Python 3 with [Pillow](https://pypi.org/project/Pillow/) — `pip install Pillow`.
That is the only dependency. `--no-app` stops after the data and skips the page.

## What comes out

| File | What it is |
|---|---|
| `out/index.html` | the whole site, 8.41 MB, self-contained — open it straight off disk |
| `out/items.json` | 6,176 items, 2.31 MB |
| `out/items.csv` | the same rows as a flat table, for Excel or pandas |
| `out/sets.json` | the 80 set bonus ladders |
| `out/icons.png` | all 1,053 icons as one 1,485×1,440 sprite |
| `out/icons.json` | icon name → `[x, y, w, h]` |

## Layout

```
src\      the pipeline: PAK/MAN extraction and the builder
data\     the three inputs the build cannot run without
web\      the browser's source, inlined by the build
verify\   check_page.js — the regression suite
out\      what the build writes (gitignored)
test\     local scratch (gitignored)
```

`data\` holds only what the build cannot run without: the archive index, the
item tables, and the icon PNGs. Delete one and the build stops. Everything else
non-production lives in `test\`, which is scratch and not tracked.

## What the data is

The game ships no loose data files — everything sits inside two containers,
`DATA.PAK` (869 MB) and its manifest, in a format nothing publicly documented.
Both are decoded here: **70,437 validated paths** in the archive, and the binary
field section of the `.DAT` format that hides the item stats. All 6,262 item
`.DAT`s decode exactly.

The numbers the site shows are the game's own *rendered* values, not the raw
fields — damage, armor, requirements and DPS are all derived by the formulas
recovered from the files, and audited against a 2014 third-party item viewer
rather than spot-checked. Where a value can only be transcribed, the site says
so.

**What is not cracked yet**, and what the site therefore does not show: drop
weights (the `TREASURE_*` tables are mapped but their probabilities are still
unnamed), 64 field hashes covering 8.3% of field occurrences, and level
geometry.

## Provenance and third-party material

This is an unaffiliated fan project. Torchlight II was developed by Runic Games;
the item names, stats and the 1,053 icons under `data\icons\` are the game's own
art and are committed here only because the build cannot run without them.

Two third-party sources fed the work and are credited in
[REFERENCE.md](REFERENCE.md): **TIDBI**, a 2014 item viewer whose Access
database was the shortcut around the `.DAT` binary section, and the **alfgeir**
item-name mapping. Neither is redistributed here.

## More

**[REFERENCE.md](REFERENCE.md)** is the full technical record — how both formats
were reverse-engineered, every tool, and the reasoning behind every number the
site displays. Read it before changing anything under `src\`.

The build is checked by [`verify/check_page.js`](verify/check_page.js), which
drives the built page in a real DOM and asserts 182 behaviours:

```sh
npm i jsdom
node --max-old-space-size=6144 verify/check_page.js
```

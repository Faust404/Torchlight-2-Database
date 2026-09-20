# Bitter, embedded

The item card sets its affix text and its set-bonus ladder in Bitter, a slab
serif. This folder holds the face itself rather than a `<link>` to it, because
the built page inlines everything else and is meant to work off `file://` with
no network — a stylesheet from `fonts.googleapis.com` would silently fall back
to Georgia the moment the connection was missing, and nothing in the page would
say so.

## What is here

| File | What it is |
|---|---|
| `bitter-latin.woff2` | Bitter, the Latin subset, one variable file — 33 KB, 317 glyphs |
| `OFL.txt` | The SIL Open Font License 1.1 the face ships under |

There is **one file, not two**, because Bitter is a variable font: Google Fonts
serves the identical `woff2` for `wght@400` and `wght@600`, and the weight is
selected at render time from the axis. Its `fvar` axis is `wght 100..900` with
named instances at every hundred, so 400 and 600 are both real weights rather
than one weight and a synthesised bold.

**The axis default is 100**, not 400 — this is Thin unless something says
otherwise. That is why `db/build.py` writes `font-weight: 400 600` into the
`@font-face` rather than leaving it out: an omission would set every affix line
in the corpus in Bitter Thin.

## Provenance

Fetched from Google Fonts on 2026-09-20, `Bitter v42`, Latin subset:

    https://fonts.gstatic.com/s/bitter/v42/rax8HiqOu8IVPmn7f4xp.woff2

`OFL.txt` comes from the upstream project, `google/fonts` at
`ofl/bitter/OFL.txt`. Bitter is licensed under the SIL Open Font License 1.1,
which permits redistribution and embedding; the licence has to travel with the
font, which is why it is committed here beside it.

Unlike SlingBold — the face this project declined to commit for the title
treatment — Bitter is redistributable, so there is no reason to fetch it at build
time and every reason not to.

## Why the Latin subset is enough

The only text the card sets in this face is affix lines, augmented-effect lines,
set-bonus text and set names. Across all 6,176 items and all 80 ladders those
strings contain exactly **one** non-ASCII character, `U+2019` — the right single
quote in *Mondon's Vestment* — and it is in the Latin subset, alongside the
digits, the percent sign and the `+`/`-` that every stat line uses. Checked
against the font's own `cmap`; all 95 characters the corpus needs are present.

The other faces on the page are system ones (`Segoe UI`, Roboto, Helvetica) and
are not embedded.

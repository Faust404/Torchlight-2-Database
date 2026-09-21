# -*- coding: utf-8 -*-
"""Every path this repo computes, anchored to this file.

One module so that nothing walks its own ancestors and nothing resolves against
the process CWD: a build run from the wrong directory has to fail, not quietly
read a stale tree from somewhere else.

    data/   committed build inputs -- the three things the build cannot run
            without. Delete one and the build stops.
    src/    the pipeline: this file, build.py, the PAK reader under tl2/
    web/    the browser's source; build.py inlines all of it into out/
    out/    what build.py writes, regenerated wholesale and gitignored
    test/   non-production: the jsdom suite, the card studies, fixtures

The game install is the one input this repo cannot commit -- DATA.PAK is 829 MB
of Torchlight II's own data. It is read, never written, and looked for as:

    1. $TL2_GAME_DIR, if set
    2. DEFAULT_GAME_DIR below

Point TL2_GAME_DIR at the folder that holds PAKS\\ -- DATA.PAK and its manifest
live in there. Nothing here touches the disk at import time, so this module
imports fine on a machine with no game installed; the failure lands at
require_pak(), which is reached only when the build actually opens the archive.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SRC = HERE
DATA = os.path.join(ROOT, 'data')
WEB = os.path.join(ROOT, 'web')
OUT = os.path.join(ROOT, 'out')
TEST = os.path.join(ROOT, 'test')

# --- the PAK reader: imported by build.py, also runnable on its own ----------
TL2_SRC = os.path.join(SRC, 'tl2')

# --- build inputs, committed -------------------------------------------------
# Flat on purpose: these names say what the data is, not who published it.
# index.tsv is the game's own archive index and the tables began as TIDBI's
# export, but TIDBI is a cross-check now -- README.md §5 records its provenance,
# and nothing in the build needs to know it.
PAK_INDEX = os.path.join(DATA, 'index.tsv')   # 70,437 validated PAK paths
CSV_DIR = os.path.join(DATA, 'csv')           # the item tables the build reads
ICON_DIR = os.path.join(DATA, 'icons')        # the 1,053-file sprite source

# alfgeir is deliberately NOT under data/. load_alfgeir() returns {} when this
# file is missing and the build still runs -- and measurably: built with the
# file absent, alfgeir contributes 0 tags and every artifact hashes the same.
# It is the *second* link in the name chain (build.py, item_name), so it is a
# standing cross-check that could matter if that chain changes, not an input.
# Research material, so test/.
ALFGEIR = os.path.join(TEST, 'alfgeir', 'EN.json')

# --- the game install, outside the repo --------------------------------------
DEFAULT_GAME_DIR = r'E:\Games\Steam\steamapps\common\Torchlight II'
GAME_DIR = os.environ.get('TL2_GAME_DIR') or DEFAULT_GAME_DIR
PAKS = os.path.join(GAME_DIR, 'PAKS')
PAK = os.path.join(PAKS, 'DATA.PAK')
MAN = os.path.join(PAKS, 'DATA.PAK.MAN')


def require_pak():
    """PAK if it is there, otherwise a failure naming the variable that sets it."""
    if not os.path.exists(PAK):
        raise FileNotFoundError(
            'DATA.PAK not found at %s\n'
            'The game itself is not in this repo. Set TL2_GAME_DIR to the '
            'Torchlight II install folder that holds PAKS\\ and run again.' % PAK)
    return PAK

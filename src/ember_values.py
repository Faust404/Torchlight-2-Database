"""Blood, Iron and Void Ember: the two option sets each rank can roll.

The four rare ember families -- BLOOD, CHAOS, IRON and VOID EMBER -- ship no
affixes at all (their item DATs carry an empty `AFFIXES` list and the rank files
declare `n_lists=0`), so the game rolls one Armor/Trinket bonus and one Weapon
bonus when the gem is generated. Which bonuses it may roll, and what they are
worth, is the affix pool in `MEDIA/AFFIXES/GEMS/`.

CHAOS EMBER's pool is fully readable from those files: every one of its 20
families ships seven files, one per 14-level band, each holding that band's
fixed value. `build.py` derives that pool from the PAK. The other three
families do not work that way. Each of their affixes is a *single* file with a
band of 1-999 and one fixed float -- Blood's Health is 10, Iron's Armor is 20,
Void's Mana is 20 -- while the number the game actually prints grows with the
gem's level. The per-level multiplier is not in the affix, not in the item DAT,
and not in `MEDIA/STATS/<Stat>.DAT`, whose reference section this project's
decoder does not read. It is per stat, too: Blood's Health and Health Regen
share one factor, but Iron's Armor (20 at file, 5 shown at ilvl 8) and Iron's
Ranged bonus (10 at file, 6 shown) do not.

So these 42 numbers are transcribed, and the game files cannot check them.
Two of the ladders are not smooth, and a reader checking them against a formula
will think they are typos: Iron's degrade-armor runs 8, 29, 31, 54, 81, 115,
155, and Void's Mana Steal 2, 4, 5, 7, 8, 10, 11. Both are the wiki's values.
One of the two turns out to be exact at every rank and the other is a
deliberate exception to the curve -- see below.

The source is the wiki's rare-gems table:

    https://torchlight.fandom.com/wiki/Gems_(T2)   (retrieved 2026-09-20)

That page is trustworthy on the numbers: its Normal-gems table lists the four
varying families (Flame, Ice, Spark, Venom), and every one of its 56 values
matches TIDBI's own tooltip text for the same socketable exactly -- e.g. Flame
Ember Speck, "+8 Fire Armor / +7 Fire Damage", which is TIDBI's line for
`tl2_flameember_rank1` to the character.

Wording, though, is not transcribed verbatim. The wiki's rare-gems table is
internally inconsistent about case and phrasing -- the same Blood option appears
as "Health Stolen on Hit" at ranks 1-3 and "Health stolen on hit" at 4-7, Iron's
armor is "+5 Physical Armor" at rank 1 and "+25 to Physical Armor" from rank 3,
and "per Second"/"per second"/"over 5 seconds" all appear. Every string below is
therefore normalised to the game's own tooltip text as TIDBI records it, which
is also what the site prints for every other item: "12 Health stolen on hit",
"7.2 Health recovery per second", "+5 to Physical Armor", "+6% Melee Weapon
Damage bonus", "18 Physical Damage Reflected", "35 Physical Damage over 5 sec.".
Nothing is dropped or rounded -- the ladder of numbers is the wiki's.

THE SCALING LAW NOW EXISTS, AND SIX OF THESE NUMBERS ARE EXCEPTIONS TO IT.
`ceil(pct * CURVE(level) / 100)`, with the curve per stat in
`MEDIA/GRAPHS/STATS/` and the level taken from the carrier item, reproduces
nine of these thirteen ladders exactly, and a tenth at six of seven ranks. One
fits nothing at all. The remaining two disagree with the transcription in six
cells, and those six are kept as the wiki has them:

    Iron degrade-armor   wiki 8, 29, 31, 54, 81, 115, 155
                         curve 4, 15, 31, 54, 81, 115, 155     ranks 1-2
    Blood health-regen   wiki 7.2, 15.6, 24, 33, 41, 50, 58
                         curve 7.2, 15.6, 24, 32.4, 40.8, 49.2, 57.6   ranks 4-7

The wiki wins because it is the source of record for these 42 numbers: they are
transcribed, not derived, and the curve is a reconstruction that could be wrong
at a cell without anything else noticing. There is also no third source to break
the tie -- TIDBI's export carries no tooltip text for any rare ember, which is
exactly why these were transcribed in the first place. What makes the wiki worth
following is checkable elsewhere: its Normal-gems table covers the four varying
families and all 56 of its values match TIDBI's own effect lines to the
character. Ranks 3+ of Iron's degrade-armor agree, so the divergence is in two
cells and not a different reading of the ladder.

If the curve is ever shown to be right at these six cells, that reverses this
decision and the numbers below change -- nothing else in the file depends on
which way it goes.

Of the two unsmooth ladders flagged above, this settles them in opposite
directions: Void's Mana Steal is exact at all seven ranks, and Iron's
degrade-armor is one of the two that diverge, at exactly the two ranks that
looked wrong.
"""

# The seven ranks in order, with the item level each ships at. All four rare
# families share this ladder, as do the four normal ones. Ranks 1-7 here are the
# files TL2_<FAMILY>EMBER_RANK1..7; the unnumbered BASE record is a template with
# no level, and `build.py` attaches no pool to it.
RANK_LEVELS = (8, 22, 36, 50, 64, 78, 92)

# Per family, 'a' is the Armor/Trinket pool and 'w' the Weapon pool, each a list
# of seven option lists -- one per rank, in RANK_LEVELS order. Options are whole
# tooltip lines: the site prints them as written, and the number in each is
# already the value that rank rolls (no scaling is applied downstream).
FAMILIES = {
    # 10 x (0.4 x ilvl + 1.6) reproduces both of Blood's Armor/Trinket ladders,
    # so this family is the one that could be derived if the multiplier in
    # MEDIA/STATS were readable. Health is exact at all seven ranks; the Health
    # Regen ladder is that factor at one decimal, as printed.
    'BLOOD EMBER': {
        'a': [
            ['7.2 Health recovery per second', '+48 Health'],
            ['15.6 Health recovery per second', '+104 Health'],
            ['24 Health recovery per second', '+160 Health'],
            ['33 Health recovery per second', '+216 Health'],
            ['41 Health recovery per second', '+272 Health'],
            ['50 Health recovery per second', '+328 Health'],
            ['58 Health recovery per second', '+384 Health'],
        ],
        'w': [
            ['12 Health stolen on hit', '35 Physical Damage over 5 sec.'],
            ['25 Health stolen on hit', '130 Physical Damage over 5 sec.'],
            ['38 Health stolen on hit', '285 Physical Damage over 5 sec.'],
            ['51 Health stolen on hit', '520 Physical Damage over 5 sec.'],
            ['64 Health stolen on hit', '865 Physical Damage over 5 sec.'],
            ['77 Health stolen on hit', '1245 Physical Damage over 5 sec.'],
            ['90 Health stolen on hit', '1945 Physical Damage over 5 sec.'],
        ],
    },
    'IRON EMBER': {
        'a': [
            ['+5 to Physical Armor', '+6% Melee Weapon Damage bonus',
             '+6% Ranged Weapon Damage bonus', '18 Physical Damage Reflected'],
            ['+14 to Physical Armor', '+12% Melee Weapon Damage bonus',
             '+12% Ranged Weapon Damage bonus', '39 Physical Damage Reflected'],
            ['+25 to Physical Armor', '+18% Melee Weapon Damage bonus',
             '+18% Ranged Weapon Damage bonus', '56 Physical Damage Reflected'],
            ['+36 to Physical Armor', '+25% Melee Weapon Damage bonus',
             '+25% Ranged Weapon Damage bonus', '80 Physical Damage Reflected'],
            ['+48 to Physical Armor', '+31% Melee Weapon Damage bonus',
             '+31% Ranged Weapon Damage bonus', '101 Physical Damage Reflected'],
            ['+61 to Physical Armor', '+37% Melee Weapon Damage bonus',
             '+37% Ranged Weapon Damage bonus', '122 Physical Damage Reflected'],
            ['+73 to Physical Armor', '+44% Melee Weapon Damage bonus',
             '+44% Ranged Weapon Damage bonus', '143 Physical Damage Reflected'],
        ],
        'w': [
            ['+16 Physical Damage', '-8 to All Armor per hit'],
            ['+35 Physical Damage', '-29 to All Armor per hit'],
            ['+54 Physical Damage', '-31 to All Armor per hit'],
            ['+73 Physical Damage', '-54 to All Armor per hit'],
            ['+92 Physical Damage', '-81 to All Armor per hit'],
            ['+111 Physical Damage', '-115 to All Armor per hit'],
            ['+130 Physical Damage', '-155 to All Armor per hit'],
        ],
    },
    'VOID EMBER': {
        'a': [
            ['+11 Mana', '1.1 Mana recovery per second'],
            ['+14 Mana', '1.4 Mana recovery per second'],
            ['+17 Mana', '1.7 Mana recovery per second'],
            ['+20 Mana', '1.9 Mana recovery per second'],
            ['+23 Mana', '2.2 Mana recovery per second'],
            ['+25 Mana', '2.5 Mana recovery per second'],
            ['+28 Mana', '2.8 Mana recovery per second'],
        ],
        'w': [
            ['2 Mana stolen on hit'],
            ['4 Mana stolen on hit'],
            ['5 Mana stolen on hit'],
            ['7 Mana stolen on hit'],
            ['8 Mana stolen on hit'],
            ['10 Mana stolen on hit'],
            ['11 Mana stolen on hit'],
        ],
    },
}

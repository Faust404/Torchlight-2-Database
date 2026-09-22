/* Torchlight II item database -- client.
 *
 * The rendering discipline is grimtools':
 *   1. every card's HTML is built once and memoized by item id, so re-filtering
 *      and re-opening an item are both cache hits;
 *   2. results are assembled as one string and committed with a single
 *      innerHTML, not N insertions;
 *   3. content-visibility:auto (in the CSS) lets the browser skip offscreen
 *      cards entirely;
 *   4. filtering happens on apply (Enter / checkbox click), never per keystroke,
 *      which is what keeps the memo cache effective.
 *
 * One deliberate divergence from grimtools: it serialises advanced-search state
 * into a compressed ?query= because it is a served site. This page must work
 * from file://, where a query string is unreliable, so all state rides in the
 * location hash instead. Readable key=value pairs, no compression -- legible
 * and shareable were the goals; shortness was only ever the means.
 */
(function () {
  'use strict';

  var ITEMS = window.DB.items;
  var ICONS = window.DB.icons;
  // Set bonus ladders, keyed on the DAT token -- which is what an item carries
  // as `setid`, not the display name it shows. `c` is how many pieces of the set
  // this corpus ships, which is what a rung is measured against.
  var SETS = window.DB.sets || {};
  // X-offsets into the five-tile strip of element marks the page inlines as
  // --esprite, one per entry in DMGTYPES and in that order. Built by build.py
  // from the PNG's own width, so the strip and these offsets cannot disagree.
  var ELEM = window.DB.elem || {};
  // The stat vocabulary the build derives: [slug, label, hasValue] per entry,
  // sorted by label. A stat's *identity* in the URL and in a filter row is its
  // index into this list, which is what the per-item index stores -- so the
  // picker and the predicate can never disagree about what a slug means.
  var AFF = window.DB.aff || [];
  // The rail's taxonomy, injected by build.py from TYPE_GROUPS -- the same list
  // that decides the CSV's category column. Each entry is {g: group,
  // s: subgroup or null, t: [types]}, already in render order.
  var TAXONOMY = window.TAXONOMY;
  // #cat= named this project's own four categories, one of which the taxonomy
  // now spells differently. Read-only: nothing writes cat= any more.
  var LEGACY_CAT = { 'Jewelry': 'Accessories' };

  var CAP = 500;                 // grimtools renders 500 and stops; so do we
  var showAll = false;

  var DMGTYPES = ['physical', 'fire', 'ice', 'electric', 'poison'];
  // Keyed on the tier an item actually wears, so nothing looks up 'Set' any more
  // -- ownTier never returns it. The entry stays because the class it names
  // still has a job: --t-set paints the set-name line in the detail view, so a
  // .q-set that reached this map should still get the Set ink rather than fall
  // through to Unclassified's grey.
  var TIERCLS = {
    'Normal': 'q-normal', 'Rare': 'q-rare', 'Unique': 'q-unique',
    'Set': 'q-set', 'Legendary': 'q-legendary', 'Unclassified': 'q-unclassified'
  };
  // The class that paints an element in a tier's own colour, as opposed to
  // TIERCLS's, which tints a descendant .nm and rules a card's left edge. Only
  // the detail's type line needs it. Derived rather than listed so a new tier
  // cannot be added to the stylesheet's .q- rules and forgotten in its .t- ones.
  function tierInk(q) { return (TIERCLS[q] || 'q-unclassified').replace('q-', 't-'); }
  // The tier an item wears, which on a set piece is not its facet tier. Set is
  // a membership the DAT asserts, not a rarity -- every one of the 556 set
  // items is really Rare or Unique, and the game paints them that way and
  // prints "Unique Set Belt" rather than "Set Belt". `uq` is that displaced
  // rarity, which build.py emits only on set items, so this is identity
  // everywhere else.
  function ownTier(o) { return o.uq || o.q; }
  // Ascending rarity: Normal is the commonest and sits first, Legendary the
  // rarest and last. This one order drives two things that must not disagree --
  // TIERORDER is the strip's pill order and TIERRANK is the sort's primary key,
  // so the pills read left to right in the same order the list runs top to
  // bottom. Unclassified is last and stays in both even though the built page
  // carries none: it is the canonical order, and tierInk's fallback names it.
  //
  // Set is deliberately absent. It is a membership, not a rarity -- every set
  // item is really Rare or Unique -- so the facet files each one under the
  // rarity it actually is (see FACETDEF's ownTier) and the 556 are counted in
  // those two pills. Set filtering is a separate control over the top.
  var TIERRANK = { 'Normal': 0, 'Rare': 1, 'Unique': 2, 'Legendary': 3, 'Unclassified': 4 };
  var TIERORDER = ['Normal', 'Rare', 'Unique', 'Legendary', 'Unclassified'];
  // What the panel's rarity chips offer: TIERORDER's first four, without the
  // Unclassified tail. None of those 125 records reaches the page, so a fifth
  // chip would be a control that can never match anything -- the same trade the
  // socket row makes by leaving out zero. Written as a slice rather than four
  // literals so the chips cannot get out of the strip's order.
  var RARITYCHIPS = TIERORDER.slice(0, 4);

  // The game's names for the .DAT's requirement fields. TL2 renamed Torchlight
  // 1's Magic -> Focus and Defense -> Vitality, but the field names kept the
  // old words. Confirmed against alfgeir, whose rendered keys are literally
  // FocusRequirement and VitalityRequirement.
  var REQLABEL = { str: 'Strength', dex: 'Dexterity', mag: 'Focus', def: 'Vitality' };

  // The socket counts the panel offers, one chip each. The corpus runs 1 to 5
  // (`sk` is absent on the 4,453 items with none, which n() reads as 0), so
  // five chips cover every item that can hold a socket at all. Written down
  // rather than derived, because this is the *control* and not the data: the
  // row must hold still when the corpus gains or loses a five-socket item.
  // Every reader of a socket count -- matches(), readHash, writeHash, the panel
  // -- goes through this list, so no spelling can name a chip that is not on
  // screen.
  //
  // Zero is deliberately not a chip. It is reachable in the data but the row is
  // "how many do you want", and a reader who wants none wants no filter -- which
  // is the same reading the rest of this row follows. The cost is that the
  // 4,453 socket-less items cannot be asked for *by count*; they are found by
  // every filter that says nothing about sockets.
  var SOCKCHIPS = [1, 2, 3, 4, 5];

  // ------------------------------------------------------------------ state
  // What the page opens on, what #reset restores, what readHash falls back to
  // when a URL names a sort it cannot read, and the value writeHash elides
  // because writing the default into a URL says nothing. Four call sites that
  // have to agree -- as four separate literals, one edited and the others
  // missed gives a page whose reset button and first paint disagree.
  var DEFAULT_SORT = 'tier';

  // There is no separate `cats` facet. The rail groups types under a category
  // header and the header toggles those types, so "category is Weapons" and
  // "every weapon type is checked" are the same filter -- keeping both would
  // just reinstate the empty grid the grouping exists to remove. A legacy
  // #cat= link is expanded to its types on read; see readHash.
  //
  // Everything the rail used to carry beside the type facet is the panel's now,
  // and each filter went with its own state rather than leaving a field behind
  // that nothing could set: the damage *facet* is `dmgv` with a null bound, the
  // socket min/max is the chip set, the four stat caps are a bound pair each,
  // and a single player level is a pair. Every old spelling is expanded on read
  // rather than dropped, and none of them is a filter without a control.
  var S = {
    q: '', types: new Set(), tiers: new Set(),
    set: '', setOnly: false,
    // A set of counts, not a range. The panel's five chips are the only socket
    // control there is, and a range cannot say {2, 4}.
    sockSet: new Set(),
    lvlMin: null, lvlMax: null,
    // str/dex/mag/def -> [lo, hi], and *absent* when neither bound is set --
    // the shape dmgv and armv already use, so one collector reads all three.
    req: {},
    // `plr` reads `lr`, the level an item *requires*; `lvl` reads `lv`, the
    // item's own level. Two different fields, which is what makes two ranges
    // worth having rather than one written twice.
    plrMin: null, plrMax: null,
    cls: new Set(), dmgv: {}, armv: {}, aff: [], setfx: false,
    sort: DEFAULT_SORT, dir: 1, item: ''
  };

  // ------------------------------------------------------------------ utils
  var escEl = document.createElement('div');
  function esc(s) {
    escEl.textContent = s == null ? '' : String(s);
    return escEl.innerHTML;
  }
  function n(v) { return v == null || v === '' ? 0 : (+v || 0); }
  // A numeric filter's floor is 0. Every one of these fields takes a count --
  // of levels, of points of a stat -- and no item has a negative one, so a
  // negative bound is not a narrower filter but a broken one: "level >= -5"
  // matches everything while looking like it does something, and "at most -5"
  // matches nothing at all. `min="0"` states the floor to the browser, which is
  // what limits the spinner and what :invalid keys off, but it cannot stop a
  // typed or pasted "-5" and it cannot see the URL -- and this page's filters
  // live in the hash, so a hand-written `#lvl=-5-` is a supported way in. So
  // the value is floored here instead, where both paths meet: the same function
  // reads a deep link, a typed value and the state back/forward restores.
  //
  // A non-numeric value reads as no filter rather than as NaN. It used to be
  // `+v`, which made `#lvl=abc-` compare against NaN -- false for every item, so
  // it filtered nothing -- while the field showed "abc" and writeHash wrote
  // `lvl=NaN-` back into the URL.
  function floor0(v) {
    if (v == null || v === '') return null;
    var x = +v;
    if (!isFinite(x)) return null;
    return x < 0 ? 0 : x;
  }
  // Damage and armor arrive as the string the game shows: '140-174' when the
  // value varies, '140' when it does not. Everything that has to *compare* two
  // of them uses the midpoint, which is also what the dps figure is built on.
  function avg(v) {
    var s = String(v == null ? '' : v), i = s.indexOf('-');
    if (i < 0) return +s || 0;
    return ((+s.slice(0, i) || 0) + (+s.slice(i + 1) || 0)) / 2;
  }
  function total(o) { var t = 0, k; for (k in o) t += avg(o[k]); return t; }
  // `avg`'s two ends without the halving: '140-174' -> [140, 174], '140' ->
  // [140, 140]. A range filter compares ranges, so it cannot use the midpoint:
  // a sword that rolls 14-28 does overlap a request for 20-30, and avg() reports
  // 21 for it and would then fail a "at least 22" test the item satisfies.
  function ends(v) {
    var s = String(v == null ? '' : v), i = s.indexOf('-');
    if (i < 0) { var x = +s || 0; return [x, x]; }
    return [+s.slice(0, i) || 0, +s.slice(i + 1) || 0];
  }
  // A *signed* bound, where floor0 is deliberately not one. floor0's floor is 0
  // because no level and no stat requirement is negative; an affix value is --
  // 489 index pairs carry a negative low end, `-4~5 to All Armor per hit` among
  // them. A non-numeric bound reads as no bound, the same choice floor0 makes.
  function num(v) {
    if (v == null || v === '') return null;
    var x = +v;
    return isFinite(x) ? x : null;
  }
  function slugify(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Seconds per swing -> the game's wording. Bands derived from alfgeir's own
  // tooltips, which cover all 29 distinct speed values with zero ambiguity.
  // The middle band is "Average"; the game has no "Normal" attack speed.
  var SPEEDBANDS = [['Very Fast', 0.72], ['Fast', 0.88], ['Average', 1.08],
                    ['Slow', 1.21], ['Very Slow', Infinity]];
  function speedBand(sp) {
    for (var i = 0; i < SPEEDBANDS.length; i++) {
      if (sp <= SPEEDBANDS[i][1]) return SPEEDBANDS[i][0];
    }
    return null;
  }

  function iconHTML(o) {
    var c = o.ic && ICONS[o.ic];
    if (c) {
      return '<i style="width:' + c[2] + 'px;height:' + c[3] +
             'px;background-position:-' + c[0] + 'px -' + c[1] + 'px"></i>';
    }
    return '<span class="ph">' + esc((o.t || '?').charAt(0)) + '</span>';
  }

  // `slotClass()` used to live here, sizing the detail view's icon well by the
  // equip slot it imitated. The card draws one tile size for every slot, so the
  // taxonomy has no reader left and went with the well it served. The worn-slot
  // rule it implied does not: `capacity()` in src/build.py states it, against
  // MEDIA/INVENTORY/, and the set ladder dims by it.

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // The card's stat line shows *every* type the item carries, each as an element
  // mark and its own value, rather than the one primary type it used to pick.
  // Picking a largest said the least about the items where it mattered most: a
  // weapon split three ways off a small physical base read as a weak physical
  // weapon, when the split is the thing you would look at. Order is DMGTYPES',
  // the same order the detail view prints, so the two cannot disagree.
  //
  // Still no summed total anywhere -- that would be an invention, since no such
  // number is shown in game.
  function statPairs(map) {
    return DMGTYPES.filter(function (k) { return map[k]; }).map(function (k) {
      return '<span class="stv">' + elemMark(k) + '<b>' + esc(map[k]) + '</b></span>';
    }).join('');
  }

  // A weapon leads with its output, then the damage it is made of; armor is only
  // ever the second thing. The dps figure has no element, so it carries the word
  // instead of a mark -- without it a bare number at the head of a row of bare
  // numbers reads as one more damage type.
  //
  // `stv-dps`, not `dps`. The detail view already owns `.dps` -- its 15px gold
  // headline figure -- and names it as a *bare* selector, so a card pair called
  // `dps` silently inherited both the size and the colour and stood taller than
  // the damage numbers beside it. `stv-` is the card's namespace for this row.
  function statRow(o) {
    if (o.dmg) {
      return (o.dps ? '<span class="stv stv-dps"><b>' + esc(o.dps) + '</b> dps</span>' : '') +
        statPairs(o.dmg);
    }
    if (o.arm) return statPairs(o.arm);
    if (o.fx && o.fx.length) return '<span class="fxn">Effect <b>' + esc(o.fx[0]) + '</b></span>';
    return '';
  }

  // ---------------------------------------------------------------- predicate
  function matches(o, skip) {
    if (S.q) {
      var q = S.q;
      if (o.n.toLowerCase().indexOf(q) < 0 &&
          o.id.toLowerCase().indexOf(q) < 0 &&
          o.t.toLowerCase().indexOf(q) < 0) return false;
    }
    if (skip !== 'types' && S.types.size && !S.types.has(o.t)) return false;
    if (skip !== 'tiers' && S.tiers.size && !S.tiers.has(ownTier(o))) return false;
    // Exact counts, not a range: the reader ticks the socket counts they want
    // and gets those. `sk` is omitted from the record entirely when an item has
    // no sockets (see nonzero() in build.py), so n() reads a socket-less item
    // as 0 -- and 0 is a chip this control does not offer, which is what makes
    // such an item fall out of every setting rather than into one.
    if (S.sockSet.size && !S.sockSet.has(n(o.sk))) return false;
    // Two independent narrowings: the toggle asks "is it in any set at all",
    // the select asks "which one". Picking a set implies the first, but they
    // are separate state so that clearing the select does not silently drop
    // the toggle the reader set.
    if (S.setOnly && !o.set) return false;
    if (S.set && o.set !== S.set) return false;
    if (S.lvlMin != null && n(o.lv) < S.lvlMin) return false;
    if (S.lvlMax != null && n(o.lv) > S.lvlMax) return false;
    if (!boundHit(o.rq, S.req)) return false;
    // "Equippable between these levels". The ceiling is the old single field
    // and an item naming no requirement passes it, which is what n() gives --
    // the 374 shown items with no `lr` at all are usable at any level. The
    // floor excludes them, and deliberately: an item that requires nothing
    // requires nothing *of* level 20 either, so it is not one of the items a
    // level 20 character has just grown into.
    if (S.plrMin != null && n(o.lr) < S.plrMin) return false;
    if (S.plrMax != null && n(o.lr) > S.plrMax) return false;
    // A class gate is a restriction rather than a property, so the four boxes
    // are asymmetric on purpose: an item that names no class is usable by all
    // four and survives every selection. 767 items are restricted, and the
    // other 5,281 fail no class test.
    if (S.cls.size && o.cls && !S.cls.has(o.cls)) return false;
    if (!typeHit(o.dmg, S.dmgv) || !typeHit(o.arm, S.armv)) return false;
    if (S.aff.length && !affHit(o)) return false;
    return true;
  }

  // A stat requirement against a bound pair: the item's own value for that stat
  // has to land inside the filter's bounds, either of which may be open.
  //
  // Unlike typeHit a missing value is a real 0 and not "the item does not have
  // it" -- n() reads an item that names no strength as requiring none, so a
  // floor of 1 is the way to find the items that *do* gate on it, and a ceiling
  // of 20 keeps the 5,000-odd items that ask for nothing. Neither end is a
  // dropped clause; both are answers to "how much strength does this want".
  //
  // An absent pair is not iterated at all, which is why "no rows" needs no
  // guard: the collector only stores a key whose pair has a bound in it.
  function boundHit(map, want) {
    for (var k in want) {
      var b = want[k], v = n(map && map[k]);
      if (b[0] != null && v < b[0]) return false;
      if (b[1] != null && v > b[1]) return false;
    }
    return true;
  }

  // One damage or armor type's bounds. Range against range, overlapping rather
  // than containing -- neither end has to be nominated as the real one, and it
  // is the same rule an affix row uses. A type named with no bound is a
  // *presence* test and never a dropped clause: `#dmgv=fire` asks "deals fire",
  // and a URL that looks like a filter while showing the whole corpus is the
  // one outcome this page keeps designing against. A for-in over an empty
  // object is a no-op, so "no rows" needs no guard of its own.
  function typeHit(map, want) {
    for (var t in want) {
      if (!map || !map[t]) return false;         // the item does not have it
      var e = ends(map[t]), b = want[t];
      if (b[0] != null && e[1] < b[0]) return false;
      if (b[1] != null && e[0] > b[1]) return false;
    }
    return true;
  }

  // o.af is the build's own index: [statId], [statId, v] or [statId, lo, hi] per
  // effect line, in the card's own line order, with its length already asserted
  // against `fx` + `aug` at build time. o.sf is the same shape for the item's
  // set ladder, reachable rungs only.
  function pairOK(p, c) {
    if (c.lo == null && c.hi == null) return true;   // "has this stat"
    if (p.length < 2) return false;                  // the line carries no value
    var lo = p[1], hi = p.length > 2 ? p[2] : p[1];
    return (c.lo == null || hi >= c.lo) && (c.hi == null || lo <= c.hi);
  }
  function poolHit(pool, c) {
    for (var j = 0; pool && j < pool.length; j++) {
      if (pool[j][0] !== c.stat) continue;
      if (pairOK(pool[j], c)) return true;
    }
    return false;
  }
  // `setfx` widens the pool rather than adding a clause: a set bonus is not a
  // second thing to match, it is the other place this item's stats can come
  // from. Off by default, which is why `x-mana-stolen` matches nothing at all
  // until it is ticked -- those two stats exist only on ladders.
  function affHit(o) {
    for (var i = 0; i < S.aff.length; i++) {
      var c = S.aff[i];
      if (!poolHit(o.af, c) && !(S.setfx && poolHit(o.sf, c))) return false;
    }
    return true;
  }

  // The vocabulary as a lookup, by slug and by label -- the two things the
  // picker can hand back. Built once; a label is what the datalist offers and a
  // slug is what a hand-written hash carries, and both have to resolve.
  var AFFLOOK = (function () {
    var m = Object.create(null);
    for (var i = 0; i < AFF.length; i++) {
      m[AFF[i][0]] = i;
      m[AFF[i][1].toLowerCase()] = i;
    }
    return m;
  })();
  // A row's text may be a slug, a label, or neither. -1 means the vocabulary has
  // no such stat; no effect line carries id -1, so the row can never be
  // satisfied. Filtering to nothing *and showing the row that did it* beats
  // dropping the clause, which would leave a URL that looks like a filter and
  // quietly shows everything.
  function affLookup(text) {
    var t = String(text == null ? '' : text).trim().toLowerCase();
    if (t in AFFLOOK) return AFFLOOK[t];
    var s = slugify(t);
    return (s in AFFLOOK) ? AFFLOOK[s] : -1;
  }

  function filtered() {
    var out = [];
    for (var i = 0; i < ITEMS.length; i++) if (matches(ITEMS[i])) out.push(ITEMS[i]);
    return sortItems(out);
  }

  function sortItems(a) {
    var s = S.sort, d = S.dir;
    a.sort(function (x, y) {
      var r;
      if (s === 'level') r = n(x.lv) - n(y.lv);
      else if (s === 'type') r = x.t.localeCompare(y.t) || x.n.localeCompare(y.n);
      // Tier first, then item level within it. `n` coalesces a missing level to
      // 0, which is right: an item with no level is a level-1 drop, not a
      // wildcard. The name compare only breaks ties the two keys leave, so
      // equal items hold a stable order instead of whatever the array had.
      else if (s === 'tier') r = (TIERRANK[ownTier(x)] - TIERRANK[ownTier(y)]) ||
        (n(x.lv) - n(y.lv)) || x.n.localeCompare(y.n);
      else if (s === 'damage') r = (x.dmg ? total(x.dmg) : -1) - (y.dmg ? total(y.dmg) : -1);
      else if (s === 'armor') r = (x.arm ? total(x.arm) : -1) - (y.arm ? total(y.arm) : -1);
      else r = x.n.localeCompare(y.n) || x.id.localeCompare(y.id);
      return r * d;
    });
    return a;
  }

  // -------------------------------------------------------------- rail (UI)
  var SEC = {};                      // collapsed state per rail section
  var FACETDEF = [
    { k: 'types', title: 'Type', get: function (o) { return [o.t]; } },
    // ownTier, not q: a set item is really Rare or Unique, and the facet files
    // it there so the strip carries four rarities rather than a fifth that is
    // not one. `uq` is the DAT's displaced rarity, which build.py emits only on
    // set items, so this is identity on every other item.
    { k: 'tiers', title: 'Tier', get: function (o) { return [ownTier(o)]; } }
  ];

  function facetValues(key) {
    var def = null, i;
    for (i = 0; i < FACETDEF.length; i++) if (FACETDEF[i].k === key) def = FACETDEF[i];
    var counts = Object.create(null), total = 0;
    for (i = 0; i < ITEMS.length; i++) {
      if (!matches(ITEMS[i], key)) continue;
      total++;
      var vals = def.get(ITEMS[i]);
      for (var j = 0; j < vals.length; j++) counts[vals[j]] = (counts[vals[j]] || 0) + 1;
    }
    var arr = Object.keys(counts).map(function (v) { return [v, counts[v]]; });
    // tiers read best in game order; everything else by weight
    if (key === 'tiers') {
      arr.sort(function (a, b) { return TIERORDER.indexOf(a[0]) - TIERORDER.indexOf(b[0]); });
    } else {
      arr.sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); });
    }
    return { arr: arr, total: total };
  }

  function section(key, title, body, count) {
    var open = SEC[key] !== false;
    return '<div class="sec' + (open ? '' : ' closed') + '" data-sec="' + key + '">' +
      '<div class="sec-h"><span class="tog">' + (open ? '−' : '+') + '</span>' +
      '<span>' + esc(title) + '</span>' +
      (count != null ? '<span class="n">' + count + '</span>' : '') + '</div>' +
      '<div class="sec-b">' + body + '</div></div>';
  }

  function checkRow(key, val, label, cls) {
    var sel = S[key];
    var on = sel.has(val);
    return '<label class="f' + (cls ? ' ' + cls : '') + (on ? '' : ' off') + '">' +
      '<input type="checkbox" data-f="' + key + '" value="' + esc(val) + '"' +
      (on ? ' checked' : '') + '>' +
      '<span class="lbl">' + esc(label) + '</span>' +
      '<span class="ct" data-ct="' + key + '|' + esc(val) + '"></span></label>';
  }

  // A category header. It is deliberately NOT a checkRow: it owns no facet value
  // and no checkbox, and paintCounts applies `.off` to a [data-ct] span's
  // parentNode and then looks for an input inside it -- a header carrying
  // data-ct would be treated as the facet named by its key and throw.
  // data-grp is the path ("Weapons", "Weapons/One-Handed"); the class is the
  // level, which is what the count-walk in paintCounts keys off. The subgroup
  // class is `sgrp`, not `sub`: `.card .sub` is the card's type line, and a
  // bare `.sub` rule would leak the rail header's uppercase onto every card.
  //
  // The four top-level categories fold, so they carry the same minus the section
  // headers do. A subgroup does not -- its header has one action, the bulk
  // toggle -- but it still emits the span, empty: both levels then put their
  // label in the same slot, which is what keeps the rail's indent ladder
  // straight (see the `.tog` rule in app.css for the arithmetic).
  function groupRow(g, sub) {
    var path = sub ? g + '/' + sub : g;
    var closed = !sub && GRP[path] === true;
    return '<div class="' + (sub ? 'sgrp' : 'grp') + '" data-grp="' + esc(path) + '">' +
      '<span class="tog">' + (sub ? '' : closed ? '+' : '−') + '</span>' +
      '<span class="lbl">' + esc(sub || g) + '</span>' +
      '<span class="ct"></span></div>';
  }

  // Folded categories, by data-grp path -- `SEC` below does the same job for the
  // sections. Two lists rather than one because they fold different things: a
  // section hides its whole body in CSS, a category hides the rows that follow
  // it in the flat rail, which has to be done to the DOM.
  var GRP = Object.create(null);

  // A rebuild renders every row, so a fold has to be re-applied after it: the
  // markup carries the glyph, never the hiding. One walk from the header, down
  // to the next *category* -- so folding Weapons takes its subgroups and their
  // rows with it, which is the only pair of levels this has to handle.
  function foldGroup(h) {
    var closed = GRP[h.getAttribute('data-grp')] === true;
    h.querySelector('.tog').textContent = closed ? '+' : '−';
    for (var el = h.nextElementSibling; el && !el.classList.contains('grp');
         el = el.nextElementSibling) {
      el.hidden = closed;
    }
  }

  // The Type section is the only grouped facet: category -> [subgroup] -> type.
  // Types render in TAXONOMY's declared order, not facetValues' count order --
  // the curated order is the point, and it should not reshuffle as counts move.
  function typesBody() {
    var fv = facetValues('types');
    var seen = Object.create(null);
    fv.arr.forEach(function (p) { seen[p[0]] = 1; });
    var placed = Object.create(null), h = '', lastG = null;
    TAXONOMY.forEach(function (e) {
      if (e.g !== lastG) { h += groupRow(e.g, null); lastG = e.g; }
      if (e.s) h += groupRow(e.g, e.s);
      var cls = e.s ? 's1' : 's0';
      e.t.forEach(function (t) {
        if (!seen[t]) return;          // a type the corpus does not carry
        placed[t] = 1;
        h += checkRow('types', t, t, cls);
      });
    });
    // Belt and braces: build.py asserts every emitted type is in TYPE_GROUPS,
    // but the rail losing a slot silently is the one failure this could hide,
    // so anything unnamed still renders rather than disappearing.
    var rest = fv.arr.filter(function (p) { return !placed[p[0]]; });
    if (rest.length) {
      h += groupRow('Other', null);
      rest.forEach(function (p) { h += checkRow('types', p[0], p[0], 's0'); });
    }
    return h;
  }

  // The tier facet renders as the strip above the grid, not as a rail section:
  // it is the one filter that pairs with the default sort, so it sits next to
  // the results it orders instead of behind the rail. FACETDEF keeps its entry
  // -- matches(), facetValues(), sig() and writeHash() all key off it -- and
  // only the rail's own loop skips it.
  function renderTiers() {
    var h = facetValues('tiers').arr.map(function (p) {
      var on = S.tiers.has(p[0]);
      return '<label class="tpill ' + tierInk(p[0]) + (on ? '' : ' off') + '">' +
        '<input type="checkbox" data-f="tiers" value="' + esc(p[0]) + '"' +
        (on ? ' checked' : '') + '>' +
        '<span class="lbl">' + esc(p[0]) + '</span>' +
        // left empty on purpose: paintCounts fills every [data-ct] span, and a
        // figure written here would flash and then be overwritten
        '<span class="ct" data-ct="tiers|' + esc(p[0]) + '"></span></label>';
    }).join('');
    document.getElementById('tiers').innerHTML = h;
    paintCounts();
  }

  // Set membership is not a rarity -- every one of the 556 set items is really
  // Rare or Unique, and the tier facet files it there (see FACETDEF). What is
  // left is a filter *over* those rarities: "only set items" narrows to the
  // pieces belonging to any set, and the select narrows further to one named
  // set. Both live in the toolbar, next to each other, because picking a set
  // from the list is how you would reach for the toggle.
  var SETCOUNT = 0;
  function renderSetCtl() {
    if (!SETCOUNT) for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].set) SETCOUNT++;
    var sets = Object.create(null);
    ITEMS.forEach(function (o) { if (o.set) sets[o.set] = (sets[o.set] || 0) + 1; });
    var opts = '<option value="">any set</option>' + Object.keys(sets).sort().map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + ' (' + sets[s] + ')</option>';
    }).join('');
    var sel = document.getElementById('setsel');
    // Rebuilt only when the option list itself would differ: rewriting the
    // options on every route change would drop a selection mid-navigation.
    if (sel.getAttribute('data-n') !== String(SETCOUNT)) {
      sel.innerHTML = opts;
      sel.setAttribute('data-n', String(SETCOUNT));
    }
    sel.value = S.set;
    var btn = document.getElementById('onlyset');
    btn.classList.toggle('on', !!S.setOnly);
    btn.setAttribute('aria-pressed', S.setOnly ? 'true' : 'false');
    btn.innerHTML = 'Only Sets <span class="ct">' + SETCOUNT + '</span>';
  }

  // The rail is the type facet and nothing else. Every other filter it carried
  // -- damage, item level, the stat caps, sockets -- is in the advanced panel
  // now, and the rail's own argument for a filter living in one place applies
  // to itself: two controls for one narrowing is how a grid ends up empty with
  // nothing on screen to explain why. What is left is the one facet worth
  // having in front of you at all times, because it is a browse rather than a
  // search -- you pick "Axes" the way you pick a shelf, not a number.
  //
  // The `tiers` skip is the same one it always was: the tier strip above the
  // grid is that facet's control, and renderTiers() owns it.
  //
  // The facet's own `section()` wrapper went next, and for the same reason: a
  // superheader is worth a row of the reader's attention when it separates one
  // filter from another, and there is no second filter to separate it from. Its
  // "Type" caption said what the four category headers under it already say, so
  // the body's rows hang off #railbody directly. section() itself stays -- the
  // advanced panel is built from it, and so is the fold handler that reads
  // data-sec.
  function renderRail() {
    var rb = document.getElementById('railbody');
    rb.innerHTML = typesBody();
    // Every rebuild renders all four categories open, so the ones the user has
    // folded are re-folded here. The markup already wrote their `+`, so this is
    // only about the rows.
    var hs = rb.querySelectorAll('.grp');
    for (var i = 0; i < hs.length; i++) foldGroup(hs[i]);
    paintCounts();
  }

  // Counts are written into the rendered rows rather than into the HTML string,
  // so a checkbox click only touches text nodes and never rebuilds the rail.
  function paintCounts() {
    var cache = {};
    FACETDEF.forEach(function (f) { cache[f.k] = facetValues(f.k).arr; });
    var spans = document.querySelectorAll('[data-ct]');
    for (var i = 0; i < spans.length; i++) {
      var parts = spans[i].getAttribute('data-ct').split('|');
      var list = cache[parts[0]], v = parts[1], hit = 0, j;
      for (j = 0; j < list.length; j++) if (list[j][0] === v) { hit = list[j][1]; break; }
      spans[i].textContent = hit;
      var row = spans[i].parentNode;
      if (hit) row.classList.remove('off'); else row.classList.add('off');
      var box = row.querySelector('input');
      if (box && !box.checked) row.classList.add('off');
    }
    paintGroups();
  }

  // The rows under a group are disjoint (an item has exactly one type), so
  // summing the rendered child counts gives the group's own count *and* the
  // number of items its filter would match -- the two cannot differ, and
  // check_page.js asserts the identity rather than trusting it.
  //
  // Summing from the DOM rather than a parallel table is what lets the "Other"
  // bucket work: it exists only when the taxonomy misses a type, so it has no
  // entry to look up. The walk goes to the next header of the same level --
  // a group header therefore covers its subgroups' rows, a subgroup header
  // stops at the next header of any level.
  function paintGroups() {
    var hs = document.querySelectorAll('#railbody [data-grp]'), i, j, k;
    for (i = 0; i < hs.length; i++) {
      var hdr = hs[i], isSub = hdr.classList.contains('sgrp');
      var total = 0, boxes = 0, on = 0, el = hdr.nextElementSibling;
      while (el) {
        if (el.classList.contains('grp')) break;
        if (isSub && el.classList.contains('sgrp')) break;
        if (el.classList.contains('f')) {
          var ct = el.querySelector('.ct');
          total += ct ? (+ct.textContent || 0) : 0;
          var box = el.querySelector('input');
          if (box) { boxes++; if (box.checked) on++; }
        }
        el = el.nextElementSibling;
      }
      hdr.querySelector('.ct').textContent = total;
      if (!total) hdr.classList.add('off'); else hdr.classList.remove('off');
      // Tri-state: with no marker a group reads the same whether it owns the
      // whole filter or none of it, and the header is the only thing that says
      // what a click will do.
      hdr.classList.remove('on', 'part');
      if (boxes && on === boxes) hdr.classList.add('on');
      else if (on) hdr.classList.add('part');
    }
  }

  // ------------------------------------------------------------- grid render
  var memo = Object.create(null);

  function cardHTML(o) {
    var h = memo[o.id];
    if (h) return h;
    var st = statRow(o);
    var sub = esc(o.t) + (n(o.lv) ? ' · Lv ' + n(o.lv) : '') +
      (o.set ? ' · ' + esc(o.set) : '');
    h = '<a class="card ' + (TIERCLS[ownTier(o)] || 'q-unclassified') + '" data-id="' + esc(o.id) + '">' +
      '<span class="art">' + iconHTML(o) + '</span>' +
      '<span class="meta"><span class="nm">' + esc(o.n) + '</span>' +
      '<span class="sub">' + sub + '</span>' +
      (st ? '<span class="st">' + st + '</span>' : '') +
      '</span></a>';
    memo[o.id] = h;
    return h;
  }

  var lastList = [];
  var lastSig = null;

  // A cheap fingerprint of everything the URL carries. Routing compares it so a
  // hashchange that merely echoes state we already painted is a no-op -- which
  // matters because on file:// writeHash falls back to setting location.hash
  // and that itself fires hashchange.
  function sig() {
    // Array.from, not [].slice.call -- a Set has no .length, so slice() on one
    // silently yields [] and every facet would look unchanged.
    var s = function (set) { return Array.from(set).sort(); };
    return JSON.stringify([S.q, s(S.types), s(S.tiers),
      S.set, S.setOnly, s(S.sockSet), S.lvlMin, S.lvlMax, S.sort, S.dir, S.item,
      typeSig(S.req),
      S.plrMin, S.plrMax, s(S.cls), typeSig(S.dmgv), typeSig(S.armv), S.setfx,
      S.aff.map(function (c) { return [c.stat, c.lo, c.hi]; })]);
  }

  // A bound map's fingerprint, sorted. JSON.stringify keeps insertion order, so
  // without this `#dmgv=physical:,fire:` and `#dmgv=fire:,physical:` would look
  // like two different selections to the route check -- and writeHash sorts for
  // exactly that reason. Affix rows are deliberately *not* sorted: their order
  // is the reader's, it is visible in the dialog, and two rows naming the same
  // stat are legal.
  function typeSig(m) {
    var out = [];
    for (var t in m) out.push([t, m[t][0], m[t][1]]);
    return out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
  }

  function render() {
    var list = filtered();
    lastList = list;
    var shown = showAll ? list : list.slice(0, CAP);

    document.getElementById('count').innerHTML =
      '<b>' + list.length.toLocaleString() + '</b> item' + (list.length === 1 ? '' : 's') +
      (list.length !== ITEMS.length ? ' of ' + ITEMS.length.toLocaleString() : '');

    var grid = document.getElementById('grid');
    if (!list.length) {
      grid.innerHTML = '';
      document.getElementById('more').innerHTML =
        '<div class="msg">Nothing matches those filters.</div>';
      return;
    }
    // one string, one innerHTML -- not a node per item
    var buf = new Array(shown.length);
    for (var i = 0; i < shown.length; i++) buf[i] = cardHTML(shown[i]);
    grid.innerHTML = buf.join('');

    var more = document.getElementById('more');
    if (!showAll && list.length > CAP) {
      more.innerHTML = 'Showing the first ' + CAP + ' of ' + list.length.toLocaleString() +
        ' — refine to narrow.' +
        '<button id="showall">Show all ' + list.length.toLocaleString() + '</button>';
    } else if (showAll && list.length > CAP) {
      more.innerHTML = 'Showing all ' + list.length.toLocaleString() + '.' +
        '<button id="cap">Back to first ' + CAP + '</button>';
    } else {
      more.innerHTML = '';
    }
  }

  // ------------------------------------------------------------ detail view
  //
  // The tooltip card, ported from test/card_mockups/mock.tpl.html, where it was
  // settled against ten specimens. Four things are worth knowing before reading
  // it, because each one is a deliberate departure from the row layout it
  // replaced:
  //
  //   * A value leads and its label follows -- "169 <mark> Physical Damage" --
  //     which is the order the game's own tooltip lays out (value widget, image
  //     widget, label: see EQUIPMENT_ROLLOVER.LAYOUT under MEDIA/UI/PIECES/). It
  //     also keeps the numbers in a column down the card.
  //   * Sections are parted by a rule rather than by a heading, and a section
  //     that renders nothing takes its rule with it -- see `sec` in tooltip().
  //   * The requirement chips make the either/or structural: the level chip and
  //     the attribute chips are two groups with the word between them, rather
  //     than a rule drawn across the card.
  //   * The tier word in the type line wears the `.t-*` classes, not the `.q-*`
  //     ones -- those colour a descendant `.nm` and rule a card's left edge, and
  //     a type line is neither.
  //
  // `esc`, `n`, `cap`, `ownTier`, `tierInk`, `speedBand` and `iconHTML` are the
  // app's own and are reused rather than ported; the mockup carried twins of all
  // six because it could not reach this file.

  function tcls(o) { return tierInk(ownTier(o)); }

  // The rarity tile: grimtools' one genuinely good idea, and the reason its
  // cards read as "an item" rather than "a row". Border and glow both take the
  // item's own colour, so the tier lands before a word is read.
  function tile(o) {
    return '<span class="tile ' + tcls(o) + '">' + iconHTML(o) + '</span>';
  }

  // "<rarity> <type>", and on a set piece the Set tag it really belongs to --
  // "Unique Set Belt" -- because Set is a membership the DAT asserts rather than
  // a rarity, and the game paints such an item in its real one.
  function typeLine(o) {
    return '<em class="' + tcls(o) + '">' + esc(ownTier(o)) + '</em> ' +
      (o.uq ? esc(o.q) + ' ' : '') + esc(o.t) +
      // The badge is the app's own, not the mockup's, and it is the honesty
      // marker on the 19 items whose numbers are raw pre-scale .DAT scalars.
      (o.vb ? '<span class="tag">base values, not rendered</span>' : '');
  }

  // The element mark that sits between a damage value and its word. Offsets come
  // from the strip build.py inlines, one tile per entry in DMG_TYPES.
  function elemMark(k) {
    var p = ELEM[k];
    if (p == null) return '';
    return '<i class="em" style="background-position:-' + p + 'px 0"></i>';
  }

  // Damage and armor are the same line in two words, so they are one function:
  // "169 <mark> Physical Damage", "140-174 <mark> Fire Armor".
  function statLines(vals, word) {
    if (!vals) return '';
    return DMGTYPES.filter(function (k) { return vals[k]; }).map(function (k) {
      return '<p class="ln"><b>' + esc(vals[k]) + '</b>' + elemMark(k) +
        esc(cap(k)) + ' ' + word + '</p>';
    }).join('');
  }

  // The value is what a reader scans for and it is already in the string, so
  // lifting it is emphasis rather than a claim about the stat. Sign, decimal
  // comma and percent travel with the number: splitting "+8" from "%" would
  // print one value in two colours.
  function mark(s) {
    var out = '', last = 0, m, re = /[-+]?\d+(?:[.,]\d+)?%?/g;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index)) + '<span class="n">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  // A socketable's effect lines are its two slots, and the slot is data now
  // (`fxs`), not text. TIDBI carried it as a `Weapon:` / `Armor/Trinket:`
  // prefix inside the line itself, which meant the card printed the game's own
  // label as if it were part of the effect -- and where the export lost a
  // heading, the lines after it joined the block above and were filed under the
  // wrong slot. build.py resolves the slot from the item's AFFIXES order and
  // strips the prefix, so this groups and labels rather than parsing.
  //
  // `b` is a real third case, not a fallback: an affix whose own list names both
  // slots, so the line belongs in either. It is shown once, first, because it is
  // the whole-item grant. Armor/Trinket before Weapon is poolHTML's order, so a
  // fixed ember and a rolled one read the same way round.
  var SLOT_LABEL = { a: 'Armor / Trinket', w: 'Weapon',
                     b: 'Armor / Trinket or Weapon' };
  var SLOT_ORDER = ['b', 'a', 'w'];

  function affLines(o) {
    function aff(f) { return '<p class="aff">' + mark(f) + '</p>'; }
    if (!o.fxs) return (o.fx || []).map(aff).join('');
    var order = SLOT_ORDER.slice(), out = '';
    // Any code the build has not taught this list about still renders, under
    // its own name, rather than dropping the line off the card.
    o.fxs.forEach(function (sl) { if (order.indexOf(sl) < 0) order.push(sl); });
    order.forEach(function (sl) {
      var lines = o.fx.filter(function (_, i) { return o.fxs[i] === sl; });
      if (!lines.length) return;
      out += '<p class="fxh">' + esc(SLOT_LABEL[sl] || sl) + '</p>' +
        lines.map(aff).join('');
    });
    return out;
  }

  // ---- the corner ----
  // Item level, socket count and the class gate. The gate is a hard restriction
  // on who may equip the item, so it lives here and is not repeated as a
  // requirement below -- which is what makes "Player Level" affordable in full
  // down there, without the word "Required" on every line.
  function socketWord(k) { return k + (k === 1 ? ' Socket' : ' Sockets'); }
  function corner(o) {
    var rows = [];
    if (n(o.lv)) rows.push('<span class="pill">Level ' + n(o.lv) + '</span>');
    if (n(o.sk)) rows.push('<span class="pill">' + socketWord(n(o.sk)) + '</span>');
    if (o.cls) rows.push('<span class="pill">' + esc(o.cls) + ' Only</span>');
    return rows.length ? '<div class="corner">' + rows.join('') + '</div>' : '';
  }

  // ---- the ladder ----
  // The heading states both numbers, in the two different words they need.
  // `st.c` counts the records that exist -- Mondon's 16, being two item levels of
  // seven slots plus a necklace and a ring -- and the top rung counts the pieces
  // a character wears, which is 10 because a ring fills two slots. Calling both
  // of them "pieces" is what made the old heading read as a contradiction:
  // `16 pieces (10 piece set)`. Cornerstone is the case for keeping both, since
  // it reads `7 items · 9 piece set`, which is the whole anomaly.
  //
  // A rung is dimmed against `st.cap` -- what a character can wear, computed in
  // build.py -- and not against `st.c`. The record count is always the larger of
  // the two, so the old test could only ever be too strict: it dimmed 15 rungs a
  // player can reach, Twinferno's only one among them.
  function ladder(o) {
    var st = o.setid && SETS[o.setid];
    if (!st) return '';
    var top = st.b.length ? st.b[st.b.length - 1][0] : 0;
    // The name is the way to the set: clicking it drops every filter and lands
    // on this set's own. It carries `o.set` rather than the definition's `st.n`
    // because that is the field the filter matches on -- build.py writes both
    // from the set file's DISPLAYNAME, so they are the same string, and the
    // button is the one the filter would accept.
    return '<p class="sname">Set: ' +
      '<button type="button" class="setlink" data-set="' + esc(o.set) +
      '" title="Show only this set">' + esc(o.set) + '</button>' +
      '<span class="ct">' +
      st.c + (st.c === 1 ? ' item' : ' items') + ' · ' + top + ' piece set</span></p>' +
      st.b.map(function (r) {
        var over = r[0] > st.cap;
        // A rung carrying several bonuses repeats the row, and only the first
        // of them states the piece count -- the rest are visually its
        // continuation, which is why the blank `.rn` must stay in the markup.
        return r[1].map(function (f, i) {
          return '<p class="rung' + (over ? ' over' : '') + '">' +
            (i ? '<span class="rn"></span>' : '<span class="rn">' + r[0] + '</span>') +
            '<span class="rt">' + mark(f) + '</span></p>';
        }).join('');
      }).join('');
  }

  // ---- requirements ----
  // One number, two vocabularies. The requirement is always `lr`, on the same
  // curve the whole corpus reads (src/build.py) -- but what it gates is not the
  // same thing on a socketable, so the card names it for its reader: "Player
  // Level" on the things you wear, "Required Item Level to Socket" on a
  // socketable.
  //
  // Socketables carried that second label once before, over MINLEVEL -- which is
  // the drop band and not a gate, so the card stated a requirement the game does
  // not have while hiding the one it does. The label went out with the wrong
  // number. It is back over the right one, and the number is what matters: for a
  // socketable `lr` is not a table field at all but the game's own
  // ITEM_LEVEL_REQUIREMENTS_SOCKETABLE curve, 105 points of max(1, level - 8)
  // indexed by the socketable's own level.
  //
  // The chips make the either/or structural. Requirements are alternatives, not
  // a conjunction: the game grants equip once you meet the player level OR all
  // of the stats, whichever you reach first. A reader who takes it for an "and"
  // has been told something false about the item.
  function requirements(o) {
    var req = o.rq || {}, rows = [];
    var level = n(o.lr)
      ? '<span class="rchip">' + (o.t === 'Socketable'
          ? 'Required Item Level to Socket' : 'Player Level') +
        ' <b>' + n(o.lr) + '</b></span>' : '';
    var stats = ['str', 'dex', 'mag', 'def'].filter(function (k) { return req[k]; })
      .map(function (k) {
        return '<span class="rchip">' + REQLABEL[k] + ' <b>' + esc(req[k]) + '</b></span>';
      }).join('');
    var parts = level + (level && stats ? '<span class="ror">or</span>' : '') + stats;
    if (parts) rows.push('<p class="rrow">' + parts + '</p>');
    return (rows.length ? '<p class="rhead">Requirements</p>' : '') + rows.join('');
  }

  // ---- the spawn band ----
  // MINLEVEL and MAXLEVEL bracket the item's own level -- the band it drops in,
  // not a socketing ladder. ml <= lv <= xl holds on 1,862 of the 1,955 items
  // carrying all three, and the Blood Ember ranks settle it: both fields step by
  // 14 per rank, exactly as the gem's own level does (rank 3 is lv 36, ml 28,
  // xl 46), and a maximum level for socketing something is not a thing that can
  // exist.
  //
  // It is stated in plain text rather than in chips because it is a fact about
  // where the item comes from, not a gate on the reader -- and it sits below the
  // requirements so the two level numbers never read as one block.
  //
  // Socketables were the one exception, and only because the same field was being
  // printed above as their socketing gate: one number twice under two labels.
  // With that line gone (see requirements) the band is the only thing MINLEVEL
  // means on any card, so socketables show it like everything else.
  //
  // The ceiling prints as 999 wherever the file holds a sentinel, because the
  // build collapses them (see MAX_LEVEL_CEILING in src/build.py): the files say
  // "no ceiling" four different ways -- 9999, 99999, 999999, 9999999 -- and a
  // reader should not have to recognise all four to read one idea. MINLEVEL is
  // the field that still prints as the data has it, sentinels included: 777
  // marks monster-only gear, which never drops for a player.
  function lvlRange(o) {
    var lo = n(o.ml), hi = n(o.xl), bits = [];
    if (lo) bits.push('<span class="k">Min Level</span> <b>' + lo + '</b>');
    if (hi) bits.push('<span class="k">Max Level</span> <b>' + hi + '</b>');
    return bits.length
      ? '<p class="lvlr">' + bits.join('<span class="sep"> · </span>') + '</p>' : '';
  }

  // ---- the augmented group ----
  // The one part of a card that cannot be inferred from the stats around it: a
  // conditional bonus that reads as unconditional is worse than no bonus at all.
  // Three devices, all of them the app's own -- the task as a gold chip, a dashed
  // rule stating the condition in words, and the gated stats set behind a left
  // rule so they cannot be mistaken for something the weapon already has. The
  // affixes keep the tooltip's magic green; the locked stats pointedly do not,
  // since green here means "active".
  function augHTML(a) {
    return (a.task ? '<p class="augtask"><span class="task">' + esc(a.task) + '</span></p>' : '') +
      (a.fx.length
        ? '<p class="cond">locked until the task above is complete</p>' +
          '<ul class="fx locked">' + a.fx.map(function (f) {
            return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>'
        : '');
  }

  // ---- the ember pool ----
  // A rare ember's two bonuses are rolled, not fixed: the gem carries no affix
  // of its own and the game picks one option from each list when it spawns. So
  // the block states a choice where every other block on the card states a
  // fact, and it has to do that without dressing the options as stats the item
  // has -- which is why the slot label carries the count, and why the options
  // take a plain bullet in the body colour rather than the magic green an
  // affix line gets. `a`/`w` are the two lists, already whole tooltip lines
  // from build.py; the numbers in them are this rank's, so nothing scales here.
  function poolHTML(ep) {
    function group(label, list) {
      if (!list || !list.length) return '';
      return '<p class="poolh">' + esc(label) +
        '<span class="ct">one of ' + list.length + '</span></p>' +
        '<ul class="pool">' + list.map(function (s) {
          return '<li>' + mark(s) + '</li>'; }).join('') + '</ul>';
    }
    return group('Armor / Trinket', ep.a) + group('Weapon', ep.w);
  }

  // ---- the four levels ----
  // One item file that prints four statlines: its DAT carries the "generated at
  // the level of whatever dropped it" sentinel, so Normal prints the file's own
  // level and NG+1/2/3 print higher numbers. build.py derives all four
  // (eye_values.py) and they arrive as `ng`, one array per row. This replaces
  // the flat effect block for these items rather than joining it: the Normal row
  // IS those lines, so showing both would print every effect twice.
  //
  // The 31 eyes were the whole of it until 2026-09-22; five unique socketables
  // joined them (Rift Ember, Vyrax's Heartfire, Pogg Slammer, Claptrap's Bolt
  // and Nut), named in build.py's NG_SOCKETABLES because nothing in the files
  // marks them apart.
  //
  // The columns are the two slots the flat block labelled as headings -- which
  // is why the table needs no heading of its own -- plus the level, its
  // requirement and which replay the row belongs to.
  //
  // The two level columns are spelled out in full because this table is the
  // only place on the card a level is stated. "Lv" and "Req" were the short
  // forms back when a Requirements block below said "Required Item Level to
  // Socket 7" in full and the header could lean on it; that block is gone (see
  // `requirements` at the foot of the card), so the header carries the whole
  // phrase and no longer abbreviates. Req Item Lv to Socket is the game's own
  // ITEM_LEVEL_REQUIREMENTS_SOCKETABLE, so it moves with the row.
  //
  // Every one of the 36 gets four rows -- Normal plus the three replays. The
  // Eye of Tiamat's MAXLEVEL reads 999 where the other 30 eyes read the
  // 9999999 sentinel, and that is *not* a ceiling: 999 is this corpus's other
  // spelling of the same sentinel and sits above every reachable level, so
  // Tiamat scales like the rest. It was given a single row once, on the
  // opposite reading, and that was wrong. Neither is a low MAXLEVEL a ceiling,
  // which Rift Ember shows: its 75 is below NG+3's level of 100 and its page
  // carries screenshots of the same item at LV65 and LV90.
  //
  // A cell can hold more than one line: one affix can grant four elemental
  // defenses, and they belong together in one cell rather than in four rows.
  var NG_HEAD = ['Item Lv', 'Req Item Lv to Socket', 'Armor / Trinket', 'Weapon', 'NG'];

  function ngTable(o) {
    function cell(lines) {
      return lines.map(function (l) { return mark(l); }).join('<br>');
    }
    return '<table class="ngt"><thead><tr>' +
      NG_HEAD.map(function (t) { return '<th>' + esc(t) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      o.ng.map(function (r) {
        return '<tr><td class="nglv">' + esc(r[0]) + '</td>' +
          '<td class="ngrq">' + esc(r[1]) + '</td>' +
          '<td class="ngc">' + cell(r[2]) + '</td>' +
          '<td class="ngc">' + cell(r[3]) + '</td>' +
          '<td class="ngb">' + esc(r[4]) + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function flav(o) {
    return o.ds ? '<p class="flav">' + esc(o.ds.replace(/\\n/g, ' ')) + '</p>' : '';
  }

  function prov(o) {
    return '<div class="prov"><b>file</b> ' + esc(o.p) + '<br>' +
      (o.g ? '<b>guid</b> ' + esc(o.g) + '<br>' : '') +
      // Three sources, not two. A derived number is computed from the PAK by
      // this pipeline, so calling it a TIDBI value would be the same
      // misattribution the base-value wording exists to prevent -- and a base
      // value is a raw pre-scale scalar that no one has rendered at all.
      // Damage (`dv`) and armor (`da`) are derived separately -- an item can
      // have one and not the other -- but they read as the same sentence.
      '<b>numbers</b> ' + (o.vb
        ? 'PAK .DAT base value' + (o.inh ? ' (inherited from BASEFILE)' : ' (own fields)')
        : (o.dv || o.da) ? 'reconstructed from PAK game files'
        : 'TIDBI in-game value') +
      (o.ns ? '<span class="tag">name from ' + esc(o.ns) + '</span>' : '') +
      (o.ici ? '<span class="tag">icon inherited</span>' : '') +
      '<br><b>id</b> ' + esc(o.id) + '</div>';
  }

  function tooltip(o) {
    var h = '<div class="ahead">' + tile(o) + '<div class="aid">' +
      '<h3 class="an ' + tcls(o) + '">' + esc(o.n) + '</h3>' +
      '<p class="dtype">' + typeLine(o) + '</p></div>' + corner(o) + '</div>';

    // Groups are parted by a rule and the flavour text is not a group, so it
    // sits under whatever came last without one. `sec` is what keeps the rules
    // honest: a group that renders nothing takes its rule with it rather than
    // leaving a stray line on the card.
    var body = '', any = false;
    function sec(html) {
      if (!html) return;
      if (any) body += '<div class="rule"></div>';
      body += html; any = true;
    }

    // Weapons lead with their output: the headline number, the two things that
    // qualify it, then the damage it is made of.
    var lead = '';
    if (o.dps) lead += '<p class="dps">' + esc(o.dps) +
      ' <span>Damage per Second</span></p>';
    if (o.sp && speedBand(+o.sp)) {
      lead += '<p class="fspd"><b>' + speedBand(+o.sp) + '</b> attack speed <em>(' +
        esc(o.sp) + ' seconds)</em></p>';
    }
    if (n(o.rng)) lead += '<p class="frng">Weapon Range <b>' + n(o.rng) + '</b></p>';
    if (lead) { body += lead; any = true; }

    sec(statLines(o.dmg, 'Damage') + statLines(o.arm, 'Armor'));
    sec(o.ng ? ngTable(o) : (o.fx && o.fx.length ? affLines(o) : ''));
    // The rolled pair, where a socketable's own affixes would sit: the rare
    // embers have no `fx` at all, so this is the only stat block they have.
    sec(o.ep ? poolHTML(o.ep) : '');
    // The augmented group last of the stats, so the weapon's own numbers are
    // read before the ones it could grow into.
    sec(o.aug && o.aug.length ? o.aug.map(augHTML).join('') : '');
    // The whole set's ladder, on every piece of it -- a set item's most useful
    // fact is not on the item, and the game and TIDBI both print it this way.
    // Keyed on setid, not on `set`: 556 items carry a set and every one is in
    // SETS, but the two are different strings (a token against a display name)
    // and only the token is a key here.
    sec(ladder(o));
    // The level and the requirement are two columns of the table above, so a
    // Requirements block would restate them -- and on one of these items it is
    // only ever the one chip, since no socketable carries stat requirements at
    // all (0 of the 175). Every other item still gets its block.
    sec(o.ng ? '' : requirements(o));
    sec(lvlRange(o));

    h += '<div class="body">' + body + flav(o) + '</div>' + prov(o);
    return '<div class="c">' + h + '</div>';
  }

  function renderDetail(id) {
    var o = null;
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) { o = ITEMS[i]; break; }
    var d = document.getElementById('detail');
    if (!o) {
      d.innerHTML = '<div class="msg">No item called <b>' + esc(id) + '</b>.</div>';
      return;
    }
    // Everything the detail says about an item is the card's, and the card is
    // built in one string by tooltip() above. What is left here is the route:
    // find the record, say so when there is none, and keep the back link and
    // the width the card was settled at.
    d.innerHTML = '<div class="dwrap">' +
      '<a class="back" href="#">&larr; back to results</a>' +
      tooltip(o) + '</div>';
    d.scrollTop = 0;
  }

  // ------------------------------------------------------------ hash routing

  // Everything back to what the page opens on. Its own function because the set
  // link in the detail view wants the same clear as #reset: it jumps to one
  // set's filter, and arriving still narrowed by whatever happened to be on
  // would answer a different question than the one that was asked.
  function resetState() {
    S.types = new Set(); S.tiers = new Set();
    S.set = ''; S.setOnly = false; S.sockSet = new Set();
    S.lvlMin = S.lvlMax = null; S.item = '';
    S.req = {};
    S.plrMin = S.plrMax = null; S.cls = new Set(); S.dmgv = {}; S.armv = {};
    S.aff = []; S.setfx = false;
    S.q = ''; S.sort = DEFAULT_SORT; S.dir = 1;
    // The tier facet starts fully selected, unlike the rail's other facets,
    // which start empty. An empty set and a full one filter identically --
    // matches() only applies a facet when the set is non-empty -- so this
    // changes nothing about which items show. What it changes is the strip:
    // its pills carry their own state, and "nothing selected" would paint all
    // four dimmed above an unfiltered grid, which reads as a broken control
    // rather than as no filter. Populated here rather than in renderTiers so
    // that the state exists before anything renders, and before readHash's
    // early return, so #reset lands on the same four-on strip the page opens
    // with. A hash that names the facet still overrides it.
    S.tiers = new Set(allVals().tiers);
  }

  // A hash is untrusted text: it arrives from a link, a bookmark, or a reader
  // who typed it. `decodeURIComponent('50%')` throws URIError, and readHash is
  // called from onRoute(), which is the last statement of this file -- so one
  // bare `%` in the URL threw out of the whole script and the page rendered
  // *nothing*: no grid, no count, no rail. `#q=frost` and `#q=50%25` both work;
  // only the malformed spelling failed, which is exactly the one a person
  // hand-editing a link produces. Undecodable text falls back to itself, so the
  // worst case is a search for a literal "50%" that matches nothing, which is
  // legible, rather than a blank page, which is not.
  function dec(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function readHash() {
    var s = location.hash.replace(/^#/, '');
    resetState();
    if (!s || s === 'reset') return;
    s.split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = dec(i < 0 ? kv : kv.slice(0, i)),
          v = i < 0 ? '' : dec(kv.slice(i + 1));
      var list = v ? v.split(',') : [];
      // `cat=` was its own facet until the rail grouped types under category
      // headers. The old links are expanded rather than dropped, so a stale
      // bookmark still filters instead of silently doing nothing. An unknown
      // category contributes nothing, which is the old behaviour too.
      //
      // The expansion is into the group's *current* types, so an old
      // #cat=Armor now means the Armor group -- which no longer includes Belt
      // and Shield, because the taxonomy moved them. That is the intended
      // reading: one taxonomy, and the link means what the word means today.
      if (k === 'cat') list.forEach(function (c) {
        var want = LEGACY_CAT[c] || c;
        TAXONOMY.forEach(function (g) {
          if (g.g !== want) return;
          // a grouped entry lists one subgroup each, so walk every row of the
          // taxonomy that names this group rather than just the first
          g.t.forEach(function (t) { S.types.add(t); });
        });
      });
      else if (k === 'type') S.types = new Set(list);
      else if (k === 'tier') S.tiers = new Set(list);
      // `dmg=` was the rail's damage facet -- a set of types the item *has* --
      // until the panel's per-type bounds replaced it. A type named with no
      // bound is exactly that presence test (see typeHit), so the old spelling
      // expands into the new one through the same parser, and a stale bookmark
      // still asks its own question.
      else if (k === 'dmg') parseBounds(v, S.dmgv);
      else if (k === 'set') S.set = v;
      else if (k === 'setonly') S.setOnly = v === '1';
      // `sock=1` was the "Has sockets" toggle's key, and `sk=lo-hi` was the
      // count range that replaced it. Both are expanded rather than dropped,
      // the way `cat=` is above: an old bookmark should still filter instead of
      // quietly doing nothing. "Has sockets" is every chip from 1 up. Neither
      // spelling is ever written back; see writeHash.
      //
      // A range collapses to its intersection with the chip row, one rule for
      // every case. `sk=2-` is the four chips at or above 2, `sk=-4` is the four
      // at or below it, and `sk=0-` -- a floor below every chip -- is the whole
      // row, which is what "no floor" has to mean in a row that starts at 1.
      // Two of those are not the ranges they were: `sk=0-0` asked for the
      // socket-*less* items and `sk=3-2` asked for nothing, and neither answer
      // is a subset of the five chips, so both collapse to the empty selection.
      // An empty selection is no filter, which is the shipped reading of a
      // retired name that matches nothing (`#cat=Nonsense` shows the whole
      // corpus for the same reason) rather than a second, silent spelling of
      // "match nothing" that no control could ever show or clear.
      else if (k === 'sock') { if (v === '1') S.sockSet = new Set(SOCKCHIPS); }
      else if (k === 'sk') {
        if (v.indexOf('-') < 0) list.forEach(function (c) {
          c = floor0(c);
          if (SOCKCHIPS.indexOf(c) >= 0) S.sockSet.add(c);
        });
        else {
          var sp = v.split('-'), lo = floor0(sp[0]), hi = floor0(sp[1]);
          SOCKCHIPS.forEach(function (c) {
            if (lo != null && c < lo) return;
            if (hi != null && c > hi) return;
            S.sockSet.add(c);
          });
        }
      }
      else if (k === 'q') S.q = v.toLowerCase();
      else if (k === 'item') S.item = v;
      else if (k === 'sort') S.sort = v || DEFAULT_SORT;
      else if (k === 'dir') S.dir = v === 'desc' ? -1 : 1;
      else if (k === 'lvl') { var p = v.split('-'); S.lvlMin = floor0(p[0]);
                              S.lvlMax = floor0(p[1]); }
      // `req=str:50,dex:30:40`. A row is `key`, `key:hi` or `key:lo:hi`, split
      // on `:` -- the same three shapes an affix row has, and two bounds are
      // read the same way in both. One number is the *ceiling* it used to be:
      // until the panel gave these fields a floor, a single value meant "at
      // most", and reading `req=str:50` as a floor would invert every old link.
      else if (k === 'req') list.forEach(function (r) {
        var q = r.split(':');
        if (!q[0]) return;
        var b = q.length > 2 ? [num(q[1]), num(q[2])] : [null, num(q[1])];
        if (b[0] != null || b[1] != null) S.req[q[0]] = b;
      });
      // The advanced panel's keys. Every one is read with the same tolerance the
      // rail's are: an empty or unreadable bound is *no* bound, never NaN.
      //
      // `plr=50` was "equippable at level 50" -- a ceiling, which is what a lone
      // number still reads as. `plr=10-50` is the pair.
      else if (k === 'plr') {
        if (v.indexOf('-') < 0) S.plrMax = floor0(v);
        else { var pp = v.split('-'); S.plrMin = floor0(pp[0]); S.plrMax = floor0(pp[1]); }
      }
      else if (k === 'cls') list.forEach(function (c) { if (c) S.cls.add(c); });
      else if (k === 'setfx') S.setfx = v === '1';
      else if (k === 'dmgv') parseBounds(v, S.dmgv);
      else if (k === 'armv') parseBounds(v, S.armv);
      // A row's three parts are `slug`, `slug:lo` or `slug:lo:hi` -- split on
      // `:`, so a negative bound needs no escaping and `x-health:-4:5` reads
      // the way it looks. An empty side is an open bound. Row order is kept,
      // because the dialog shows the rows in this order.
      else if (k === 'aff') list.forEach(function (r) {
        var q = r.split(':');
        if (!q[0]) return;
        S.aff.push({ text: q[0], stat: affLookup(q[0]),
                     lo: num(q[1]), hi: num(q[2]) });
      });
    });
  }

  // `fire:10:20,physical` -> {fire: [10, 20], physical: [null, null]}. A type
  // named with no bound is a presence test, which is why its entry exists at
  // all rather than being skipped -- `typeHit` reads a null pair as "has it".
  function parseBounds(v, into) {
    if (!v) return;
    v.split(',').forEach(function (r) {
      var q = r.split(':');
      if (!q[0]) return;
      into[q[0]] = [num(q[1]), num(q[2])];
    });
  }

  // parseBounds' inverse, and written beside it so the two spellings stay one
  // spelling. An absent bound is an empty field, so a presence test -- which a
  // URL can carry and the panel cannot -- round-trips as `physical::` instead
  // of being flattened into "no bound" on the way out. Order is DMGTYPES'
  // first, then any type this page does not name, sorted: a filter's URL must
  // not depend on which box the reader happened to fill in first.
  function boundsStr(m) {
    var keys = DMGTYPES.filter(function (t) { return t in m; });
    Object.keys(m).sort().forEach(function (t) {
      if (keys.indexOf(t) < 0) keys.push(t);
    });
    return keys.map(function (t) {
      var b = m[t];
      return t + ':' + (b[0] == null ? '' : b[0]) + ':' + (b[1] == null ? '' : b[1]);
    }).join(',');
  }

  // Every distinct value each facet can take, computed once. Used to elide a
  // facet from the URL when all of its boxes are on -- a fully-checked facet
  // filters nothing, so carrying it would just lengthen the hash.
  var ALLVALS = null;
  function allVals() {
    if (!ALLVALS) {
      ALLVALS = {};
      FACETDEF.forEach(function (f) { ALLVALS[f.k] = new Set(); });
      ITEMS.forEach(function (o) {
        FACETDEF.forEach(function (f) {
          f.get(o).forEach(function (v) { ALLVALS[f.k].add(v); });
        });
      });
    }
    return ALLVALS;
  }

  function writeHash() {
    var p = [], all = allVals();
    FACETDEF.forEach(function (f) {
      var sel = S[f.k];
      if (sel.size && sel.size < all[f.k].size) {
        // sorted: Set order is insertion order, and an unstable URL would make
        // the same selection look like a different one to the route signature
        p.push(f.k.replace(/s$/, '') + '=' +
               encodeURIComponent(Array.from(sel).sort().join(',')));
      }
    });
    if (S.set) p.push('set=' + encodeURIComponent(S.set));
    if (S.setOnly) p.push('setonly=1');
    // Ascending, so the URL does not depend on which chip was ticked first.
    // SOCKCHIPS order rather than the Set's, which is insertion order.
    if (S.sockSet.size)
      p.push('sk=' + SOCKCHIPS.filter(function (c) { return S.sockSet.has(c); }).join(','));
    if (S.lvlMin != null || S.lvlMax != null)
      p.push('lvl=' + (S.lvlMin == null ? '' : S.lvlMin) + '-' + (S.lvlMax == null ? '' : S.lvlMax));
    // In the four stats' own order, and each row as `key:lo:hi` with an open
    // side left blank -- the spelling `req=str::50` reads as the old ceiling
    // and round-trips through the same parser. Only a row with a bound in it is
    // carried, which is the same rule dmgv and armv follow.
    var rq = ['str', 'dex', 'mag', 'def'].filter(function (k) { return S.req[k]; })
      .map(function (k) {
        var b = S.req[k];
        return k + ':' + (b[0] == null ? '' : b[0]) + ':' + (b[1] == null ? '' : b[1]);
      });
    if (rq.length) p.push('req=' + rq.join(','));
    if (S.plrMin != null || S.plrMax != null)
      p.push('plr=' + (S.plrMin == null ? '' : S.plrMin) + '-' + (S.plrMax == null ? '' : S.plrMax));
    // Elided when all four are on, for the same reason a facet is elided when
    // all of its boxes are: no item fails a test every class passes. `all`
    // order first, so the URL is stable whatever order the boxes were ticked.
    if (S.cls.size && S.cls.size < ALLCLASSES.length)
      p.push('cls=' + encodeURIComponent(Array.from(S.cls).sort().join(',')));
    if (S.setfx) p.push('setfx=1');
    var dv = boundsStr(S.dmgv), av = boundsStr(S.armv);
    if (dv) p.push('dmgv=' + dv);
    if (av) p.push('armv=' + av);
    // Rows in the reader's own order, and never sorted: two rows may name the
    // same stat with different bounds, and reordering them would make a URL the
    // reader did not write.
    //
    // A known stat is written as its slug. The panel hands back whatever the
    // reader typed -- a label off the datalist, most of the time -- and a label
    // carries spaces and `%` that would arrive percent-encoded and unreadable.
    // The slug is the vocabulary's own spelling and needs no encoding; the two
    // resolve to the same row on the way back in, so nothing is lost. A row the
    // vocabulary does *not* know has no slug, so it is written back verbatim:
    // it still filters, so it still belongs in the URL.
    if (S.aff.length) p.push('aff=' + S.aff.map(function (c) {
      return (c.stat >= 0 ? AFF[c.stat][0] : c.text) + ':' +
             (c.lo == null ? '' : c.lo) + ':' + (c.hi == null ? '' : c.hi);
    }).join(','));
    if (S.q) p.push('q=' + encodeURIComponent(S.q));
    if (S.sort !== DEFAULT_SORT) p.push('sort=' + S.sort);
    if (S.dir === -1) p.push('dir=desc');
    if (S.item) p.push('item=' + encodeURIComponent(S.item));
    var h = p.join('&');
    if (location.hash.replace(/^#/, '') === h) return;
    try {
      history.replaceState(null, '', '#' + h);
    } catch (e) {
      // Chrome refuses replaceState on file:// (origin 'null'), and this page is
      // meant to be opened straight off disk. Assigning the hash is same-
      // document and always allowed; it fires hashchange, which onRoute absorbs
      // via the signature check.
      location.hash = h;
    }
  }

  // -------------------------------------------------------- the advanced panel
  // The panel edits a *draft*, never S. Opening copies the fields it owns into
  // `advS`; Add and ✕ re-render from that draft; Search reads the panel back
  // into S and closes; Reset empties the draft; Escape, the ✕ and the scrim
  // throw it away. Two things fall out of that, and both are the point:
  //
  //   * S stays the single source of filter truth -- the panel does not own a
  //     second copy of anything, and opening it reads S back into the controls,
  //     so a filter set by a URL shows up in the fields that would set it.
  //   * nothing filters while the panel is open, which is the interaction that
  //     was asked for: set the filters, hit Search, see the results.
  //
  // It also sidesteps the trap the rail documents for its own inputs. A control
  // that re-renders on every keystroke cannot hold a half-typed value; a draft
  // that is read once, at commit, never has to.
  var advS = null;
  var advOn = false;
  // Which tab the Type section is showing. View state, not filter state: it
  // The four class names, read off the corpus rather than written down here: a
  // fifth would otherwise be unselectable without a code change, and `cls` is
  // the build's own field for this. Sorted, so the boxes hold still.
  var ALLCLASSES = (function () {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < ITEMS.length; i++) {
      var c = ITEMS[i].cls;
      if (c && !seen[c]) { seen[c] = 1; out.push(c); }
    }
    return out.sort();
  })();

  // The tab strip's labels: every category TAXONOMY names, in its declared
  // order, behind "All". Read off the taxonomy rather than written down, so a
  // category added to the build's groups is a tab without a code change -- the
  // same reason ALLCLASSES is read and not listed.
  var TGROUPS = (function () {
    var out = ['All'];
    TAXONOMY.forEach(function (e) { if (out.indexOf(e.g) < 0) out.push(e.g); });
    return out;
  })();

  // One `label | min | max` row. Both ends, always: every field left on this
  // panel is a range, and a row that sometimes showed one box and sometimes two
  // -- which is what `hi === undefined` used to produce for a damage type with
  // no bound yet -- reads as a different control each time the panel is opened.
  // `attr` is the draft path the boxes write to, so collecting them needs no
  // table of field names.
  function advRange(attr, label, lo, hi) {
    return '<div class="rng"><span class="rl">' + esc(label) + '</span>' +
      '<input type="number" min="0" data-a="' + attr + '" data-end="lo" value="' +
      (lo == null ? '' : lo) + '" placeholder="any">' +
      '<span>&ndash;</span>' +
      '<input type="number" min="0" data-a="' + attr + '" data-end="hi" value="' +
      (hi == null ? '' : hi) + '" placeholder="any"></div>';
  }

  // A fresh draft off S. Everything is copied, not shared -- the panel mutates
  // its draft freely and a discarded draft must not have reached S on the way.
  function advCopy() {
    var d = {}, a = {}, r = {}, k;
    for (k in S.dmgv) d[k] = S.dmgv[k].slice();
    for (k in S.armv) a[k] = S.armv[k].slice();
    for (k in S.req) r[k] = S.req[k].slice();
    return {
      q: S.q, lvlMin: S.lvlMin, lvlMax: S.lvlMax,
      plrMin: S.plrMin, plrMax: S.plrMax, req: r,
      // The two allow-list rows read an empty set as "everything on". S.types
      // and S.tiers empty is no filter, and this is the control that shows that
      // state -- so a reader who opens the panel on a filtered page sees exactly
      // the types and rarities their search would return, and one who opens it
      // on a bare page sees every box ticked. The socket chips are not in this
      // category: their empty set is a filter's off state, not a full set.
      types: S.types.size ? new Set(S.types) : new Set(ALLTYPEKEYS),
      tiers: S.tiers.size ? new Set(S.tiers) : new Set(RARITYCHIPS),
      sockSet: new Set(S.sockSet),
      cls: new Set(S.cls), dmgv: d, armv: a, setfx: S.setfx,
      aff: S.aff.map(function (c) {
        return { text: c.text, stat: c.stat, lo: c.lo, hi: c.hi };
      })
    };
  }

  // Reads the panel's DOM back into the draft. Done once, at commit, rather
  // than per keystroke: the reader may hit Search straight out of a text box,
  // where no change event has fired yet, and nothing is listening to the draft
  // anyway.
  function advCollect() {
    var root = document.getElementById('advb'), i, el;
    var boxes = root.querySelectorAll('[data-a]');
    for (i = 0; i < boxes.length; i++) {
      el = boxes[i];
      var p = el.getAttribute('data-a').split('.');
      var end = el.getAttribute('data-end');
      // Lower-cased here and not at the comparison, which is where the rail's
      // own box does it (see #q's keydown): matches() indexes the name with
      // S.q as typed, so a `Fire` that reached it unfolded would match nothing.
      if (p[0] === 'q') advS.q = el.value.trim().toLowerCase();
      // floor0 throughout, because these are the same S members a URL writes: a
      // floor on one side and not the other would make one typed value mean two
      // things depending on which way it came in.
      else if (p[0] === 'lvl' || p[0] === 'plr')
        advS[p[0] + (end === 'lo' ? 'Min' : 'Max')] = floor0(el.value);
    }
    // The three bound maps -- dmgv, armv and the four stat requirements -- are
    // rebuilt rather than merged, so a row whose two boxes were both cleared
    // drops out of the filter. Two empty boxes are the only way the panel can
    // say "no constraint" -- there is no third state to confuse it with -- and
    // an empty map is what matches() reads as no filter at all.
    advS.dmgv = {}; advS.armv = {}; advS.req = {};
    for (i = 0; i < boxes.length; i++) {
      el = boxes[i];
      var q = el.getAttribute('data-a').split('.');
      if (!q[1] || (q[0] !== 'dmgv' && q[0] !== 'armv' && q[0] !== 'req')) continue;
      var b = advS[q[0]][q[1]] || [null, null];
      b[el.getAttribute('data-end') === 'lo' ? 0 : 1] = num(el.value);
      if (b[0] != null || b[1] != null) advS[q[0]][q[1]] = b;
    }
    advS.cls = new Set();
    var cls = root.querySelectorAll('[data-acls]');
    for (i = 0; i < cls.length; i++) if (cls[i].checked) advS.cls.add(cls[i].value);
    // Every type box is on screen at once, so this is a straight read of the
    // grid: ticked adds, unticked removes. No member is left as it stands,
    // because there is no longer a box the reader cannot see.
    var seen = root.querySelectorAll('[data-atype]');
    for (i = 0; i < seen.length; i++) {
      if (seen[i].checked) advS.types.add(seen[i].value);
      else advS.types.delete(seen[i].value);
    }
    // The chip's number rides in the checkbox's own `value`, which is what
    // advChips() writes it to; data-achip is only the marker naming this row.
    // (The trap the marker keeps apart from the number: a checkbox with no value
    // attribute reports the literal "on", and +"on" is NaN -- a Set of one
    // member that matches nothing and writes `sk=` as an empty list on the way
    // out.)
    advS.sockSet = new Set();
    var chips = root.querySelectorAll('[data-achip]');
    for (i = 0; i < chips.length; i++)
      if (chips[i].checked) advS.sockSet.add(+chips[i].value);
    // The rarity chips, which write the same S.tiers the strip above the grid
    // writes -- one member, two surfaces, so the two can never disagree.
    advS.tiers = new Set();
    var tchips = root.querySelectorAll('[data-atier]');
    for (i = 0; i < tchips.length; i++)
      if (tchips[i].checked) advS.tiers.add(tchips[i].value);
    var fx = root.querySelector('[data-asetfx]');
    advS.setfx = !!(fx && fx.checked);

    // Every row is kept, blank ones included. They are dropped at commit, not
    // here: this is also what "+ Add stat" and the per-row ✕ read the panel
    // with, and a collect that discarded a blank row would make a second Add
    // throw the first one away -- the reader clicks Add and nothing appears.
    advS.aff = [];
    var rows = root.querySelectorAll('[data-arow]');
    for (i = 0; i < rows.length; i++) {
      var row = rows[i], txt = row.querySelector('[data-aaff]').value.trim();
      var stat = affLookup(txt);
      var lo = num(row.querySelector('[data-afend="lo"]').value);
      var hi = num(row.querySelector('[data-afend="hi"]').value);
      // A value-less stat cannot carry a range: pairOK rejects every pair whose
      // condition has a bound and whose line holds no number, so leaving the
      // two boxes live would give a row that displays bounds and matches
      // nothing. Cleared here and not only on the label's change event, because
      // Enter in the text box commits *before* change fires.
      if (!(stat >= 0 && AFF[stat][2])) { lo = null; hi = null; }
      advS.aff.push({ text: txt, stat: stat, lo: lo, hi: hi });
    }
    return advS;
  }

  // One collapsible group, shared by the rail and the panel so the two cannot
  // drift: SEC is one dictionary and the keys are disjoint by construction.
  function toggleSec(h) {
    var sec = h.parentNode, k = sec.getAttribute('data-sec');
    SEC[k] = SEC[k] === false;
    sec.classList.toggle('closed', SEC[k] === false);
    h.querySelector('.tog').textContent = SEC[k] === false ? '+' : '−';
  }

  // The Type section: one checkbox per type, grouped by the taxonomy under a
  // strip of group buttons.
  //
  // The strip is a *bulk toggle*, not a view. Every group's boxes are on screen
  // at once, stacked with each group's header above its rows, and a group button
  // ticks every box under that group -- or unticks them all when they are
  // already ticked. Nothing is hidden and nothing moves, so there is no state a
  // reader can lose by clicking one.
  //
  // It is built from TAXONOMY's own category names, so a fifth category is a
  // button without a code change. The boxes are all ticked when the panel opens,
  // because the panel is an allow-list: an empty S.types is no filter, and "no
  // filter" on this control is every box on. See advCopy and coverAll.
  //
  // The rows are deliberately not checkRow(): that writes data-f and data-ct,
  // and the document's change handler owns data-f while paintCounts() walks
  // every data-ct span and would throw on one outside the rail. data-atype is
  // this panel's own name for the same box.
  //
  // The boxes are the *corpus's* types, not the current answer's, which is where
  // this parts company with the rail. typesBody() builds from the filtered facet
  // counts, so a type drops out of the rail when another filter excludes it --
  // right for a browse list whose counts are beside it, and wrong for a form: a
  // checkbox that disappears because of a filter the same form set is a box the
  // reader cannot tick, so a query could never be widened from here. ALLTYPES
  // is fixed at load and does not move with S.
  var ALLTYPES = (function () {
    var seen = Object.create(null);
    for (var i = 0; i < ITEMS.length; i++) seen[ITEMS[i].t] = 1;
    return seen;
  })();
  // The same names as a list, so "every type is ticked" and "this group's boxes
  // are all ticked" are countable without walking the object each time.
  var ALLTYPEKEYS = Object.keys(ALLTYPES);

  // Every type the corpus carries that belongs to one tab group -- "All" is the
  // whole corpus, since the grid's Other block is drawn under All and belongs to
  // no category. The corpus's keys and not TAXONOMY's own lists, so a group's
  // size here matches the number of boxes the grid actually draws.
  // ALLTYPEKEYS is a fixed order, so a group's state is one pass and no sorting.
  function groupTypes(g) {
    if (g === 'All') return ALLTYPEKEYS;
    var out = [];
    TAXONOMY.forEach(function (e) {
      if (e.g !== g) return;
      e.t.forEach(function (t) { if (ALLTYPES[t]) out.push(t); });
    });
    return out;
  }

  // What a group's tab looks like: lit when every box under it is ticked, half
  // lit when some are. The half state is not decoration -- with every type on at
  // rest, a reader who unticks one armour type would otherwise see the Armor tab
  // go dark, which reads as "no armour" when it means "nearly all armour".
  function groupState(g) {
    var list = groupTypes(g), on = 0;
    for (var i = 0; i < list.length; i++) if (advS.types.has(list[i])) on++;
    return on === 0 ? '' : on === list.length ? 'on' : 'part';
  }

  function advTypes() {
    var seen = ALLTYPES;
    var placed = Object.create(null);
    var h = '<div class="ttabs">' + TGROUPS.map(function (g) {
      var st = groupState(g);
      return '<button class="ttab' + (st ? ' t2' + st : '') + '" data-atgl="' +
        esc(g) + '" title="Tick or untick every ' + esc(g.toLowerCase()) +
        ' type">' + esc(g) + '</button>';
    }).join('') + '</div>';
    var box = function (t) {
      var on = advS.types.has(t);
      return '<label class="f' + (on ? '' : ' off') + '">' +
        '<input type="checkbox" data-atype value="' + esc(t) + '"' +
        (on ? ' checked' : '') + '><span class="lbl">' + esc(t) + '</span></label>';
    };
    var rows = '', lastG = null;
    TAXONOMY.forEach(function (e) {
      if (e.g !== lastG) { rows += '<div class="tgh">' + esc(e.g) + '</div>'; lastG = e.g; }
      if (e.s) rows += '<div class="tgh s">' + esc(e.s) + '</div>';
      e.t.forEach(function (t) {
        if (!seen[t]) return;          // a type the corpus does not carry
        placed[t] = 1;
        rows += box(t);
      });
    });
    // Belt and braces, the same one the rail keeps for the same reason: build.py
    // asserts every type it emits is in TYPE_GROUPS, but losing a type silently
    // is the one failure this could hide, so anything unnamed still renders
    // rather than vanishing. `rest` walks the corpus's types rather than the
    // taxonomy, so a type the taxonomy forgot is found here rather than nowhere.
    // It belongs to no tab's group, which is why the All tab counts the corpus's
    // keys rather than the taxonomy's lists -- groupTypes says so.
    var rest = Object.keys(ALLTYPES).filter(function (t) { return !placed[t]; }).sort();
    if (rest.length) {
      rows += '<div class="tgh">Other</div>';
      rest.forEach(function (t) { rows += box(t); });
    }
    if (!rows) rows = '<div class="f off"><span class="lbl">nothing matches</span></div>';
    // The same sentence the socket row carries, and for the same reason: this is
    // an allow-list whose empty state is not "nothing" but "anything". A reader
    // who clears every box -- one click on All does it -- has to be able to read
    // what that means before they hit Search, and the answer is not guessable
    // from a dark grid.
    return h + '<div class="tgrid">' + rows + '</div>' +
      '<div class="rng"><span class="rl"></span><span>Nothing ticked means any' +
      ' type, as does everything ticked.</span></div>';
  }

  // A row of chips: one hidden checkbox each, drawn as the value alone. Used by
  // both the socket counts and the rarities, so the two rows cannot drift into
  // two different-looking controls.
  //
  // The checkbox carries its value in a `value` attribute *and* in its data
  // name. Value because a checkbox with no value attribute reports the literal
  // "on", which reads back as a chip named "on"; the data name so advCollect has
  // one spelling to query per row. `attr` is that name: achip, atier.
  //
  // The lit state is CSS (`input:checked + span`), not a class this renderer
  // writes. A class would only be right at render time -- a click toggles the
  // box and no render follows it, so the chip stayed dark while the filter it
  // carried was live. That is the bug this spelling exists to make impossible.
  function advChips(attr, list, on) {
    return '<div class="tgrid chips">' + list.map(function (c) {
      return '<label class="chip">' +
        '<input type="checkbox" data-' + attr + ' value="' + esc(c) + '"' +
        (on.has(c) ? ' checked' : '') + '>' +
        '<span>' + esc(c) + '</span></label>';
    }).join('') + '</div>';
  }

  // The rarity row, which is *not* a chip row: it is the page's own tier pill --
  // the same .tpill the strip above the grid renders, wearing the same ink class
  // tierInk() derives, so the two controls that write S.tiers are one control
  // twice over and a tier's colour cannot be right on one and wrong on the
  // other. Hence a second renderer rather than a flag on advChips: a chip is a
  // digit that wants a fixed min-width and a tabular figure, a pill is a tier's
  // name wearing that tier's colour, and one renderer bent to both would have to
  // restate .tpill's colours here, where they could drift.
  //
  // No count span either. paintCounts() fills every [data-ct] in the page and
  // would throw on one outside the rail, and a count of the *draft* is not a
  // thing the page can compute before Search -- the pills would be showing
  // figures from a search nobody has run.
  function advPills(attr, list, on) {
    return '<div class="tgrid pills">' + list.map(function (c) {
      var lit = on.has(c);
      return '<label class="tpill ' + tierInk(c) + (lit ? '' : ' off') + '">' +
        '<input type="checkbox" data-' + attr + ' value="' + esc(c) + '"' +
        (lit ? ' checked' : '') + '>' +
        '<span class="lbl">' + esc(c) + '</span></label>';
    }).join('') + '</div>';
  }

  function renderAdv() {
    var g = '<div class="rng"><span class="rl">Name</span>' +
      '<input type="text" data-a="q" value="' + esc(advS.q) +
      '" placeholder="name or id"></div>';
    g += advRange('lvl', 'Item Level', advS.lvlMin, advS.lvlMax);
    g += advRange('plr', 'Player Level', advS.plrMin, advS.plrMax);
    // A row of its own rather than a pair: the label column is the same 84px
    // the rows above use, so the chips line up under the boxes they replace.
    //
    // The hint is not padding. These chips start dark and the rarity pills below
    // start lit, because the two rows answer two different questions: sockets
    // asks "which counts do you want", so nothing ticked is any count, while
    // rarity is an allow-list whose everything-on state is no rarity filter.
    // Without the line a reader can only guess which way each row runs.
    g += '<div class="rng"><span class="rl">Sockets</span>' +
      advChips('achip', SOCKCHIPS, advS.sockSet) + '</div>';
    g += '<div class="rng"><span class="rl"></span><span>No chip ticked means' +
      ' any number of sockets.</span></div>';
    g += '<div class="rng"><span class="rl">Rarity</span>' +
      advPills('atier', RARITYCHIPS, advS.tiers) + '</div>';

    // "Stat Requirements", because that is what these four are: an item's
    // requirement is met either by its level or by its stats, and these rows
    // only ever test the stat branch. The label is the same one the detail view
    // prints, and TL2 has no "Magic" or "Defense" stat, so MAG and DEF point at
    // attributes that exist.
    var rq = '<div class="agrid">' + ['str', 'dex', 'mag', 'def'].map(function (k) {
      var b = advS.req[k] || [null, null];
      return advRange('req.' + k, REQLABEL[k], b[0], b[1]);
    }).join('') + '</div>';

    // Class is its own section, not a tail on the requirements: it is a
    // different kind of question -- a restriction the item carries rather than a
    // number it asks for -- and it reads that way.
    var cl = '<div class="agrid">' + ALLCLASSES.map(function (c) {
      var on = advS.cls.has(c);
      // No data-ct: paintCounts() writes a count into every [data-ct] span and
      // would throw on one outside the rail. No data-f either -- the document's
      // change handler owns that name and would write into S.
      return '<label class="f"><input type="checkbox" data-acls value="' + esc(c) +
        '"' + (on ? ' checked' : '') + '><span class="lbl">' + esc(c) + '</span></label>';
    }).join('') + '</div>';

    var body = section('advgen', 'General', g) +
      section('advtype', 'Type', advTypes()) +
      section('advreq', 'Stat Requirements', rq) +
      section('advcls', 'Class', cl);
    body += section('advdmg', 'Damage', DMGTYPES.map(function (t) {
      var b = advS.dmgv[t] || [null, null];
      return advRange('dmgv.' + t, cap(t), b[0], b[1]);
    }).join(''));
    body += section('advarm', 'Armor', DMGTYPES.map(function (t) {
      var b = advS.armv[t] || [null, null];
      return advRange('armv.' + t, cap(t), b[0], b[1]);
    }).join(''));

    var rows = advS.aff.map(function (c, i) {
      var known = c.stat >= 0 && AFF[c.stat];
      // A stat the vocabulary marks value-less is a presence test, so its two
      // boxes are off rather than empty-and-ignored.
      var hz = known && !AFF[c.stat][2];
      // A known stat is shown under the vocabulary's own name and not under
      // whatever the draft carries. A row that arrived in a URL carries the
      // slug -- `x-attack-speed` -- and a panel showing that would look like it
      // held a different stat from the one its own datalist offers.
      var shown = known ? AFF[c.stat][1] : c.text;
      // Flagged only when there is text to flag: a row the reader has just
      // added and not yet filled in is empty, not wrong.
      var bad = !known && c.text !== '';
      return '<div class="arow' + (bad ? ' bad' : '') + '" data-arow="' + i + '"' +
        (bad ? ' title="Not a stat this database knows. The row filters out' +
          ' everything until you pick one from the list."' : '') + '>' +
        '<input type="text" list="advstats" data-aaff="' + i + '" value="' + esc(shown) +
          '" placeholder="stat" autocomplete="off">' +
        '<input type="number" data-afend="lo" value="' + (c.lo == null ? '' : c.lo) +
          '" placeholder="any"' + (hz ? ' disabled' : '') + '>' +
        '<span>&ndash;</span>' +
        '<input type="number" data-afend="hi" value="' + (c.hi == null ? '' : c.hi) +
          '" placeholder="any"' + (hz ? ' disabled' : '') + '>' +
        '<button class="adel" data-adel="' + i + '" title="Remove this stat" ' +
          'aria-label="Remove this stat">&times;</button></div>';
    }).join('');
    var af = rows + (rows ? '' : '<div class="rng"><span class="rl"></span>' +
      '<span>No stat filters yet.</span></div>') +
      '<button class="aadd" id="advadd">+ Add stat</button>' +
      '<label class="f aset"><input type="checkbox" data-asetfx' +
        (advS.setfx ? ' checked' : '') +
        '><span class="lbl">Include set bonuses</span></label>' +
      '<div class="rng"><span class="rl"></span><span>Set-bonus lines are not' +
        ' searched unless this is ticked.</span></div>';
    body += section('advaff', 'Stats', af);

    document.getElementById('advb').innerHTML = body;
  }

  function advShow(on) {
    advOn = on;
    document.getElementById('adv').classList.toggle('on', on);
    document.getElementById('advscrim').classList.toggle('on', on);
    var b = document.getElementById('advbtn');
    b.classList.toggle('on', on);
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!on) return;
    // The rail drawer and this panel are both full-height overlays, and the
    // drawer is inside a transform at ≤768px rather than above the page -- so
    // two of them at once is not a stacking the page has. Closing it is also
    // just right: the panel covers everything the drawer would.
    document.getElementById('rail').classList.remove('floating');
    document.getElementById('railscrim').classList.remove('on');
  }

  // Reset empties the *draft*. It is a form reset, not an undo of the page's
  // filters: nothing has been applied yet, so there is nothing to take back
  // until Search. "Empty" means the panel's own resting state, which for the two
  // allow-list rows is every box ticked -- a Reset that emptied them would leave
  // the grid dark and a search that returned nothing, on a button whose promise
  // is "back to how I found you".
  function advReset() {
    advS = {
      q: '', lvlMin: null, lvlMax: null, plrMin: null, plrMax: null,
      req: {}, types: new Set(ALLTYPEKEYS), tiers: new Set(RARITYCHIPS),
      sockSet: new Set(),
      cls: new Set(), dmgv: {}, armv: {}, setfx: false, aff: []
    };
    renderAdv();
  }

  // Every type, or every rarity. The two allow-list rows are stored in their
  // short form: "all of them ticked" is no filter, which is the set S already
  // uses for it, so the panel's default costs no hash key and the URL stays the
  // one a reader would have written by hand. Normalised here, on the way into S,
  // and only here -- the draft keeps whatever the reader ticked so the boxes
  // they see while the panel is open are the boxes they clicked.
  function coverAll(set, names) {
    for (var i = 0; i < names.length; i++) if (!set.has(names[i])) return false;
    return true;
  }

  function advCommit() {
    advCollect();
    S.q = advS.q; S.lvlMin = advS.lvlMin; S.lvlMax = advS.lvlMax;
    S.plrMin = advS.plrMin; S.plrMax = advS.plrMax;
    S.sockSet = advS.sockSet;
    S.types = coverAll(advS.types, ALLTYPEKEYS) ? new Set() : advS.types;
    S.tiers = coverAll(advS.tiers, RARITYCHIPS) ? new Set() : advS.tiers;
    S.setfx = advS.setfx;
    // The draft is built fresh by advCopy() on every open and never touched
    // again after this line, so handing S its members outright shares nothing
    // that can move.
    S.req = advS.req; S.cls = advS.cls; S.dmgv = advS.dmgv; S.armv = advS.armv;
    // The blank rows a draft may be carrying are dropped here, on the way into
    // S, and only here -- see advCollect on why they are not dropped earlier.
    S.aff = advS.aff.filter(function (c) { return c.text !== ''; });
    advShow(false);
    // The text box's route, for the two reasons its comment gives.
    //
    // S.item first: apply() reaches paintGrid(), which branches on S.item and
    // renders the detail view instead of the grid -- so a panel opened over an
    // item card would close and leave the card exactly where it was.
    //
    // Then onRoute() rather than apply(): only onRoute() rebuilds the rail, and
    // the panel now writes S.types, which is the rail's one remaining facet.
    // Without it the rail would show the old tick marks beside a grid filtered
    // by the new ones.
    S.item = '';
    showAll = false;
    writeHash();
    lastSig = null;
    onRoute();
  }

  // The datalist, filled once. Labels, not slugs: the slug is what a URL
  // carries and never what a reader types.
  (function () {
    var h = '';
    for (var i = 0; i < AFF.length; i++) h += '<option value="' + esc(AFF[i][1]) + '">';
    document.getElementById('advstats').innerHTML = h;
  })();

  document.getElementById('advbtn').addEventListener('click', function () {
    if (advOn) { advShow(false); return; }
    advS = advCopy();
    renderAdv();
    advShow(true);
    var f = document.querySelector('#advb [data-a="q"]');
    if (f) f.focus();
  });
  document.getElementById('advx').addEventListener('click', function () { advShow(false); });
  document.getElementById('advscrim').addEventListener('click', function () { advShow(false); });
  document.getElementById('advrst').addEventListener('click', advReset);
  document.getElementById('advgo').addEventListener('click', advCommit);

  document.getElementById('adv').addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'advadd') {
      advCollect();
      advS.aff.push({ text: '', stat: -1, lo: null, hi: null });
      renderAdv();
      var rows = document.querySelectorAll('#advb [data-aaff]');
      if (rows.length) rows[rows.length - 1].focus();
      return;
    }
    var del = t.getAttribute && t.getAttribute('data-adel');
    if (del != null) {
      advCollect();          // read the other rows before this one renumbers them
      advS.aff.splice(+del, 1);
      renderAdv();
      return;
    }
    var gl = t.getAttribute && t.getAttribute('data-atgl');
    if (gl != null) {
      // Collected first: a box the reader ticked a moment ago has not reached the
      // draft yet, and it decides whether this group counts as already-ticked.
      advCollect();
      var list = groupTypes(gl);
      var all = true;
      for (var i = 0; i < list.length; i++)
        if (!advS.types.has(list[i])) { all = false; break; }
      for (var j = 0; j < list.length; j++) {
        if (all) advS.types.delete(list[j]); else advS.types.add(list[j]);
      }
      renderAdv();
      return;
    }
    var h = t.closest ? t.closest('.sec-h') : null;
    if (h) toggleSec(h);
  });

  // A stat's name decides whether its bounds mean anything, so the row is
  // redrawn the moment the name settles. change fires on blur or Enter, never
  // per keystroke, so this cannot fight the caret.
  document.getElementById('adv').addEventListener('change', function (e) {
    var t = e.target;
    if (!t.getAttribute) return;
    // A rarity pill dims itself here rather than in CSS. .tpill's off state is a
    // class on the label whose colours derive from currentColor, and no selector
    // can reach an ancestor from the box inside it. This is the class
    // paintCounts writes for the strip above the grid, and writing it by hand is
    // the one thing this panel does instead of re-rendering -- renderAdv() would
    // drop the reader back to the top of a much longer panel.
    // `change`, not `click`: a click on the pill's label arrives before the
    // browser has moved the box, so a click handler would read the old state.
    if (t.getAttribute('data-atier') != null) {
      var pill = t.closest && t.closest('.tpill');
      if (pill) pill.classList.toggle('off', !t.checked);
      return;
    }
    if (t.getAttribute('data-aaff') == null) return;
    advCollect();
    var i = +t.getAttribute('data-aaff'), c = advS.aff[i];
    if (!c) return;
    renderAdv();
    var again = document.querySelector('#advb [data-aaff="' + i + '"]');
    if (again) again.focus();
  });

  document.addEventListener('keydown', function (e) {
    if (!advOn) return;
    if (e.key === 'Escape') { e.preventDefault(); advShow(false); }
    // Enter searches from anywhere in the panel except on a button, where it is
    // that button's own activation -- otherwise Enter on Reset would reset and
    // then immediately commit the reset.
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      advCommit();
    }
  });

  // ------------------------------------------------------------------ events
  function syncControls() {
    document.getElementById('q').value = S.q;
    document.getElementById('sort').value = S.sort;
    document.getElementById('dir').innerHTML = S.dir === -1 ? '&#8593;' : '&#8595;';
  }

  function paintGrid() {
    document.getElementById('app').className = S.item ? 'item' : '';
    if (S.item) {
      renderDetail(S.item);
    } else {
      render();
      document.getElementById('detail').innerHTML = '';   // don't leave stale DOM behind
    }
    syncControls();
  }

  // a control moved: update the URL and repaint in place
  function apply() {
    showAll = false;
    writeHash();
    paintGrid();
    paintCounts();   // facet counts respect the search box, so refresh them
    lastSig = sig();
  }

  // the URL moved: rebuild everything
  function onRoute() {
    readHash();
    if (sig() === lastSig) return;
    showAll = false;
    renderRail();
    renderTiers();
    renderSetCtl();
    paintGrid();
    lastSig = sig();
  }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-f')) {
      var set = S[t.getAttribute('data-f')], v = t.value;
      if (t.checked) set.add(v); else set.delete(v);
      // a fully-checked facet is elided from the URL by writeHash; the boxes
      // stay checked here because the rail is rebuilt from S, and unchecking
      // them all would look like the filter had been thrown away
      showAll = false; writeHash(); render(); paintCounts();
    } else if (t.id === 'setsel') { S.set = t.value; showAll = false; writeHash(); render(); paintCounts(); }
    else if (t.id === 'sort') { S.sort = t.value; apply(); }
  });

  // A search is a question about the whole corpus, so it replaces whatever is on
  // screen rather than narrowing inside it -- the same clear the set-name link
  // performs, through the same resetState(), so the two cannot drift.
  //
  // Without the clear this was not merely a narrow search: it did nothing at
  // all. apply() reaches paintGrid(), which branches on S.item and renders the
  // detail view instead of the grid, and S.item was never cleared here -- so
  // render() was never reached and Enter could not change the page.
  //
  // Escape clears through the same path. It is not a new search, but leaving it
  // able to empty the box while the card it was narrowing stays up is the same
  // bug from the other side, and one handler keeps the two keys together.
  document.getElementById('q').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    var v = e.key === 'Enter' ? this.value.trim().toLowerCase() : '';
    resetState();
    S.q = v;            // after resetState(), which clears it
    showAll = false;
    writeHash();
    // onRoute() returns early when the state matches the last paint, and a
    // search that lands on the grid already showing would be swallowed. The
    // hash also cannot do the routing for us: writeHash uses replaceState
    // wherever the page is served, so no hashchange follows.
    lastSig = null;
    onRoute();
  });

  document.getElementById('sort').addEventListener('change', function () {
    S.sort = this.value; apply();
  });

  document.getElementById('dir').addEventListener('click', function () {
    S.dir = -S.dir; apply();
  });

  // The toggle is a button, not a checkbox, so it fires click rather than change
  // and nothing else repaints it: writeHash uses replaceState wherever the page
  // is served (no hashchange follows), and on file:// the event that does follow
  // is asynchronous. renderSetCtl therefore updates the button itself rather
  // than waiting to be called back.
  document.getElementById('onlyset').addEventListener('click', function () {
    S.setOnly = !S.setOnly;
    showAll = false; writeHash();
    renderSetCtl();
    render(); paintCounts();
  });

  document.getElementById('reset').addEventListener('click', function (e) {
    e.preventDefault();
    // setting the hash fires hashchange, which routes; only call onRoute when
    // the hash is already '#reset' and no event will come
    lastSig = null;      // force the repaint even when the hash is already '#reset'
    if (location.hash.replace(/^#/, '') === 'reset') onRoute();
    else location.hash = '#reset';
  });

  document.getElementById('railbtn').addEventListener('click', function () {
    document.getElementById('rail').classList.toggle('floating');
    document.getElementById('railscrim').classList.toggle('on');
  });
  document.getElementById('railscrim').addEventListener('click', function () {
    document.getElementById('rail').classList.remove('floating');
    this.classList.remove('on');
  });

  // One delegated handler for every card, as grimtools does. Opening an item
  // goes through apply() rather than assigning location.hash, so the active
  // filters stay in the URL and the back link returns to the same result set
  // instead of dumping the user back on all 6,177 items.
  document.getElementById('scroll').addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.card') : null;
    if (a) { e.preventDefault(); S.item = a.getAttribute('data-id'); apply(); }
  });

  document.getElementById('detail').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.back') : null;
    if (b) { e.preventDefault(); S.item = ''; apply(); return; }
    // The set name is the other way out of the detail view, and a wider one: it
    // clears everything -- the search box, the facets, the other set controls --
    // and hands back the grid filtered to the set that was just named. The
    // clear is the same one #reset does, so the two cannot drift.
    var sl = e.target.closest ? e.target.closest('[data-set]') : null;
    if (!sl) return;
    e.preventDefault();
    resetState();
    S.set = sl.getAttribute('data-set');
    showAll = false;
    writeHash();
    // On file:// writeHash assigns location.hash and the hashchange that follows
    // is asynchronous -- and may not come at all, if the hash was already this.
    // The repaint cannot wait for either, so force it the way #reset does.
    lastSig = null;
    onRoute();
  });

  document.getElementById('more').addEventListener('click', function (e) {
    if (e.target.id === 'showall') { showAll = true; render(); }
    else if (e.target.id === 'cap') { showAll = false; render(); }
  });

  // A group header is a bulk toggle over the types under it, so the boxes it
  // stands in for actually end up checked. That is the whole reason the rail
  // carries one facet here and not a separate Category one: a header that set a
  // facet of its own while its children set `types` would AND the two and
  // return nothing.
  //
  // The checkboxes live in the DOM and renderRail() is deliberately not called
  // on a filter change, so the new state is mirrored onto them here.
  function toggleGroup(hdr) {
    var key = hdr.getAttribute('data-grp');
    var boxes = [], el = hdr.nextElementSibling, i;
    while (el) {
      if (el.classList.contains('grp')) break;
      if (hdr.classList.contains('sgrp') && el.classList.contains('sgrp')) break;
      if (el.classList.contains('f')) boxes.push(el.querySelector('input'));
      el = el.nextElementSibling;
    }
    var on = 0;
    for (i = 0; i < boxes.length; i++) if (boxes[i] && boxes[i].checked) on++;
    var want = on !== boxes.length;    // all on -> clear; anything else -> fill
    for (i = 0; i < boxes.length; i++) {
      if (!boxes[i]) continue;
      boxes[i].checked = want;
      if (want) S.types.add(boxes[i].value); else S.types.delete(boxes[i].value);
    }
    if (!boxes.length) return;         // a header with no rows is not a control
    showAll = false;
    writeHash(); render(); paintCounts();
  }

  // rail: group bulk toggle, category fold, section collapse
  document.getElementById('railbody').addEventListener('click', function (e) {
    // Tested first, and it must be: the collapse branch below reads data-sec
    // off its target's parentNode, so handing it a group header would key
    // SEC[null] and fold the group. The two cannot actually collide --
    // closest('.sec-h') from a header finds nothing, because the header lives
    // in .sec-b, a *sibling* of .sec-h -- but that safety rests entirely on the
    // class name, which is exactly what a later edit would be tempted to change.
    var g = e.target.closest ? e.target.closest('[data-grp]') : null;
    if (g) {
      // The glyph folds; the rest of the header is still the bulk toggle it has
      // always been. Only a category carries a glyph -- a subgroup's span is
      // empty and matches nothing here -- so a subgroup header has one action.
      var k = e.target.closest ? e.target.closest('.grp .tog') : null;
      if (k) {
        var path = g.getAttribute('data-grp');
        GRP[path] = GRP[path] !== true;
        foldGroup(g);
        return;
      }
      toggleGroup(g); return;
    }
    var h = e.target.closest ? e.target.closest('.sec-h') : null;
    if (h) toggleSec(h);
  });

  window.addEventListener('hashchange', onRoute);
  onRoute();
})();

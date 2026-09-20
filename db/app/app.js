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
  var TIERRANK = { 'Legendary': 0, 'Set': 1, 'Unique': 2, 'Rare': 3, 'Normal': 4, 'Unclassified': 5 };
  var TIERORDER = ['Legendary', 'Set', 'Unique', 'Rare', 'Normal', 'Unclassified'];

  // The game's names for the .DAT's requirement fields. TL2 renamed Torchlight
  // 1's Magic -> Focus and Defense -> Vitality, but the field names kept the
  // old words. Confirmed against alfgeir, whose rendered keys are literally
  // FocusRequirement and VitalityRequirement.
  var REQLABEL = { str: 'Strength', dex: 'Dexterity', mag: 'Focus', def: 'Vitality' };

  // ------------------------------------------------------------------ state
  // There is no separate `cats` facet. The rail groups types under a category
  // header and the header toggles those types, so "category is Weapons" and
  // "every weapon type is checked" are the same filter -- keeping both would
  // just reinstate the empty grid the grouping exists to remove. A legacy
  // #cat= link is expanded to its types on read; see readHash.
  var S = {
    q: '', types: new Set(), tiers: new Set(), dmg: new Set(),
    set: '', sock: false, lvlMin: null, lvlMax: null,
    req: { str: null, dex: null, mag: null, def: null },
    sort: 'name', dir: 1, item: ''
  };

  // ------------------------------------------------------------------ utils
  var escEl = document.createElement('div');
  function esc(s) {
    escEl.textContent = s == null ? '' : String(s);
    return escEl.innerHTML;
  }
  function n(v) { return v == null || v === '' ? 0 : (+v || 0); }
  // Damage and armor arrive as the string the game shows: '140-174' when the
  // value varies, '140' when it does not. Everything that has to *compare* two
  // of them uses the midpoint, which is also what the dps figure is built on.
  function avg(v) {
    var s = String(v == null ? '' : v), i = s.indexOf('-');
    if (i < 0) return +s || 0;
    return ((+s.slice(0, i) || 0) + (+s.slice(i + 1) || 0)) / 2;
  }
  function total(o) { var t = 0, k; for (k in o) t += avg(o[k]); return t; }

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

  function slotClass(o) {
    var t = o.t;
    if (t === 'Ring' || t === 'Necklace' || t === 'Collar' || t === 'Tag') return 'jewel';
    if (t === 'Belt') return 'waist';
    if (t === 'Helmet' || t === 'Gloves' || t === 'Boots') return 'head';
    if (t === 'Chest Armor' || t === 'Leggings' || t === 'Shoulder Armor' ||
        t === 'Shield' || t === 'Armor') return 'chest';
    return 'weapon';
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // The card's one-line stat is the item's *primary* type with its own value --
  // "Physical 169", "Fire Armor 140-174". A summed total would be an invention:
  // no such number is shown in game, and the user asked for it removed.
  function primary(map, suffix) {
    var best = null, k;
    for (k in map) if (best === null || avg(map[k]) > avg(map[best])) best = k;
    return { k: cap(best) + suffix, v: map[best] };
  }

  function headline(o) {
    if (o.dmg) return primary(o.dmg, '');
    if (o.arm) return primary(o.arm, ' Armor');
    if (o.fx && o.fx.length) return { k: 'Effect', v: o.fx[0] };
    return null;
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
    if (skip !== 'tiers' && S.tiers.size && !S.tiers.has(o.q)) return false;
    if (skip !== 'dmg' && S.dmg.size) {
      if (!o.dmg) return false;
      var hit = false;
      S.dmg.forEach(function (d) { if (o.dmg[d]) hit = true; });
      if (!hit) return false;
    }
    if (S.sock && !n(o.sk)) return false;
    if (S.set && o.set !== S.set) return false;
    if (S.lvlMin != null && n(o.lv) < S.lvlMin) return false;
    if (S.lvlMax != null && n(o.lv) > S.lvlMax) return false;
    for (var k in S.req) {
      if (S.req[k] != null && n(o.rq && o.rq[k]) > S.req[k]) return false;
    }
    return true;
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
      else if (s === 'tier') r = (TIERRANK[x.q] - TIERRANK[y.q]) || x.n.localeCompare(y.n);
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
    { k: 'tiers', title: 'Tier', get: function (o) { return [o.q]; } },
    { k: 'dmg', title: 'Damage type', get: function (o) {
        return o.dmg ? Object.keys(o.dmg) : []; } }
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
  function groupRow(g, sub) {
    var path = sub ? g + '/' + sub : g;
    return '<div class="' + (sub ? 'sgrp' : 'grp') + '" data-grp="' + esc(path) + '">' +
      '<span class="mk"></span>' +
      '<span class="lbl">' + esc(sub || g) + '</span>' +
      '<span class="ct"></span></div>';
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

  function renderRail() {
    var h = '';
    FACETDEF.forEach(function (f) {
      var fv = facetValues(f.k);
      var body = f.k === 'types' ? typesBody()
                                : fv.arr.map(function (p) { return checkRow(f.k, p[0], p[0]); }).join('');
      if (!fv.arr.length) body = '<div class="f off"><span class="lbl">nothing matches</span></div>';
      h += section(f.k, f.title, body, fv.total);
    });

    // sets: too many to checkbox, so a select
    var sets = Object.create(null);
    ITEMS.forEach(function (o) { if (o.set) sets[o.set] = (sets[o.set] || 0) + 1; });
    var setKeys = Object.keys(sets).sort();
    var opts = '<option value="">any</option>' + setKeys.map(function (s) {
      return '<option value="' + esc(s) + '"' + (S.set === s ? ' selected' : '') + '>' +
        esc(s) + ' (' + sets[s] + ')</option>';
    }).join('');
    h += section('set', 'Set', '<div class="rng"><select id="setsel" style="width:100%">' +
      opts + '</select></div>', setKeys.length);

    h += section('lvl', 'Item Level', '<div class="rng">' +
      '<input type="number" id="lvmin" placeholder="min" value="' + (S.lvlMin == null ? '' : S.lvlMin) + '">' +
      '<span>&ndash;</span>' +
      '<input type="number" id="lvmax" placeholder="max" value="' + (S.lvlMax == null ? '' : S.lvlMax) + '">' +
      '</div>');

    // "Stat requirement", not "Requirement": with the either/or rule an item's
    // level branch can be met while the stat branch is not, and these four
    // inputs only ever test the stat branch. Naming them the same way the
    // detail view does also matters more than it looks -- TL2 has no "Magic"
    // or "Defense" stat, so MAG/DEF pointed at attributes that do not exist.
    h += section('req', 'Stat requirement at most', ['str', 'dex', 'mag', 'def'].map(function (k) {
      return '<div class="rng"><span class="rl">' + REQLABEL[k] + '</span>' +
        '<input type="number" data-req="' + k + '" placeholder="any" value="' +
        (S.req[k] == null ? '' : S.req[k]) + '"></div>';
    }).join(''));

    h += section('misc', 'Other',
      '<label class="f' + (S.sock ? '' : ' off') + '"><input type="checkbox" id="sock"' +
      (S.sock ? ' checked' : '') + '><span class="lbl">Has sockets</span></label>');

    document.getElementById('railbody').innerHTML = h;
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
    var hl = headline(o);
    var sub = esc(o.t) + (n(o.lv) ? ' · Lv ' + n(o.lv) : '') +
      (o.set ? ' · ' + esc(o.set) : '');
    h = '<a class="card ' + (TIERCLS[ownTier(o)] || 'q-unclassified') + '" data-id="' + esc(o.id) + '">' +
      '<span class="art">' + iconHTML(o) + '</span>' +
      '<span class="meta"><span class="nm">' + esc(o.n) + '</span>' +
      '<span class="sub">' + sub + '</span>' +
      (hl ? '<span class="st">' + hl.k + ' <b>' + esc(hl.v) + '</b></span>' : '') +
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
    return JSON.stringify([S.q, s(S.types), s(S.tiers), s(S.dmg),
      S.set, S.sock, S.lvlMin, S.lvlMax, S.sort, S.dir, S.item,
      ['str', 'dex', 'mag', 'def'].map(function (k) { return S.req[k]; })]);
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
  function row(k, v, big) {
    return '<div class="row"><span class="k">' + esc(k) + '</span>' +
      '<span class="fill"></span><span class="v' + (big ? ' big' : '') + '">' +
      esc(v) + '</span></div>';
  }
  // Divider between the two branches of an either/or requirement. Parentheses
  // would be more literal, but the rule is always "level, or all the stats", so
  // a ruled "or" says the same thing and reads far better in this layout.
  function orRow() { return '<div class="or">or</div>'; }

  function block(title, body) {
    return body ? '<div class="block"><h3>' + esc(title) + '</h3>' + body + '</div>' : '';
  }

  function renderDetail(id) {
    var o = null;
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) { o = ITEMS[i]; break; }
    var d = document.getElementById('detail');
    if (!o) {
      d.innerHTML = '<div class="msg">No item called <b>' + esc(id) + '</b>.</div>';
      return;
    }
    var c = o.ic && ICONS[o.ic];
    var art = c
      ? '<i style="width:' + c[2] + 'px;height:' + c[3] + 'px;background-position:-' +
        c[0] + 'px -' + c[1] + 'px"></i>'
      : '<span class="ph">' + esc(o.t.charAt(0)) + '</span>';

    // The item's own rarity, which on a set piece is not the tier the facet
    // files it under. Used for the name, the type line and the card.
    var ink = ownTier(o);
    var h = '<div class="dwrap"><a class="back" href="#">&larr; back to results</a>' +
      '<div class="dtop"><div class="dart ' + slotClass(o) + '">' + art + '</div>' +
      // The tier class is on the span rather than the h2 so it does not have to
      // out-specify `.dname`'s own colour -- it is a different element, and
      // `.t-*` already means "colour the element this is on".
      '<div><h2 class="dname"><span class="' + tierInk(ink) + '">' + esc(o.n) +
      '</span></h2>' +
      // "<rarity> <type>", the rarity word in its own colour. Reversed from the
      // old "Pistol Rare" at the user's request: the tier is the word that
      // changes what the item is worth, so it leads. On a set piece the rarity
      // leads and the Set tag follows it -- "Unique Set Belt" -- because the
      // game prints both and only the first says what the item is worth.
      '<div class="dtype"><em class="' + tierInk(ink) + '">' + esc(ink) + '</em> ' +
      (o.uq ? esc(o.q) + ' ' : '') + esc(o.t) +
      (o.vb ? '<span class="tag">base values, not rendered</span>' : '') +
      '</div></div></div>';

    // No Total row on either block. The game shows no such number, and the
    // user asked for it gone -- a sum of five elemental values is a stat this
    // database invented. dps is different: the game does state it, for weapons.
    if (o.dmg) {
      h += block('Damage', DMGTYPES.filter(function (k) { return o.dmg[k]; })
        .map(function (k) { return row(cap(k), o.dmg[k]); }).join('') +
        (o.dps ? row('Damage per Second', o.dps, true) : ''));
    }
    if (o.arm) {
      h += block('Armor', DMGTYPES.filter(function (k) { return o.arm[k]; })
        .map(function (k) { return row(cap(k), o.arm[k]); }).join(''));
    }
    // TL2 renamed Torchlight 1's Magic and Defense to Focus and Vitality; the
    // .DAT field names kept the old words, so the labels are translated here
    // rather than in the build.
    // Requirements are alternatives, not a conjunction: the game lets you equip
    // an item once you meet the player level OR all of the stat requirements,
    // whichever you reach first. That is why a class item lists both -- the
    // Battlemage Helm is "Level 65 or (87 Focus and 101 Vitality)". Printing
    // them as one flat list would state the opposite of how the game works.
    var req = o.rq || {};
    var statRows = ['str', 'dex', 'mag', 'def'].filter(function (k) { return req[k]; })
      .map(function (k) { return row(REQLABEL[k], req[k]); }).join('');
    var reqBody = n(o.lr) ? row('Player Level Required', n(o.lr)) : '';
    if (n(o.lr) && statRows) reqBody += orRow();
    reqBody += statRows;
    // The class gate is *not* an alternative to those -- it is a hard
    // restriction on top of whichever branch you satisfy.
    if (o.cls) reqBody += row('Class', o.cls + ' only');
    h += block('Requirements', reqBody);

    // "Item Level", not bare "Level": it is a different thing from the player
    // level above and the old label read as either one.
    //
    // Two fields are built but deliberately not rendered here:
    //
    //   xl  (MAXLEVEL)     the level the item stops scaling at -- a property of
    //                      the drop rather than of the item.
    //   skm (MAX_SOCKETS)  NOT this item's cap. It is the ceiling across the
    //                      item's variants: legendary2_sword05 (Cerulean
    //                      Nightmare) declares sk=2/skm=4, and the 4 belongs to
    //                      its c variant, the Netherrealm Sword. Rendering it
    //                      read as "you can socket this to 4", which you cannot.
    //                      On 1,857 of the 2,168 records carrying one it exceeds
    //                      the socket count shown right beside it.
    //
    // Both stay in items.json. Neither was ever a CSV column.
    //
    // rng (RANGE) is here rather than in the type line above, where it used to
    // render as e.g. "Sword · Rare · 0.6 range" and read as a damage range. It
    // is not: it is the weapon's attack reach in world units, the distance at
    // which the attack connects. Read off the weapon base templates
    // (BASE_SWORD.DAT, BASE_BOW.DAT) beside MINDAMAGE/MAXDAMAGE, which is why it
    // is near-constant per type -- melee 0.5-1.8, ranged 5-12 -- and why per
    // item it says less than the number suggests. The exceptions are the whole
    // point of showing it: axe_u05x "The Axe of Throwing" is 9 where all 92
    // other axes are 0.6. All 1,372 records carrying it are weapons; no other
    // record in the corpus has the field.
    // MINLEVEL is two unrelated fields wearing one name. On a socketable it is
    // a real gate and a clean one: the seven ranks of every gem family carry
    // exactly 1, 14, 28, 42, 56, 70, 84 -- a step of 14 -- against the gem's
    // own levels of 8, 22, 36 ... a fixed 8 higher, and the same seven numbers
    // across all eight ember families. Nothing else in the record explains a
    // second level field on a gem, and a gem's only level-shaped requirement is
    // the item it goes into. On everything you *wear* it is none of that: it is
    // a stray scalar that is neither `lv` nor the `lr` shown above (it equals
    // lv on 64 of 2,245, and is 1 on 258 where lr is the real gate), so it is
    // shown on socketables only.
    h += block('Item', (n(o.lv) ? row('Item Level', n(o.lv)) : '') +
      (n(o.ml) && o.t === 'Socketable'
        ? row('Required Item Level to Socket', n(o.ml)) : '') +
      (o.sp && speedBand(+o.sp)
        ? row('Attack Speed', speedBand(+o.sp) + ' (' + o.sp + ' seconds)') : '') +
      (n(o.rng) ? row('Weapon Range', n(o.rng)) : '') +
      (n(o.sk) ? row('Sockets', n(o.sk)) : '') +
      (o.set ? row('Set', o.set) : ''));
    // Augmented weapons come *before* the affixes, which is the order the
    // game's own tooltip uses -- it draws the unlockable group first, then the
    // rule, then the ordinary affixes. The group is only worth showing because
    // it is plainly conditional: the task is the headline, the divider between
    // the task and the stats states the condition in words, and the stats
    // themselves are set apart so they cannot be read as already on the weapon.
    // (74 items; split_effects() in build.py is what separates the two groups.)
    if (o.aug && o.aug.length) {
      h += block('Augmented Weapon', o.aug.map(function (a) {
        return (a.task ? '<div class="task">' + esc(a.task) + '</div>' : '') +
          (a.fx.length
            ? '<div class="cond">locked until the task above is complete</div>' +
              '<ul class="fx locked">' + a.fx.map(function (f) {
                return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>'
            : '');
      }).join(''));
    }
    if (o.fx && o.fx.length) {
      h += block('Affixes', '<ul class="fx">' + o.fx.map(function (f) {
        return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>');
    }
    // The whole set's ladder, on every piece of it -- this is a set item's most
    // useful fact and it is not on the item. Matches how the game and TIDBI both
    // print it: the piece's own stats, then the set it belongs to.
    //
    // Keyed on setid, not on `set`: 556 items carry a set and every one of them
    // is in SETS, but the two are different strings (a token against a display
    // name) and only the token is a key here. The guard is for the case that
    // should not arise -- an item whose set has no ladder -- where the honest
    // render is no block at all rather than an empty one.
    var st = o.setid && SETS[o.setid];
    if (st) {
      // Two numbers, because they answer different questions and on 47 of the
      // 80 sets they differ: how many pieces exist (what you can collect) and
      // how many the last rung needs (what you must wear). A set can be short
      // of its top rung -- 15 of them are -- and can equally have pieces to
      // spare, as the four 16-piece sets do, topping out at 10.
      var ship = st.c, top = st.b.length ? st.b[st.b.length - 1][0] : 0;
      h += block('Set Bonuses',
        '<div class="seth">' + esc(st.n) + '<span class="ct">' + ship +
        ' pieces (' + top + ' piece set)</span></div>' +
        st.b.map(function (r) {
          // a rung gated above what the set ships, so nothing in the game
          // reaches it -- said in the label rather than left to be inferred
          // from a colour, and never quietly dropped
          var over = r[0] > ship;
          return '<div class="thr' + (over ? ' over' : '') + '">' + r[0] + ' pieces' +
            (over ? ' · set ships ' + ship : '') + '</div>' +
            '<ul class="fx' + (over ? ' over' : '') + '">' +
            r[1].map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') +
            '</ul>';
        }).join(''));
    }
    if (o.ds) h += block('Description', esc(o.ds.replace(/\\n/g, ' ')));

    h += '<div class="prov"><b>file</b> ' + esc(o.p) + '<br>' +
      (o.g ? '<b>guid</b> ' + esc(o.g) + '<br>' : '') +
      // Three sources, not two. A derived number is computed from the PAK by
      // this pipeline, so calling it a TIDBI value would be the same
      // misattribution the vb wording exists to prevent -- and a base value is
      // a raw pre-scale scalar that no one has rendered at all.
      '<b>numbers</b> ' + (o.vb
        ? 'PAK .DAT base value' + (o.inh ? ' (inherited from BASEFILE)' : ' (own fields)')
        : o.dv ? 'reconstructed from PAK game files'
        : 'TIDBI in-game value') +
      (o.ns ? '<span class="tag">name from ' + esc(o.ns) + '</span>' : '') +
      (o.ici ? '<span class="tag">icon inherited</span>' : '') +
      '<br><b>id</b> ' + esc(o.id) + '</div></div>';

    d.innerHTML = h;
    d.scrollTop = 0;
  }

  // ------------------------------------------------------------ hash routing
  function readHash() {
    var s = location.hash.replace(/^#/, '');
    S.types = new Set(); S.tiers = new Set(); S.dmg = new Set();
    S.set = ''; S.sock = false; S.lvlMin = S.lvlMax = null; S.item = '';
    S.req = { str: null, dex: null, mag: null, def: null };
    S.q = ''; S.sort = 'name'; S.dir = 1;
    if (!s || s === 'reset') return;
    s.split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i)),
          v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
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
      else if (k === 'dmg') S.dmg = new Set(list);
      else if (k === 'set') S.set = v;
      else if (k === 'sock') S.sock = v === '1';
      else if (k === 'q') S.q = v.toLowerCase();
      else if (k === 'item') S.item = v;
      else if (k === 'sort') S.sort = v || 'name';
      else if (k === 'dir') S.dir = v === 'desc' ? -1 : 1;
      else if (k === 'lvl') { var p = v.split('-'); S.lvlMin = p[0] === '' ? null : +p[0];
                              S.lvlMax = p[1] ? +p[1] : null; }
      else if (k === 'req') list.forEach(function (r) {
        var q = r.split(':'); if (q[0]) S.req[q[0]] = +q[1]; });
    });
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
    if (S.sock) p.push('sock=1');
    if (S.lvlMin != null || S.lvlMax != null)
      p.push('lvl=' + (S.lvlMin == null ? '' : S.lvlMin) + '-' + (S.lvlMax == null ? '' : S.lvlMax));
    var rq = ['str', 'dex', 'mag', 'def'].filter(function (k) { return S.req[k] != null; })
      .map(function (k) { return k + ':' + S.req[k]; });
    if (rq.length) p.push('req=' + rq.join(','));
    if (S.q) p.push('q=' + encodeURIComponent(S.q));
    if (S.sort !== 'name') p.push('sort=' + S.sort);
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
    else if (t.id === 'sock') { S.sock = t.checked; showAll = false; writeHash(); render(); paintCounts(); }
    else if (t.id === 'sort') { S.sort = t.value; apply(); }
    else if (t.getAttribute && t.getAttribute('data-req')) {
      var k = t.getAttribute('data-req');
      S.req[k] = t.value === '' ? null : +t.value; showAll = false; writeHash(); render(); paintCounts();
    } else if (t.id === 'lvmin' || t.id === 'lvmax') {
      S.lvlMin = document.getElementById('lvmin').value === '' ? null : +document.getElementById('lvmin').value;
      S.lvlMax = document.getElementById('lvmax').value === '' ? null : +document.getElementById('lvmax').value;
      showAll = false; writeHash(); render(); paintCounts();
    }
  });

  document.getElementById('q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { S.q = this.value.trim().toLowerCase(); apply(); }
    if (e.key === 'Escape') { this.value = ''; S.q = ''; apply(); }
  });

  document.getElementById('sort').addEventListener('change', function () {
    S.sort = this.value; apply();
  });

  document.getElementById('dir').addEventListener('click', function () {
    S.dir = -S.dir; apply();
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
    if (b) { e.preventDefault(); S.item = ''; apply(); }
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

  // rail: group bulk toggle, section collapse
  document.getElementById('railbody').addEventListener('click', function (e) {
    // Tested first, and it must be: the collapse branch below reads data-sec
    // off its target's parentNode, so handing it a group header would key
    // SEC[null] and fold the group. The two cannot actually collide --
    // closest('.sec-h') from a header finds nothing, because the header lives
    // in .sec-b, a *sibling* of .sec-h -- but that safety rests entirely on the
    // class name, which is exactly what a later edit would be tempted to change.
    var g = e.target.closest ? e.target.closest('[data-grp]') : null;
    if (g) { toggleGroup(g); return; }
    var h = e.target.closest ? e.target.closest('.sec-h') : null;
    if (!h) return;
    var sec = h.parentNode, k = sec.getAttribute('data-sec');
    SEC[k] = SEC[k] === false;
    sec.classList.toggle('closed', SEC[k] === false);
    h.querySelector('.tog').textContent = SEC[k] === false ? '+' : '−';
  });

  window.addEventListener('hashchange', onRoute);
  onRoute();
})();

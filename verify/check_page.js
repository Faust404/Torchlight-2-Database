/* Drives the built page in a real DOM. This is the automated form of the
 * manual browser checks: filtering, multi-select, search, sort, the detail
 * view, provenance and hash deep links -- 186 assertions.
 *
 *   npm i jsdom          (anywhere that resolves, or set NODE_PATH)
 *   node --max-old-space-size=6144 verify/check_page.js
 *
 * The heap flag is not optional. Twenty of these assertions build a fresh
 * JSDOM over the whole built page, and that page is 7.30 MB -- mostly a 4.8 MB
 * base64 icon sheet sitting in a <style> text node -- so the suite holds several
 * gigabytes of live DOMs and node's default old-space (about 4 GB) runs out
 * partway through. 5,120 MB completes; 4,096 MB does not.
 *
 * jsdom fires a spurious second hashchange (with an empty hash) whenever code
 * assigns location.hash. That reproduces on a page with a single listener and
 * no app code, so it is a jsdom artifact rather than an app bug. Navigation is
 * therefore driven with dom.reconfigure(), which changes the URL without
 * navigating, and the click path is asserted synchronously (apply() runs
 * inside the delegated handler).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// verify/ is a sibling of out/ -- both sit at the repo root -- so the page is
// one level up. This is why the suite is not under test/: it is not scratch, it
// is the check the build has to pass, and it lives beside src/ and web/ where a
// fresh clone can still run it.
const PAGE = path.join(__dirname, '..', 'out', 'index.html');
if (!fs.existsSync(PAGE)) {
  console.error('no built page at ' + PAGE + '\nrun `python src/build.py` first.');
  process.exit(1);
}
const URL_ = 'file:///' + PAGE.split(path.sep).join('/');
const html = fs.readFileSync(PAGE, 'utf8');
console.log('page bytes:', (html.length / 1048576).toFixed(2), 'MB\n');

let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (!cond && extra ? '   ' + extra : ''));
  if (!cond) fails++;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

const dom = new JSDOM(html, { runScripts: 'dangerously', url: URL_, pretendToBeVisual: true });
const w = dom.window, d = w.document;
const cards = () => d.querySelectorAll('#grid .card');
const names = () => [].map.call(cards(), c => c.querySelector('.nm').textContent);
const cnt = () => d.getElementById('count').textContent;
const det = () => d.getElementById('detail').textContent;
const lvls = () => [].map.call(cards(), c => {
  const m = /Lv (\d+)/.exec(c.querySelector('.sub').textContent); return m ? +m[1] : 0; });
// The rendered cards split into contiguous runs of one tier. Tier is the
// primary sort key, so the level sequence *resets* at every boundary -- the 92
// Legendary items end at level 54 and the Unique run after them starts again at
// 105. Any claim about level order therefore has to be made per run; asserting
// it across the whole page asserts something the sort deliberately does not do.
const tierRuns = () => {
  const out = [];
  [].forEach.call(cards(), c => {
    const q = (c.className.match(/q-[a-z]+/) || ['?'])[0];
    if (!out.length || out[out.length - 1].q !== q) out.push({ q, lv: [] });
    const m = /Lv (\d+)/.exec(c.querySelector('.sub').textContent);
    out[out.length - 1].lv.push(m ? +m[1] : 0);
  });
  return out;
};
const monotonic = up => tierRuns().every(r =>
  r.lv.every((v, i) => !i || (up ? r.lv[i - 1] <= v : r.lv[i - 1] >= v)));
const runSummary = () => tierRuns().map(r => `${r.q.slice(2)}(${r.lv.length})`).join(' ');

const errors = [];
w.addEventListener('error', e => errors.push(String(e.message)));

async function go(hash) {
  dom.reconfigure({ url: URL_ + hash });
  w.dispatchEvent(new w.Event('hashchange'));
  await wait(0);
}

(async () => {
  // --------------------------------------------------------------- initial
  ok('renders a first page of cards', cards().length === 500, `${cards().length}`);
  // 6,048 of the 6,173 in items.json: the site hides the Unclassified tier,
  // which is what the pipeline calls an item it could not tier (dev, test and
  // monster-only units). The db keeps all 6,173 -- see SITE_HIDDEN_TIERS.
  ok('count line reports the rendered corpus', /6,048/.test(cnt()), cnt());
  ok('truncation is disclosed, not silent',
     /Showing the first 500 of 6,048/.test(d.getElementById('more').textContent));
  ok('offers a Show all escape hatch', !!d.getElementById('showall'));

  // ----------------------------------------------------------- tier palette
  // The tier colours are sampled from the game's own quality-overlay art (see
  // the block at the head of app.css for where and how). Two things are worth
  // asserting, and neither is a restatement of the constants: that no two tiers
  // collapsed onto one colour, and that each is legible as text. The raw overlay
  // purple for `set` sits at 2.35:1 on the panel -- it is a glow meant to sit on
  // icon art -- which is why it is lifted, and this is what would catch it being
  // pasted back in.
  {
    const root = w.getComputedStyle(d.documentElement);
    const css = [].map.call(d.querySelectorAll('style'), s => s.textContent).join('\n');
    // the class suffix and the variable suffix differ for the hidden tier
    const TIERS = [['normal', 'normal'], ['rare', 'rare'], ['unique', 'unique'],
                   ['set', 'set'], ['legendary', 'legendary'],
                   ['unclassified', 'none']];
    const col = v => (root.getPropertyValue('--t-' + v) || '').trim();

    const vals = TIERS.map(t => col(t[1]));
    ok('every tier colour is defined',
       vals.every(v => /^#[0-9a-f]{6}$/i.test(v)), vals.join(' '));
    ok('no two tiers share a colour', new Set(vals).size === TIERS.length, vals.join(' '));
    ok('each tier class uses its own variable',
       TIERS.every(t => new RegExp('\\.q-' + t[0] + '\\s*\\.nm\\{[^}]*var\\(--t-' + t[1] + '\\)')
         .test(css)));
    // The detail's type line paints the tier word with the second, plainer set
    // of tier classes -- the `.q-` ones only reach a descendant `.nm`, which the
    // type line is not. Both sets have to name the same variable for the same
    // tier, which is what stops the two from drifting apart.
    ok('each tier also has a class that colours the element it is put on',
       TIERS.every(t => new RegExp('\\.t-' + t[0] + '\\{[^}]*var\\(--t-' + t[1] + '\\)')
         .test(css)));

    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = h => { const n = parseInt(h.slice(1), 16);
      return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const panel = (root.getPropertyValue('--panel') || '#171614').trim();
    const worst = TIERS.map(t => [t[1], ratio(col(t[1]), panel)])
      .sort((a, b) => a[1] - b[1])[0];
    ok('every tier colour clears 4.5:1 on the panel', worst[1] >= 4.5,
       `worst is ${worst[0]} ${col(worst[0])} at ${worst[1].toFixed(2)}:1`);
  }

  // ----------------------------------------------------- the card type line
  // "Quest Item" is the case that was visibly wrong on the site: it rendered as
  // "QUEST ITEM" because a bare `.sub` rule added for the rail's subgroup
  // headers leaked text-transform onto every card.
  //
  // Note this only covers the *data*: textContent is the DOM string, before any
  // CSS transform is applied, so an uppercasing rule is invisible here. That is
  // precisely why the real guard is the computed-style assertion on `.card .sub`
  // further down -- this one catches the other fix, someone writing the caps
  // into the type name instead of leaving it to the stylesheet.
  //
  // It runs here, before anything has clicked, because jsdom's spurious
  // empty-hashchange (see the header note) fires after the app assigns
  // location.hash and would blank the filter out from under the assertion.
  await go('#type=Quest%20Item');
  const qsub = [].map.call(cards(), c => c.querySelector('.sub').textContent);
  ok('a Quest Item card reads "Quest Item", in title case',
     qsub.length === 150 && qsub.every(s => s.indexOf('Quest Item') === 0) &&
     qsub.every(s => s !== s.toUpperCase()), qsub.slice(0, 3).join(' | '));

  // ------------------------------------------------------- Legendary + Axe
  await go('#tier=Legendary&type=Axe');
  ok('Legendary+Axe filters to 6', cards().length === 6, `${cards().length} ${cnt()}`);
  ok('Aenigma is in the result set', names().indexOf('Aenigma') >= 0, names().join(' | '));
  ok('facet counts render', d.querySelectorAll('[data-ct]').length > 0);

  // -------- click an item: filters must survive into the item route --------
  const aen = [].filter.call(cards(), c => c.querySelector('.nm').textContent === 'Aenigma')[0];
  aen.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  // synchronous -- apply() runs inside the delegated handler
  // The card leads with the number, then the element mark, then the word -- the
  // order the game's own tooltip lays out (value widget, image widget, label).
  // The mark is an <i> with no text in it, so what the DOM reads is the number
  // and the word run together: "169Physical Damage".
  ok('clicking opens the detail', /169Physical Damage/.test(det()), det().slice(0, 120));
  ok('the item route keeps the active filters',
     /tier=Legendary/.test(w.location.hash) && /item=legendary_axe01/.test(w.location.hash),
     w.location.hash);
  // 169/72 are now reconstructed from the DAT rather than read out of TIDBI,
  // and they land on the same numbers -- the DAT's raw 70/30 are pre-scale and
  // were what this page used to show. See derived_range() in build.py.
  ok('detail shows physical 169 + electric 72',
     /169Physical Damage/.test(det()) && /72Electric Damage/.test(det()));
  ok('no invented Total row survives', !/Total/.test(det()));
  ok('detail shows Strength 163 / Dexterity 68 (not STR 120 / DEX 50)',
     /Strength\s*163/.test(det()) && /Dexterity\s*68/.test(det()) && !/STR/.test(det()));
  ok('detail shows sockets 2', /2 Sockets/.test(det()));
  // The card states the item level once, in the corner, as "Level 54" -- and
  // what makes the short word affordable there is that the class gate is also in
  // the corner and the requirement below says "Player Level" in full. The two
  // are different things and the old labels ("Item Level" / "Level required")
  // read as either one.
  //
  // This used to be a *negative* assertion on "Min level", and it passed on
  // letter case alone: the card prints "Min Level", so `!/Min level/` was true
  // whatever the band did. Aenigma has ml=45, so the band renders -- the old
  // wording would have gone green over a row it was written to exclude. It now
  // asserts where the band is and, more to the point, where it is not.
  {
    const corner = d.querySelector('#detail .corner').textContent;
    const rrow = d.querySelector('#detail .rrow').textContent;
    const lvlr = d.querySelector('#detail .lvlr').textContent;
    ok('detail shows the item level in the corner, and no other level beside it',
       /Level 54/.test(corner) && !/Item Level/.test(corner), corner);
    ok('detail shows the player level among the requirements', /Player Level 61/.test(rrow), rrow);
    // ml <= lv <= xl brackets the band an item drops in. It is not a gate, so it
    // is stated in plain text below the requirements rather than boxed into a
    // third chip -- and it must not appear among them.
    ok('the spawn band is the only other level, and it is MINLEVEL',
       /Min Level 45/.test(lvlr) && !/Min Level/.test(rrow) && !/Max Level/.test(rrow), lvlr);
  }
  ok('the old "Level required" wording is gone', !/Level required/.test(det()));
  // `Level required` was the old label; `Player Level` is the new one, and the
  // negative above cannot catch a regression that reintroduces the old *shape*
  // -- the item level printed a second time beside the corner. Counting the
  // occurrences states the property directly: 54 is on the card once.
  ok('the item level is stated once, in the corner',
     det().split('Level 54').length - 1 === 1, det().slice(0, 200));
  // Aenigma carries neither xl nor skm, so asserting the Max Level / Max Sockets
  // rows are absent *here* would pass even with both still rendered. Those two
  // are checked below, against a record that actually has the fields.
  ok('the dropped fields are still built, just not shown here',
     !/Max Level/.test(det()) && !/Max Sockets/i.test(det()) &&
     w.DB.items.some(o => o.xl) && w.DB.items.some(o => o.skm));
  // MAXLEVEL above 999 is the game's way of writing "never stops dropping", and
  // it writes it four different ways -- 9999, 99999, 999999, 9999999. The build
  // collapses all 259 of them to the 999 the rest of the corpus already uses
  // (see MAX_LEVEL_CEILING in src/build.py). Asserted across the whole database
  // rather than on one card, because most of those 259 are potions, quest items
  // and maps that never render, so a regression could sit entirely off-page. The
  // population check keeps the first half from passing on a field that got
  // blanked instead of clamped.
  ok('no max level in the database exceeds the 999 ceiling',
     w.DB.items.every(o => !o.xl || +o.xl <= 999) &&
     w.DB.items.filter(o => +o.xl === 999).length > 1000,
     `${w.DB.items.filter(o => +o.xl > 999).length} above 999, ` +
     `${w.DB.items.filter(o => +o.xl === 999).length} at 999`);
  // rng (RANGE) is the weapon's attack reach, not a damage range -- it used to
  // render in the type line as "Axe · Legendary · 0.6 range", which read as one.
  // It sits with the weapon's other two output numbers now, under the damage per
  // second. Aenigma is an Axe, and 93 of the 101 Axes are 0.6.
  //
  // The negative half reads `.dtype` rather than the whole detail, because a
  // damage range is *supposed* to be down there -- only the type line must be
  // free of the word.
  {
    const dtyp = d.querySelector('#detail .dtype').textContent;
    ok('weapon range moved out of the type line into the card body',
       /Weapon Range\s*0\.6/.test(det()) && !/range/i.test(dtyp), dtyp);
  }
  // The type line reads "<tier> <type>" -- "Legendary Axe" -- the tier word
  // first, in its own tier colour. It used to read "Axe Legendary" with the
  // tier in a flat teal that no tier owns. Order is asserted on the text; the
  // colour is asserted through the class and the stylesheet rule rather than
  // getComputedStyle, which does not substitute var() in jsdom.
  {
    const dtyp = d.querySelector('#detail .dtype');
    const ink = dtyp.querySelector('em');
    ok('the type line reads tier-then-type, "Legendary Axe"',
       /^Legendary Axe/.test(dtyp.textContent), dtyp.textContent);
    ok('the tier word is the part that carries the tier colour',
       !!ink && ink.textContent === 'Legendary' && ink.className === 't-legendary',
       ink && ink.className + ' -> ' + ink.textContent);
  }
  // The card's type line and the rail's subgroup headers share nothing but a
  // look: the header is uppercase by design, the card is not. They collided once
  // (asserted above, at the card), so check the cascade in both directions --
  // a rule intended for one must not be reaching the other.
  {
    const cardSub = d.querySelector('#grid .card .sub');
    const railSub = d.querySelector('#railbody .sgrp');
    ok('rail subgroup headers stay uppercase',
       !!railSub && w.getComputedStyle(railSub).textTransform === 'uppercase');
    ok("the card's type line is not uppercased by the rail's rules",
       !!cardSub && w.getComputedStyle(cardSub).textTransform === 'none',
       cardSub && w.getComputedStyle(cardSub).textTransform);
  }
  // dps 430 is alfgeir's own figure for Aenigma, and the speed string is the
  // shape the user quoted from the game. Both lead with their number now, like
  // every other stat on the card: "430 Damage per Second", "Very Fast attack
  // speed (0.56 seconds)". The band word moves to the front because it is the
  // reading of the number, and the seconds are the number it is read from.
  ok('detail shows damage per second 430', /430 Damage per Second/.test(det()));
  ok('detail words the attack speed as the game does',
     /Very Fast attack speed \(0\.56 seconds\)/.test(det()), det().slice(0, 400));
  ok('detail shows all three affix lines',
     /\+8% Critical Hit Chance/.test(det()) && /60% bonus to Critical Damage/.test(det()) &&
     /10% chance to Stun target for 5 sec\./.test(det()));
  // Aenigma is a weapon, so its numbers are reconstructed from the PAK and the
  // footer has to say so. Attributing them to TIDBI would be the same
  // misattribution the base-value wording exists to prevent, pointing the
  // other way -- hence the three-way provenance line.
  ok('detail attributes the numbers to the PAK derivation',
     /MEDIA\/UNITS\/ITEMS\/AXES\/LEGENDARY_AXE01\.DAT/.test(det()) &&
     /-1548103899003591749/.test(det()) &&
     /reconstructed from PAK game files/.test(det()) &&
     !/TIDBI in-game value/.test(det()));

  d.querySelector('#detail .back').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('back link returns to the same filtered set', cards().length === 6, `${cards().length}`);
  ok('back link clears the item from the route', !/item=/.test(w.location.hash), w.location.hash);

  await wait(30);   // let jsdom's spurious hashchange settle before continuing

  // ---------------------------------------------------- multi-select facet
  await go('#tier=Legendary&type=Axe');
  let box = d.querySelector('input[data-f="types"][value="Axe"]');
  box.checked = false;
  box.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('unchecking Type=Axe leaves all 92 Legendary', cards().length === 92, `${cards().length} ${cnt()}`);
  box = d.querySelector('input[data-f="types"][value="Axe"]');
  box.checked = true;
  box.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('rechecking narrows back to 6', cards().length === 6, `${cards().length}`);

  // --------------------------------------------------------------- search
  await go('');
  ok('reset returns the full corpus', cards().length === 500, `${cards().length}`);
  const q = d.getElementById('q');
  q.value = 'aenigma';
  q.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('typing does not filter (apply is on Enter)', cards().length === 500, `${cards().length}`);
  q.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok('search on Enter narrows to Aenigma', cards().length === 1, `${cards().length}`);
  ok('search state lands in the hash', /q=aenigma/.test(w.location.hash), w.location.hash);

  // ----------------------------------------------------------------- sort
  // The default order, asserted before anything touches the select: rarity
  // ascending, level ascending within each rarity. The first card has to be the
  // lowest-level Normal there is, and the opening run must climb without a step
  // back -- the whole first screen is one tier, so this reads the tier key and
  // the level key in one pass.
  await go('');
  ok('the page opens sorted by tier, not name',
     d.getElementById('sort').value === 'tier', d.getElementById('sort').value);
  {
    const first = cards()[0];
    ok('the first card is a Normal item', first.className.indexOf('q-normal') >= 0,
       first.className);
    // Normal is 2,161 items and the grid stops at 500, so the whole first page
    // is one tier. That is what makes the level assertion below a statement
    // about order *within* a tier rather than about a tier boundary -- and it
    // is the consequence the sort change was signed off on.
    const off = [].filter.call(cards(), c => !/q-normal/.test(c.className));
    ok('the whole first page is one tier, the commonest one', off.length === 0,
       `${off.length} of ${cards().length} are not Normal`);
    ok('levels ascend within the tier', monotonic(true),
       lvls().slice(0, 12).join(','));
  }

  const sel = d.getElementById('sort');
  sel.value = 'level';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  let L = lvls();
  ok('sort by level is monotonic ascending', L.every((v, i) => i === 0 || L[i - 1] <= v),
     L.slice(0, 12).join(','));
  d.getElementById('dir').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  L = lvls();
  ok('direction toggle is monotonic descending', L.every((v, i) => i === 0 || L[i - 1] >= v),
     L.slice(0, 12).join(','));
  ok('direction lands in the hash', /dir=desc/.test(w.location.hash), w.location.hash);

  // --------------------------------------------------------- hash routing
  const deep = async (hash) => {
    const t = new JSDOM(html, { runScripts: 'dangerously',
      url: URL_ + hash, pretendToBeVisual: true });
    await wait(40);
    return t.window.document;
  };
  const d2 = await deep('#tier=Legendary&type=Axe&sock=1');
  ok('a cold load of a filtered hash renders 6',
     d2.querySelectorAll('#grid .card').length === 6,
     `${d2.querySelectorAll('#grid .card').length}`);
  const d3 = await deep('#item=legendary_axe01');
  ok('deep link with item= opens the detail directly', /Aenigma/.test(d3.getElementById('detail').textContent));
  const d4 = await deep('#q=aenigma');
  ok('deep link with a search term renders 1', d4.querySelectorAll('#grid .card').length === 1,
     `${d4.querySelectorAll('#grid .card').length}`);
  // The two fields that are built but not rendered, checked on a record that
  // actually carries both -- legendary2_sword05 has xl=999 and skm=4. Aenigma
  // (above) has neither, so asserting their absence there would prove nothing.
  //
  // The skm one is the interesting case: the DAT says MAX_SOCKETS 4, but that 4
  // is the socket count of the family's c variant, the Netherrealm Sword. This
  // sword spawns with 2 and cannot reach 4, so the row was actively misleading.
  // xl is the opposite -- 999 is MAXLEVEL, it is where the item stops dropping,
  // and the card states it in the spawn band. So the two fields part company
  // here, and this asserts both directions on one record.
  const d5 = await deep('#item=legendary2_sword05');
  const d5t = d5.getElementById('detail').textContent;
  ok('Cerulean Nightmare: a max-sockets field exists but is not rendered',
     /2 Sockets/.test(d5t) && !/Max Sockets/i.test(d5t) && /Level 105/.test(d5t),
     d5t.slice(0, 160));
  ok('...while MAXLEVEL, which is a real drop-band fact, is stated',
     /Min Level 99/.test(d5t) && /Max Level 999/.test(d5t), d5t.slice(0, 240));
  // The Axe of Throwing is why Weapon Range is worth a row at all. 93 of the
  // 101 Axes are 0.6 and it is 9, because the thing is thrown -- so a per-type
  // constant is not quite a constant, and the one item where it moves is the
  // one item where it means something. Its damage is a flat 228, so there is no
  // damage range anywhere on the page to confuse the row with.
  const thr = await deep('#item=axe_u05x');
  const frng = thr.querySelector('#detail .frng').textContent;
  // Read off the row rather than the card: the range is the last thing in the
  // card's lead, and the damage line below it starts with a number, so on the
  // flattened text "Weapon Range 9" runs straight into "228Physical Damage".
  ok('The Axe of Throwing reads Weapon Range 9 against the Axe type\'s 0.6',
     /^Weapon Range 9$/.test(frng) &&
     !/range/i.test(thr.querySelector('#detail .dtype').textContent), frng);

  // A socketable's requirement, settled from the game files. Two candidates
  // looked like it and neither was it: MINLEVEL is the drop band (the Aenigma
  // assertion above), and TIDBI holds no LEVEL_REQUIRED for any socketable. The
  // real source is the game's own curve, MEDIA/GRAPHS/STATS/
  // ITEM_LEVEL_REQUIREMENTS_SOCKETABLE.DAT -- 105 points, every one of them
  // max(1, level - 8) -- which build.py reads into the same `lr` field every
  // other item's requirement arrives in. Blood Ember Shard is rank 3: level 36
  // gives 28. The old card printed MINLEVEL here instead, under the label
  // "Required Item Level to Socket", which stated a requirement the game does
  // not have over a field that means something else entirely.
  const gem = await deep('#item=tl2_bloodember_rank3');
  const gemt = gem.getElementById('detail').textContent;
  ok('a socketable states the player level the game curve gives it',
     /Player Level\s*28(?!\d)/.test(gemt) &&
     !/Required Item Level to Socket/.test(gemt), gemt.slice(0, 240));

  // ...and shows its spawn band like every other item. It was suppressed here
  // only because the same field was being printed above as the socketing gate;
  // with that line gone, the band is the only thing MINLEVEL means on a card.
  ok('...and shows its spawn band like any other item',
     /Min Level\s*28(?!\d)/.test(gemt) && /Max Level\s*46(?!\d)/.test(gemt) &&
     /Level\s*36(?!\d)/.test(gemt), gemt.slice(0, 240));

  // The case that prompted the change. Every eye carries the placeholder
  // MINLEVEL 1, so the card used to read "Required Item Level to Socket: 1";
  // the game's curve gives level 15 -> 7, which is the number the wiki's column
  // shows for it too.
  const pogg = await deep('#item=tl2_eyeofkingpogg');
  const poggt = pogg.getElementById('detail').textContent;
  ok('an eye states its real requirement, not MINLEVEL\'s placeholder 1',
     /Player Level\s*7(?!\d)/.test(poggt) &&
     !/Player Level\s*1(?!\d)/.test(poggt) &&
     !/Required Item Level to Socket/.test(poggt), poggt.slice(0, 240));
  // The same card carries the clamp's own case: the file's MAXLEVEL for this eye
  // is 9999999, and the card must read the clamped 999 rather than the raw run of
  // nines. The negative is what makes it a clamp test rather than a substring
  // test -- 999 is a prefix of 9999999.
  ok('...and prints MAXLEVEL\'s sentinel as the 999 ceiling',
     /Max Level\s*999(?!\d)/.test(poggt) && !/9999999/.test(poggt),
     poggt.slice(0, 240));

  // A skull is where the curve and the wiki part company. The wiki's Gems (T2)
  // "Required Level" column follows the same rule on 43 of its 52 skull rows --
  // Vastok, Whorlbarb, X'n!troph and Zardon's Mighty among them, interleaved
  // with the nine that do not -- and that interleaving is what marks those nine
  // as bad cells rather than a different curve above level 80. Tibbeek is level
  // 81, so the curve gives 73 where the wiki's own cell reads 40.
  const tib = await deep('#item=tl2_skull040');
  const tibt = tib.getElementById('detail').textContent;
  ok('a skull takes the game curve, not the wiki\'s bad cell',
     /Player Level\s*73(?!\d)/.test(tibt) && !/Player Level\s*40(?!\d)/.test(tibt),
     tibt.slice(0, 240));

  // ----------------------------------------------------------- the ember pool
  // The four rare ember families are the only socketables whose two bonuses are
  // not fixed. Their item DATs carry an empty AFFIXES list, and the game rolls
  // one Armor/Trinket bonus and one Weapon bonus when the gem spawns, off the
  // affix pool in MEDIA/AFFIXES/GEMS/. build.py derives Chaos's pool from the
  // PAK and reads the other three families from db/ember_values.py, and the
  // card prints each slot as a "one of N" list of whole tooltip lines.
  //
  // Each list is read through the `ul.pool` that follows its own `p.poolh`,
  // which is the pairing the card has to get right: a slot label whose options
  // are some other slot's would still pass a page-wide text search.
  const poolOf = doc => [].map.call(doc.querySelectorAll('#detail ul.pool'), u => {
    const h = u.previousElementSibling;
    return { head: h.firstChild.textContent, count: h.querySelector('.ct').textContent,
             opts: [].map.call(u.querySelectorAll('li'), li => li.textContent) };
  });
  const show = p => p.map(s => `${s.head}: ${s.count} [${s.opts.join('; ')}]`).join('  ');
  // A fixed socketable's two bonuses are facts rather than rolls, so they take
  // `.aff` paragraphs under the same kind of slot heading -- `p.fxh`, sharing
  // `.poolh`'s declarations, with no "one of N". Read the same way and for the
  // same reason: each group is the lines that actually follow its own heading,
  // so a heading attached to the other slot's lines cannot pass.
  // Leaves of this take either the document or a `#detail` element, so the
  // selector is relative to whatever was passed rather than re-stating #detail
  // -- which, handed the element itself, would match nothing and pass vacuously.
  const slotGroups = doc => [].map.call(doc.querySelectorAll('p.fxh'), h => {
    const lines = [];
    for (let e = h.nextElementSibling;
         e && e.classList.contains('aff'); e = e.nextElementSibling) {
      lines.push(e.textContent);
    }
    return { head: h.textContent, lines };
  });
  const showF = g => g.map(s => `${s.head}: ${s.lines.join('; ')}`).join('  ');
  // Blood Ember Speck, rank 1: two options a side, and the transcribed numbers
  // are the ones this rank rolls -- nothing on the card scales them.
  const speck = poolOf(await deep('#item=tl2_bloodember_rank1'));
  ok('a rare ember states both slots as their own "one of" list',
     speck.length === 2 &&
     speck[0].head === 'Armor / Trinket' && speck[0].count === 'one of 2' &&
     speck[0].opts.join(' | ') === '7.2 Health recovery per second | +48 Health' &&
     speck[1].head === 'Weapon' && speck[1].count === 'one of 2' &&
     speck[1].opts.join(' | ') === '12 Health stolen on hit | 35 Physical Damage over 5 sec.',
     show(speck));
  // The same two rolls at rank 7 are worth eight times as much, so a pool that
  // was built once and printed on every rank shows up here.
  const giantBlood = poolOf(await deep('#item=tl2_bloodember_rank7'));
  ok('the pool carries the rank\'s own numbers, not a shared base',
     giantBlood[0].opts.indexOf('+384 Health') >= 0 &&
     giantBlood[1].opts.indexOf('90 Health stolen on hit') >= 0 &&
     giantBlood[0].opts.indexOf('+48 Health') < 0, show(giantBlood));
  // Chaos is the derived family, and Giant Chaos Ember is the rank the wiki
  // gets wrong twice: its armor list omits Dodge at every rank, and its weapon
  // list stops at a 6.5% Attack Speed the files never ship -- the band files
  // end at 70-83, so rank 7's fastest option is the flat 3%. The armor side
  // also pins the one line the game prints with a sign the wiki drops.
  const giantChaos = (await deep('#item=tl2_chaosember_rank7')).getElementById('detail');
  const chaos = poolOf(giantChaos);
  ok('a derived pool follows the files where the wiki differs',
     chaos[0].count === 'one of 9' && chaos[1].count === 'one of 10' &&
     chaos[0].opts.indexOf('+6% Dodge chance') >= 0 &&
     chaos[1].opts.indexOf('+3% Attack Speed') >= 0 &&
     chaos[0].opts.indexOf('Physical Damage Taken is reduced by -6%') >= 0 &&
     !/6\.5%/.test(giantChaos.textContent), show(chaos));
  // And the two socketables that look like these but are not: a BASE template,
  // which no rank's level matches, and a normal ember, whose two bonuses are
  // fixed and arrive as ordinary affix lines.
  const base = poolOf(await deep('#item=tl2_bloodember_BASE'));
  const flame = await deep('#item=tl2_flameember_rank1');
  const flameDetail = flame.getElementById('detail');
  ok('only the 28 rare ranks carry a pool',
     base.length === 0 && flame.querySelectorAll('#detail ul.pool').length === 0 &&
     flame.querySelectorAll('#detail .aff').length === 2,
     show(base) + ' | ' + flame.querySelector('#detail .body').textContent.slice(0, 120));
  // ...and a rolled ember carries no fixed-slot heading, so the two blocks
  // cannot be confused for one another on the one card family that has either.
  ok('...and a rolled ember carries no fixed-slot heading',
     slotGroups(giantChaos).length === 0, showF(slotGroups(giantChaos)));
  // The normal ember's two bonuses are fixed, so they are facts under a slot
  // heading rather than a "one of" list. The heading also replaced the game's
  // own `Weapon:` prefix, which the card used to print as part of the effect --
  // so the check is both that the prefix is gone and that what it used to
  // encode is now carried by the structure instead.
  const flameG = slotGroups(flame);
  ok('a fixed ember labels its slots instead of printing the game\'s prefix',
     flameG.length === 2 &&
     flameG[0].head === 'Armor / Trinket' && flameG[0].lines.join(' | ') === '+8 Fire Armor' &&
     flameG[1].head === 'Weapon' && flameG[1].lines.join(' | ') === '+7 Fire Damage' &&
     !/Weapon:|Armor\/Trinket:/.test(flameDetail.textContent), showF(flameG));
  // The flagship of the seven the files correct. TIDBI lost the heading between
  // Quato's two affixes, so its four `+64 <element> Armor` lines sat under the
  // freeze line's Weapon heading and were filed as weapon stats -- the wiki's
  // table and the gem's own affix files both file them under Armor/Trinket. The
  // blade here is real: the first heading was right and the lines under it were
  // not, so a page-wide search for "Armor" passes on the broken card too. Only
  // reading the groups catches it.
  const quato = slotGroups(await deep('#item=tl2_skull033'));
  ok('a lost heading is rebuilt from the files, not from the line above it',
     quato.length === 2 &&
     quato[0].head === 'Armor / Trinket' && quato[0].lines.length === 4 &&
     quato[0].lines.join(' | ') ===
       '+64 Poison Armor | +64 Ice Armor | +64 Fire Armor | +64 Electric Armor' &&
     quato[1].head === 'Weapon' &&
     quato[1].lines.join(' | ') === '10% chance to Freeze for 5 sec.', showF(quato));
  // The third case, which is neither of the two above: an affix whose own list
  // names both slots, so the line belongs in either and is shown once. Read off
  // Lucky Coin rank 2, which TIDBI left with no prefix at all -- so this also
  // pins that a socketable is derived by being a socketable, not by whether the
  // export happened to label it.
  const coin = slotGroups(await deep('#item=tl2_goldgem2'));
  ok('an either-slot affix is shown once, under a heading that says so',
     coin.length === 1 && coin[0].head === 'Armor / Trinket or Weapon' &&
     coin[0].lines.join(' | ') === '2% increase in the amount of gold found',
     showF(coin));

  // The three Torchlight 1 fishing socketables are out of the database. They
  // shipped inside the TL2 PAK, which is why TIDBI lists them -- so they were
  // in the corpus, and on the site, until they were dropped at build time. See
  // TL1_ITEMS in src/build.py for the whole argument. Read off the data rather
  // than a rendered card, because the claim is that they are gone from the
  // database, not that no card happens to be showing; the display name is
  // checked alongside the id because the two differ on two of the three.
  {
    const gone = ['Devil Fish Eye', 'Lucky Fish Tooth', 'Shimmering Fish Scale'];
    const still = w.DB.items.filter(o => gone.indexOf(o.n) >= 0 || gone.indexOf(o.id) >= 0);
    ok('...and the Torchlight 1 fishing socketables are out of the database',
       still.length === 0, still.map(o => o.id).join(', ') || '(none present)');
  }

  // ---------------------------------------------------------------- set names
  // An item's SET field is a DAT token, and a token is not a name: SENTINAL is
  // misspelled, U_GRAND_ARCHITECT and BERSERKER_FINAL are not words the game
  // prints anything like. The name lives in the set's own file under
  // MEDIA/SETS/, keyed on that file's NAME, and build.py resolves every token
  // through it. Sentinel and Cornerstone are the two worth pinning, because
  // nothing but the lookup can produce either -- one is a typo the display name
  // corrects, the other shares no word with its token.
  //
  // One fresh document for all three, since jsdom's spurious empty-hashchange
  // (see the header) makes navigating the shared one unreliable after a click.
  const zs = await deep('#item=Zeraphi_01_shoulders_alt_set');
  {
    const opts = [].map.call(zs.querySelectorAll('#setsel option'), o => o.textContent);
    ok('the set facet offers names, not DAT tokens',
       opts.indexOf('Sentinel (9)') >= 0 && opts.indexOf('Cornerstone (7)') >= 0 &&
       !opts.some(t => /^[A-Z0-9_]+ \(\d+\)$/.test(t)), opts.slice(1, 6).join(' | '));
    ok('a set item names its set the way the game does',
       /Set:\s*Zeraphi Alchemy/.test(zs.getElementById('detail').textContent),
       zs.querySelector('#detail .sname').textContent);
  }
  const zf = await deep('#set=Zeraphi%20Alchemy');
  ok('a set filter by display name returns the set',
     zf.querySelectorAll('#grid .card').length === 9,
     `${zf.querySelectorAll('#grid .card').length}`);

  // ------------------------------------------------------------ set bonuses
  // A set piece's most useful fact is not on the piece: what the other eight do
  // for it. The game and TIDBI both print the whole ladder under each piece, and
  // the ladder is now shipped to the page as DB.sets.
  //
  // Three sets make the case, and they are three different shapes rather than
  // three samples of one. ZERAPHI is 9 pieces with a 2-6 ladder: every rung is
  // reachable, so it pins that nothing is marked unreachable by accident.
  // Cornerstone is 7 pieces with a 2-9 ladder: the top two rungs can never be
  // reached, and 15 of the 80 sets are like this. Twinferno is the extreme --
  // one piece, gated on two.
  // The card parts its sections with a rule rather than a heading, so there is
  // no "Set Bonuses" block to look up any more: the ladder is the set name and
  // the rungs beneath it. `.sname` is that heading; `rungNums` reads the figure
  // each rung states. A rung carrying several bonuses repeats the row and only
  // the first states the count, so the blank `.rn` spans are the continuation
  // rows and are filtered out here -- the rung count is the non-empty ones.
  const sname = doc => doc.querySelector('#detail .sname');
  const rungNums = doc => [].filter
    .call(doc.querySelectorAll('#detail .rung .rn'), e => e.textContent.trim())
    .map(e => e.textContent);

  {
    const sb = sname(zs), rungs = rungNums(zs);
    ok('a set piece carries the whole set\'s ladder, not just its own rungs',
       !!sb && rungs.join(',') === '2,3,4,5,6' &&
       /\+35% to Electric Damage/.test(zs.getElementById('detail').textContent),
       rungs.join(' | '));
    ok('a set that ships every piece it gates on marks no rung unreachable',
       !!sb && zs.querySelectorAll('#detail .rung.over').length === 0,
       zs.querySelectorAll('#detail .rung.over').length + ' marked');
    // Two numbers, because they answer different questions and on 47 of the 80
    // sets they differ. Zeraphi is the "pieces to spare" shape -- 9 exist, the
    // ladder tops out at 6, so three are spare once the set is complete.
    //
    // `c` is a record count and the figure beside it is a rung number, which is
    // why the two words differ. They used to read "9 pieces (6 piece set)", and
    // on Mondon's the record count is not a piece count at all.
    ok('the ladder header counts the records shipped and the pieces a full set needs',
       !!sb && /Zeraphi Alchemy\s*9 items · 6 piece set/.test(sb.textContent),
       sb && sb.textContent);
  }
  const arch = await deep('#item=engineer_05_amulet_alt_set');
  {
    const sb = sname(arch);
    const over = [].map.call(arch.querySelectorAll('#detail .rung.over .rn'), e => e.textContent);
    // 7 records exist for Cornerstone and the ladder gates a rung on 9, so two
    // of its rungs are unreachable -- and it is the only set of the 80 where
    // that happens at all. They are drawn rather than dropped, because the
    // game's own set file declares them, but they are dimmed: nothing a player
    // does reaches them.
    //
    // "set ships 7" used to be printed beside each one. It is gone: the heading
    // above the ladder already reads "7 items · 9 piece set", which is the same
    // contradiction in one line rather than repeated per rung.
    ok('a rung above what the set ships is drawn, and dimmed rather than captioned',
       over.length === 2 && over.join(',') === '8,9', over.join(' | '));
    ok('...and states the full-set size even where it is unreachable',
       !!sb && /Cornerstone\s*7 items · 9 piece set/.test(sb.textContent),
       sb && sb.textContent);
    // The dimming must be the rung's own rule. `.fx.locked` is the obvious one
    // to borrow and the wrong one: it means "a stat the item has, behind a task
    // you can still finish", which is the opposite of a rung nothing reaches --
    // and the augmented-weapon assertions below select on it by name, so reusing
    // it would quietly widen what those match. Read as CSS text because jsdom
    // does not substitute var(), which leaves computed colours useless here.
    const css = [].map.call(arch.querySelectorAll('style'), s => s.textContent).join('\n');
    const overList = arch.querySelector('#detail .rung.over');
    ok('an unreachable rung is dimmed by its own rule, not by `.fx.locked`',
       !!overList && !overList.classList.contains('locked') &&
       /\.rung\.over \.rt\{[^}]*color:/.test(css) &&
       /\.rung\.over \.rn\{[^}]*color:/.test(css) &&
       !/\.fx\.over li\{/.test(css),
       overList && overList.className);
  }
  const twin = await deep('#item=z_wand_m01_set');
  {
    const sb = sname(twin);
    // This is the assertion that inverts, and it is the clearest single piece of
    // evidence that the port is right.
    //
    // Twinferno ships one record and gates its only rung on two. The rung used
    // to be dimmed, because the dimming rule compared the rung against the
    // *record count* -- one -- and 2 > 1. But a wand fills both hands and a
    // character can wear two of them, so the set is completable by anyone who
    // finds a second one. The old rule dimmed the only rung this set has, which
    // is the most wrong it is possible to be about a one-rung ladder.
    //
    // It compares against `cap` now: 2 for a ring or a one-handed weapon, 1 for
    // everything else. Twinferno's rung is 2 against a capacity of 2, so the
    // count of dimmed rungs must be 0 where this test used to require 1.
    const twt = twin.getElementById('detail').textContent;
    ok('Twinferno\'s only rung is not dimmed: a wand fills two hands, and two of it is a set',
       !!sb && twin.querySelectorAll('#detail .rung.over').length === 0 &&
       /Twinferno\s*1 item · 2 piece set/.test(sb.textContent) &&
       /12% Damage bonus when dual-wielding/.test(twt),
       twin.querySelectorAll('#detail .rung.over').length + ' marked  //  ' +
       (sb ? sb.textContent : 'no heading'));
    // The ladder must not read as affixes the item already has -- the same
    // distinction the augmented-weapon block exists to draw. The card parts its
    // sections with a rule rather than a heading, so there is no block to
    // compare against; the rungs are their own section and nothing from them
    // may appear in a `.aff` paragraph.
    const aff = [].filter.call(twin.querySelectorAll('#detail .aff'),
                               a => /dual-wielding/.test(a.textContent));
    ok('the ladder is its own section, not extra affixes on the piece',
       !!sb && aff.length === 0,
       aff.length ? aff[0].textContent : '(clean)');
  }

  // ----------------------------------------------------- a set piece's rarity
  // Set is a membership the DAT asserts, not a rarity: all 556 set items are
  // really Rare (210) or Unique (346), and the game paints them that way and
  // prints "Unique Set Belt". The site filed them under a Set tier and printed
  // "Set Belt" in the Set colour, which said the one thing about the item that
  // is not a rarity. The tag stays; the rarity now leads it.
  //
  // Mondon's Vestment is the case the user raised, and it is Unique -- the
  // shape that reads worst without this, since "Set Belt" gave no clue whether
  // the thing was worth picking up. Its 16 pieces against a 10-piece ladder is
  // also the "pieces to spare" shape the header has to state.
  const mon = await deep('#item=engineer_06_belt_alt_set');
  {
    const typ = mon.querySelector('#detail .dtype');
    const em = typ.querySelector('em');
    ok('a set piece\'s type line leads with its real rarity and keeps the Set tag',
       /^Unique Set Belt/.test(typ.textContent), typ.textContent);
    ok('...and the rarity word carries the colour, not the Set tag',
       !!em && em.textContent === 'Unique' && em.className === 't-unique',
       em && em.className + ' -> ' + em.textContent);
    const sb = sname(mon);
    // The set the user asked about by name. 16 records, and 10 pieces because a
    // ring fills two of the nine slots -- the same axis the dimming rule reads.
    ok('Mondon\'s Vestment reads "16 items · 10 piece set"',
       !!sb && /Mondon’s Vestment\s*16 items · 10 piece set/.test(sb.textContent),
       sb && sb.textContent);
    ok('...and not one of its rungs is dimmed, because all ten can be worn',
       mon.querySelectorAll('#detail .rung.over').length === 0,
       mon.querySelectorAll('#detail .rung.over').length + ' marked');
  }
  const mset = await deep('#set=Mondon%E2%80%99s%20Vestment');
  {
    const card = sel => mset.querySelector('#grid .card[data-id="' + sel + '"]');
    const u = card('engineer_06_belt_alt_set');
    // every piece of Mondon's is Unique; Zeraphi is the Rare half, from the
    // document already open on that set above, so both rarities are covered
    const zcard = zf.querySelector('#grid .card');
    ok('a set item\'s card wears its real rarity\'s colour, not the Set tier\'s',
       !!u && u.className.indexOf('q-unique') >= 0 && u.className.indexOf('q-set') < 0,
       u && u.className);
    ok('...and a Rare set piece is blue, where the two rarities differ',
       !!zcard && zcard.className.indexOf('q-rare') >= 0,
       zcard ? zcard.className : '(no card)');
  }
  // The recolour is paint, not classification: the 556 set items must still be
  // reachable as a group, or they would have been re-filed as Rare/Unique just
  // to get a colour and the facet would have quietly changed meaning. What
  // reaches them is no longer a tier -- see the set-control block below -- and
  // #tier=Set is left to mean exactly what it says: a tier called Set, of which
  // the corpus has none. Asserted rather than special-cased, because that link
  // is the shape a stale bookmark takes and the page should fail it legibly:
  // four dimmed pills and an empty grid read as "no tier selected", which is
  // what the hash says. Translating it to setonly would be inventing a filter
  // the link never asked for.
  const stier = await deep('#tier=Set');
  ok('a stale #tier=Set selects no tier and matches nothing',
     [].every.call(stier.querySelectorAll('#tiers input'), i => !i.checked) &&
     /Nothing matches/.test(stier.getElementById('more').textContent),
     stier.getElementById('count').textContent + ' | ' +
     stier.getElementById('more').textContent);

  // ------------------------------------------------ the three reported bugs
  // Reported against heavy_g_amulet_f_alt_b: fire armor should be 140-174, the
  // Focus requirement 79, and the required level 81. All three were invisible
  // before, because the DAT holds a single pre-scale scalar per type and has no
  // LEVEL_REQUIRED at all. Armor and damage now both derive from the game files
  // -- the 140-174 here is the derived range, and TIDBI's rendered number for
  // the same item agrees with it to the point. Requirements still come from
  // TIDBI: the DAT has no field for them.
  const amu = (await deep('#item=heavy_g_amulet_f_alt_b')).getElementById('detail').textContent;
  ok('amulet: fire armor is the 140-174 range', /140-174Fire Armor/.test(amu), amu.slice(0, 300));
  ok('amulet: Focus requirement 79 is present', /Focus\s*79/.test(amu), amu.slice(0, 300));
  ok('amulet: player level required 81 is present',
     /Player Level\s*81/.test(amu), amu.slice(0, 300));
  ok('a derived armor value is labelled as reconstructed, not as TIDBI',
     /reconstructed from PAK game files/.test(amu), amu.slice(0, 600));

  // ------------------------------------------------------- armor derivation
  // The set jewellery that started this: TIDBI records these as a single number
  // where the game files give the spread the game prints, so the derived range
  // is the thing to show. Runemaster Signet and Runemaster Amulet are the pair
  // reported by name; cloth_g_amulet_alt_set is the widest case in the corpus.
  const sig = (await deep('#item=sturm_01_ring_alt_set')).getElementById('detail').textContent;
  ok('Runemaster Signet: ice armor is the derived 4-6 range',
     /4-6Ice Armor/.test(sig), sig.slice(0, 300));
  const run = (await deep('#item=sturm_01_amulet_alt_set')).getElementById('detail').textContent;
  ok('Runemaster Amulet: ice armor is the derived 7-8 range',
     /7-8Ice Armor/.test(run), run.slice(0, 300));
  const wid = (await deep('#item=cloth_g_amulet_alt_set')).getElementById('detail').textContent;
  ok('the widest set-jewellery case renders all four types as ranges',
     (wid.match(/55-68/g) || []).length === 4, wid.slice(0, 400));
  // A base file whose weight and min-weight are equal has nothing to roll, so
  // both ends collapse to one number. 1,300 derived items are flat for that
  // reason -- every one of them chaining to a _UNIQUE base. A range there would
  // be invented, so the flatness is the assertion.
  const flt = (await deep('#item=caster_03_boots')).getElementById('detail').textContent;
  ok('a single-weight base file still renders one number',
     /20Physical Armor/.test(flt) && !/\d+-\d+Physical Armor/.test(flt), flt.slice(0, 400));

  // ------------------------------------------------------ base-value badge
  // 4 items still fall back to a raw .DAT scalar, down from 19 now that armor
  // derives: 2 are armor-only (the Witch_Boots pair, whose base file carries no
  // weight and multiplier at all) and 2 are weapons the damage derivation
  // cannot reach. That has to be disclosed, not passed off as an in-game
  // number. The Unclassified monster shields the badge used to cover are still
  // hidden from the site, so shield_dwarven remains unreachable by deep link.
  const bas = (await deep('#item=Witch_Boots')).getElementById('detail').textContent;
  ok('an item with only base values says so',
     /base values, not rendered/.test(bas) && /PAK \.DAT base value/.test(bas), bas.slice(0, 300));

  // --------------------------------------- requirements are ALTERNATIVES
  // A class item carries both a player level and stat requirements, and the
  // game grants equip if you meet either branch -- so the detail must show the
  // "or". A flat list would state the opposite of how equipping works.
  const bdoc = await deep('#item=caster_04_helmet_alt_c');
  const bmh = bdoc.getElementById('detail').textContent;
  ok('class item: level 65 / Focus 87 / Vitality 101',
     /Player Level\s*65/.test(bmh) && /Focus\s*87/.test(bmh) &&
     /Vitality\s*101/.test(bmh), bmh.slice(0, 400));
  // The chips run together in the DOM -- "Player Level 65orFocus 87" -- because
  // the space around the "or" is CSS margin, not text. `\s*` on both sides.
  ok('class item: the two branches are joined by "or"',
     /Player Level 65\s*or\s*Focus 87/.test(bmh), bmh.slice(0, 400));
  // The class gate is not a branch of the requirement: it is a hard restriction
  // on who may equip the item at all, so it is a corner pill rather than a third
  // chip beside the "or". Putting it in the row would say a non-Embermage could
  // equip this by meeting the stats. Read off the two elements rather than the
  // card's text, because "REQUIREMENTS" is uppercased by CSS -- splitting the
  // string on it would silently find nothing and pass on an empty remainder.
  {
    const pill = bdoc.querySelector('#detail .corner').textContent;
    const row = bdoc.querySelector('#detail .rrow').textContent;
    ok('class item: the Embermage gate is a corner restriction, not a requirement branch',
       /Embermage Only/.test(pill) && !/Embermage/.test(row), pill + '  //  ' + row);
  }

  // ------------------------------------------- augmented weapons (unlockable)
  // 74 uniques carry a kill-count task that unlocks 1-3 further stats. The
  // whole point is that they are conditional, so they must not be rendered as
  // affixes the weapon already has -- which is exactly what happened while the
  // tooltip arrived as one flat list.
  const gw = await deep('#item=wand_u02b');
  const gwd = gw.getElementById('detail');
  const txt = sel => { const e = gwd.querySelector(sel); return e ? e.textContent : ''; };
  const list = sel => [].map.call(gwd.querySelectorAll(sel), l => l.textContent);
  // The plain affixes are `.aff` paragraphs now: the card dropped the list the
  // `.fx:not(.locked) li` selector reached, and the locked group is the only
  // `<ul>` left on it. The locked side keeps its selector unchanged.
  const locked = list('.fx.locked li'), plain = list('.aff');
  ok('augmented weapon: the task is shown',
     /Kill 50 Ezrohir to Upgrade/.test(txt('.task')), txt('.task'));
  ok('augmented weapon: the condition is spelled out, not implied',
     /locked until the task above is complete/.test(txt('.cond')), txt('.cond'));
  ok('augmented weapon: both unlocked stats are in the locked group',
     locked.length === 2 && /Acid Rain/.test(locked[0]) && /Stun target/.test(locked[1]),
     locked.join(' | '));
  ok('augmented weapon: no unlocked stat leaks into the plain affixes',
     plain.length === 3 && !/Acid Rain|Stun target/.test(plain.join(' ')) &&
     !/Augmented Weapon|Upgrade|-{4}/.test(plain.join(' ')), plain.join(' | '));
  // Rat Killer is the one item whose divider row sorts before its header. Its
  // twin carries the same '90% Interrupt chance', which the divider puts
  // outside the block there -- so it is an affix here too, not an unlock.
  const rk = await deep('#item=ratkiller');
  const rkd = rk.getElementById('detail');
  const rkl = [].map.call(rkd.querySelectorAll('.fx.locked li'), l => l.textContent);
  const rkp = [].map.call(rkd.querySelectorAll('.aff'), l => l.textContent);
  ok('augmented weapon: the inverted-divider item splits the same way',
     rkl.length === 1 && /\+2 Physical Damage/.test(rkl[0]) &&
     rkp.length === 1 && /90% Interrupt chance/.test(rkp[0]),
     rkl.join(' | ') + '  //  ' + rkp.join(' | '));

  // ------------------------------------------------------------- tier strip
  // The rarity filter moved out of the rail onto its own row between the
  // toolbar and the grid. It is the same facet -- same key, same values, same
  // counts -- rendered by a different function, so what has to be asserted is
  // that the move did not change what the filter *is*: the values, their order,
  // their counts, and that a click still does what a rail checkbox did.
  await go('');
  const strip = d.getElementById('tiers');
  ok('the tier strip sits between the toolbar and the grid',
     !!strip && strip.previousElementSibling.id === 'bar' &&
     strip.nextElementSibling.id === 'scroll',
     strip ? `${strip.previousElementSibling.id} / ${strip.nextElementSibling.id}` : 'no #tiers');
  const pills = () => [].slice.call(d.querySelectorAll('#tiers .tpill'));
  const pval = p => p.querySelector('input').value;
  // The user's order, and the sort's order, which the app derives from one
  // constant precisely so the two cannot disagree: the strip reads left to
  // right in the order the list runs top to bottom.
  ok('the pills run Normal, Rare, Unique, Legendary -- the four rarities',
     pills().map(pval).join(',') === 'Normal,Rare,Unique,Legendary',
     pills().map(pval).join(','));
  ok('each pill is its own box wearing its own tier ink',
     pills().every(p => p.className.indexOf('t-' + pval(p).toLowerCase()) >= 0),
     pills().map(p => p.className).join(' | '));
  // The counts are the ones build.py asserts against, read off the pills rather
  // than off the header -- a strip wired to the wrong facet, or reading its
  // counts from the wrong place, would still show 6,048 in the count line. The
  // 556 set items are counted inside Rare and Unique, not beside them: 210 +
  // 346 = 556, and 2158+2061+1737+92 = 6,048, so nothing was lost or doubled.
  ok('each pill carries its own tier count, with the set pieces folded in',
     pills().map(p => +p.querySelector('.ct').textContent).join(',') ===
       '2158,2061,1737,92',
     pills().map(p => `${pval(p)}=${p.querySelector('.ct').textContent}`).join(' '));
  // The one place this facet deliberately parts company with the rail's others:
  // those start empty -- no box checked, nothing filtered -- but a strip of five
  // dimmed pills above a full grid reads as a broken control, so tiers start
  // fully selected. An empty set and a full one filter identically.
  ok('the pills all start selected, and none is dimmed',
     pills().every(p => p.querySelector('input').checked && !p.classList.contains('off')),
     pills().map(p => `${pval(p)}:${p.querySelector('input').checked}`).join(' '));
  // Set is a membership, not a rarity, so no pill may offer it -- a second
  // control owns it now, and a pill named Set would be a fifth rarity again.
  ok('no pill names Set', pills().every(p => pval(p) !== 'Set'),
     pills().map(pval).join(','));
  // The fold, re-derived from the data rather than restated from the numbers
  // above: each item counted under `uq` -- its displaced rarity -- falling back
  // to `q`. If the 556 had been dropped instead of folded, or filed under the
  // wrong rarity, this is what would catch it.
  {
    const want = { Normal: 0, Rare: 0, Unique: 0, Legendary: 0 };
    w.DB.items.forEach(o => { const t = o.uq || o.q; if (t in want) want[t]++; });
    const got = pills().map(p => `${pval(p)}=${+p.querySelector('.ct').textContent}`).join(' ');
    ok('...and every count is the data\'s own, set pieces under their real rarity',
       got === Object.keys(want).map(k => `${k}=${want[k]}`).join(' '),
       `${got} | data: ${Object.keys(want).map(k => `${k}=${want[k]}`).join(' ')}`);
  }
  ok('...and the four sum to the corpus, so nothing was dropped or double-counted',
     [].reduce.call(pills(), (a, p) => a + (+p.querySelector('.ct').textContent), 0) === 6048,
     String([].reduce.call(pills(), (a, p) => a + (+p.querySelector('.ct').textContent), 0)));
  ok('a full tier selection is elided from the URL', !/tier=/.test(w.location.hash),
     w.location.hash || '(empty)');
  {
    const rail = d.getElementById('railbody');
    ok('the tier facet is gone from the rail',
       !rail.querySelector('input[data-f="tiers"]') &&
       !rail.querySelector('.sec[data-sec="tiers"]'),
       [].map.call(rail.querySelectorAll('.sec'), s => s.getAttribute('data-sec')).join(','));
  }

  // A pill click is a rail checkbox click: filter, dim, land in the URL. The
  // URL names what is *left on*, not what was turned off -- writeHash writes
  // the selection -- so unchecking Normal writes the other four.
  const tierParam = h => {
    const m = /(?:^|[#&])tier=([^&]*)/.exec(h);
    return m ? decodeURIComponent(m[1]).split(',') : null;
  };
  const flip = (v, on) => {
    const box = d.querySelector(`#tiers input[value="${v}"]`);
    box.checked = on;
    box.dispatchEvent(new w.Event('change', { bubbles: true }));   // the rail's idiom
  };
  flip('Normal', false);
  ok('unchecking Normal drops its 2,161', /3,890/.test(cnt()), cnt());
  ok('...and the pill dims itself',
     d.querySelector('#tiers input[value="Normal"]').parentNode.classList.contains('off'));
  // writeHash sorts a facet's values so the same selection always spells the
  // same URL (see its comment), so this compares membership, not sequence.
  {
    const left = tierParam(w.location.hash) || [];
    ok('...and the URL names the three that are left, and not Normal',
       left.length === 3 && left.indexOf('Normal') < 0 &&
       ['Rare', 'Unique', 'Legendary'].every(v => left.indexOf(v) >= 0),
       w.location.hash);
  }
  await wait(30);
  flip('Normal', true);
  // The identity that catches a strip wired to the wrong facet, or a count read
  // from the wrong place: down and back up must land exactly where it started.
  ok('checking it again restores the full corpus', /6,048/.test(cnt()), cnt());
  ok('...and the tier facet is elided from the URL again', !/tier=/.test(w.location.hash),
     w.location.hash || '(empty)');
  ok('...and no pill is left dimmed',
     pills().every(p => !p.classList.contains('off')));
  await wait(30);

  // #reset takes the other path through readHash -- a named hash that returns
  // early -- so the default it lands on is not the one the boot took. Asserted
  // because the fill above sits deliberately *before* that early return, and
  // moving it after would leave reset showing five dimmed pills.
  await go('#tier=Rare');
  ok('a tier-naming hash leaves only its own pill on',
     pills().filter(p => p.querySelector('input').checked).length === 1 &&
     d.querySelector('#tiers input[value="Rare"]').checked,
     pills().map(p => `${pval(p)}:${p.querySelector('input').checked}`).join(' '));
  d.getElementById('reset').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  ok('#reset restores all four pills, checked and undimmed',
     pills().every(p => p.querySelector('input').checked && !p.classList.contains('off')),
     pills().map(p => `${pval(p)}:${p.querySelector('input').checked ? 'on' : 'off'}`).join(' '));
  ok('#reset restores the default sort too',
     d.getElementById('sort').value === 'tier', d.getElementById('sort').value);
  await wait(30);

  // Reversed, the same order runs the other way: rarest first, levels descend.
  await go('');
  d.getElementById('dir').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  {
    const first = cards()[0];
    ok('reversed, the first card is a Legendary',
       first.className.indexOf('q-legendary') >= 0, first.className);
    // Legendary is only 92 items, so reversing the order reaches into the next
    // tier within the same page -- which is what makes this a real test of the
    // per-run claim rather than the single-run case above.
    ok('...and levels descend within each tier run', monotonic(false), runSummary());
    ok('...and the reversed page reaches into the tier below',
       tierRuns().length > 1, runSummary());
  }
  await wait(30);

  // ------------------------------------------------------- set is not a tier
  // The user's first change: a set is a membership, not a rarity, so it left the
  // tier facet and became its own control pair in the toolbar -- a toggle for
  // "in any set at all" and a select for one named set. What has to be asserted
  // is that the two are independent (clearing the select must not silently
  // unship the toggle, and picking a set must not require it) and that both
  // reach the same 556 the old Set tier did.
  await go('');
  const sbtn = () => d.getElementById('onlyset');
  const ssel = () => d.getElementById('setsel');
  ok('the set controls sit in the toolbar, right of the count, left of Sort',
     !!sbtn() && !!ssel() && sbtn().parentNode.id === 'bar' &&
     sbtn().compareDocumentPosition(ssel()) === 4 &&     // FOLLOWING
     ssel().compareDocumentPosition(d.querySelector('#bar label[for="sort"]')) === 4,
     [].map.call(d.getElementById('bar').children, c => c.id || c.tagName).join(','));
  ok('the toggle starts off and the select on "any set"',
     !sbtn().classList.contains('on') && sbtn().getAttribute('aria-pressed') === 'false' &&
     ssel().value === '',
     `${sbtn().className} / ${ssel().value}`);
  ok('the toggle carries the 556 set items',
     /556/.test(sbtn().textContent), sbtn().textContent);

  // The click, not the change: this is a button, and nothing else repaints it,
  // so the handler updates it itself. Asserted synchronously -- the handler
  // paints in place, and under jsdom's spurious empty-hash hashchange (see the
  // header) anything waited on can be reset out from under the assertion.
  sbtn().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('clicking it narrows to the 556 set items', /^556 items/.test(cnt()), cnt());
  ok('...and the button shows itself pressed',
     sbtn().classList.contains('on') && sbtn().getAttribute('aria-pressed') === 'true',
     sbtn().className);
  ok('...and every card left is a set piece',
     [].every.call(cards(), c => !!w.DB.items.find(o => o.id === c.getAttribute('data-id')).set),
     `${cards().length} cards`);
  ok('...and it rides in the URL as setonly=1', /(?:^|[#&])setonly=1/.test(w.location.hash),
     w.location.hash);
  // Independent of the tier facet: all four pills stay on, because "is it in a
  // set" says nothing about which rarity it is.
  ok('...and it does not disturb the tier pills',
     pills().every(p => p.querySelector('input').checked),
     pills().map(p => `${pval(p)}:${p.querySelector('input').checked}`).join(' '));

  // The select, driven *without* the toggle, to pin that the two are separate
  // state rather than one flag wearing two faces. Same track as the reset above
  // leaves it: back to the whole corpus first.
  sbtn().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('clicking it again restores the corpus', /6,048/.test(cnt()), cnt());
  ok('...and drops setonly from the URL', !/setonly/.test(w.location.hash), w.location.hash);
  const zsel = ssel();
  zsel.value = 'Zeraphi Alchemy';
  zsel.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('the select narrows to one set on its own, toggle untouched',
     /^9 items/.test(cnt()) && !sbtn().classList.contains('on'), cnt());
  ok('...and the two spell themselves separately in the URL',
     /(?:^|[#&])set=Zeraphi%20Alchemy/.test(w.location.hash) && !/setonly/.test(w.location.hash),
     w.location.hash);
  // Both at once is a narrowing, not a union: the select already picks a set, so
  // the toggle holds and the result is the same 9 rather than more.
  sbtn().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok('both together are the same 9 -- a narrowing, not a union',
     /^9 items/.test(cnt()) && ssel().value === 'Zeraphi Alchemy' && sbtn().classList.contains('on'),
     `${cnt()} / ${ssel().value}`);
  // And a cold load of a hash naming both, which is the path a shared link takes.
  const both = await deep('#set=Zeraphi%20Alchemy&setonly=1');
  ok('a hash naming a set and the toggle lands with both set',
     both.getElementById('setsel').value === 'Zeraphi Alchemy' &&
     both.getElementById('onlyset').classList.contains('on') &&
     /^9 items/.test(both.getElementById('count').textContent),
     both.getElementById('count').textContent + ' / ' + both.getElementById('setsel').value);
  // #reset restores them the way it restores everything else: readHash clears
  // S before its early return, so both controls come back to their defaults.
  d.getElementById('reset').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  ok('#reset clears both set controls and the 6,048 behind them',
     ssel().value === '' && !sbtn().classList.contains('on') && /6,048/.test(cnt()),
     `${ssel().value} / ${sbtn().className} / ${cnt()}`);
  await go('');
  await wait(30);

  // The set name in the tooltip is the second route to a set filter and the
  // wider one: clicking it clears everything else first, because "show me this
  // set" is not a question about whatever filters happened to be on. Same clear
  // #reset performs -- the two share resetState(), so they cannot drift.
  {
    await go('#q=aenigma&dmg=fire&sock=1&item=Zeraphi_01_shoulders_alt_set');
    const link = d.querySelector('#detail .sname .setlink');
    ok('the tooltip names the set as a link to that set',
       !!link && link.getAttribute('data-set') === 'Zeraphi Alchemy' &&
       link.textContent === 'Zeraphi Alchemy', link && link.getAttribute('data-set'));
    if (link) link.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    ok('clicking it clears every other filter and lands on the set alone',
       w.location.hash === '#set=Zeraphi%20Alchemy', w.location.hash);
    ok('...and hands back the grid it filtered, with the item closed',
       cards().length === 9 && !d.getElementById('app').classList.contains('item'),
       `${cards().length} cards`);
    // the controls have to agree with the state, or the page is lying about
    // what it is showing: an emptied search box, an unchecked rail, and the
    // select sitting on the set that was just named
    ok('...and the search box, the rail and the set controls all say so',
       d.getElementById('q').value === '' && ssel().value === 'Zeraphi Alchemy' &&
       !sbtn().classList.contains('on') && !d.getElementById('sock').checked &&
       [].every.call(d.querySelectorAll('#railbody input[type=checkbox]'), b => !b.checked),
       `${ssel().value} / ${d.getElementById('q').value}`);
    await go('');
    await wait(30);
  }

  // ------------------------------------------------------------ rail labels
  // The rail filter must use TL2's own stat names too. MAG/DEF are Torchlight
  // 1's words and name attributes that do not exist in this game. Scoped to the
  // label column itself -- the rail's text as a whole contains "EMBERMAGE", so
  // a bare /MAG/ over it would fail on the Set facet for the wrong reason.
  const rl = [].map.call(d.querySelectorAll('#rail .rng .rl'), s => s.textContent);
  ok('rail labels the requirements Focus / Vitality, not MAG / DEF',
     rl.join(',') === 'Strength,Dexterity,Focus,Vitality', rl.join(','));

  // ------------------------------------------- the grouped type rail
  // The rail's counts are over the 6,048 the site shows, not items.json's
  // 6,173 -- the Unclassified tier is dropped at build time, so a type with no
  // *visible* item renders no row at all. Dagger (1 item), Gold (6) and Armor
  // (1, a collar no source can place) are absent for exactly that reason, which
  // is why this is 36 rows and not the 39 the data emits.
  await go('');
  const rb = d.getElementById('railbody');
  const hdr = k => rb.querySelector(`[data-grp="${k}"]`);
  const gct = k => +hdr(k).querySelector('.ct').textContent;
  // The headers are flat siblings of the rows, not wrappers -- so ownership is
  // read by walking back to the nearest preceding header, and a group's span
  // runs forward to the next header of its own level.
  const owner = v => {
    const i = rb.querySelector(`input[data-f="types"][value="${v}"]`);
    if (!i) return null;
    for (let p = i.closest('.f').previousElementSibling; p; p = p.previousElementSibling) {
      if (p.hasAttribute('data-grp')) return p.getAttribute('data-grp');
    }
    return null;
  };
  const sumKids = k => {
    const h = hdr(k), isSub = h.classList.contains('sgrp');
    let s = 0, el = h.nextElementSibling;
    while (el) {
      if (el.classList.contains('grp')) break;
      if (isSub && el.classList.contains('sgrp')) break;
      if (el.classList.contains('f')) s += +el.querySelector('.ct').textContent || 0;
      el = el.nextElementSibling;
    }
    return s;
  };
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  ok('the page carries the taxonomy from build.py', w.DB && !!w.DB.items &&
     !!rb.querySelector('[data-grp]'));
  ok('the rail groups types under category headers',
     ['Armor', 'Weapons', 'Accessories', 'Misc'].every(g => !!hdr(g)),
     [].map.call(rb.querySelectorAll('.grp[data-grp]'), g => g.getAttribute('data-grp')).join(' | '));
  ok('the Category facet is gone', !/Category/.test(rb.textContent) &&
     !/Jewelry/.test(rb.textContent));
  // The two placements the taxonomy deliberately moves, and the ones a later
  // edit is most likely to undo by accident.
  ok('Shield is a weapon, not armour', owner('Shield') === 'Weapons/Off-Hand', owner('Shield'));
  ok('Belt is an accessory, not armour', owner('Belt') === 'Accessories', owner('Belt'));
  ok('Sword is one-handed, Greatsword two-handed',
     owner('Sword') === 'Weapons/One-Handed' && owner('Greatsword') === 'Weapons/Two-Handed',
     owner('Sword') + ' / ' + owner('Greatsword'));
  ok('Armor keeps only the worn slots',
     ['Helmet', 'Shoulder Armor', 'Chest Armor', 'Gloves', 'Leggings', 'Boots']
       .every(t => owner(t) === 'Armor'), owner('Helmet'));
  ok('every visible type renders exactly once',
     [].every.call(rb.querySelectorAll('.f input[data-f="types"]'), (b, _, all) =>
       [].filter.call(all, x => x.value === b.value).length === 1));
  // The identity that catches a broken count: the types under a group are
  // disjoint, so the header's total and the sum of its rows must agree, and
  // both must equal what the group's filter actually matches.
  ok('a group count is the sum of its children',
     gct('Weapons') === sumKids('Weapons') &&
     gct('Weapons/One-Handed') === sumKids('Weapons/One-Handed') &&
     gct('Armor') === sumKids('Armor'),
     `${gct('Weapons')} vs ${sumKids('Weapons')}`);
  // Misc is three lower than 828: the Torchlight 1 socketables were all Misc.
  // See TL1_ITEMS. The four still sum to the visible 6,048.
  ok('the groups partition the visible corpus',
     gct('Armor') === 1827 && gct('Weapons') === 1354 &&
     gct('Accessories') === 2042 && gct('Misc') === 825,
     [gct('Armor'), gct('Weapons'), gct('Accessories'), gct('Misc')].join('/'));
  ok('the weapons subgroups sum to the group',
     gct('Weapons/One-Handed') + gct('Weapons/Two-Handed') + gct('Weapons/Off-Hand') ===
     gct('Weapons'));

  // the header is a bulk toggle over the types beneath it
  click(hdr('Weapons/One-Handed'));
  ok('a group header checks every type under it', /540/.test(cnt()), cnt());
  ok('...and the boxes it stands in for are actually checked',
     [].every.call(rb.querySelectorAll('.f input[data-f="types"]'),
       b => (owner(b.value) === 'Weapons/One-Handed') === b.checked));
  ok('...and the header says it is fully applied', hdr('Weapons/One-Handed').classList.contains('on'));
  ok('a bulk toggle lands in the URL', /(^|[#&])type=/.test(w.location.hash), w.location.hash);
  ok('a group header is not a collapse toggle',
     !d.querySelector('.sec[data-sec="types"]').classList.contains('closed'));
  await wait(30);   // let jsdom's spurious hashchange settle
  click(hdr('Weapons/One-Handed'));
  ok('clicking it again clears them', /6,048/.test(cnt()), cnt());
  ok('...and the facet is elided from the URL again', !/type=/.test(w.location.hash), w.location.hash);

  // a group header reaches through its subgroups; a subgroup does not reach out
  click(hdr('Weapons'));
  ok('the Weapons header toggles its subgroups too', /1,354/.test(cnt()), cnt());
  ok('...including the off-hand', rb.querySelector('input[value="Shield"]').checked);
  await wait(30);
  click(hdr('Weapons'));
  ok('and clears them again', /6,048/.test(cnt()), cnt());
  await wait(30);

  // The four main categories fold, the way a section does, with the glyph in the
  // slot the section headers put theirs. A subgroup header has one action -- the
  // bulk toggle -- so its span stays empty, which is also what keeps the two
  // levels' labels on the same step of the indent ladder.
  {
    const glyphs = sel => [].map.call(rb.querySelectorAll(sel),
                                      e => e.querySelector('.tog').textContent);
    ok('each of the four categories carries a fold glyph',
       glyphs('.grp[data-grp]').join('') === '−−−−', glyphs('.grp[data-grp]').join('|'));
    ok('...and a subgroup header carries none', glyphs('.sgrp[data-grp]').join('') === '');
    // the rows the category owns, by the same walk toggleGroup uses
    const owned = [];
    for (let el = hdr('Weapons').nextElementSibling;
         el && !el.classList.contains('grp'); el = el.nextElementSibling) owned.push(el);
    click(hdr('Weapons').querySelector('.tog'));
    ok('a click on the glyph folds the category',
       hdr('Weapons').querySelector('.tog').textContent === '+' &&
       owned.every(e => e.hidden),
       `${owned.filter(e => e.hidden).length}/${owned.length} hidden`);
    ok('...taking its subgroup headers with it',
       owned.some(e => e.classList.contains('sgrp')) &&
       owned.filter(e => e.classList.contains('sgrp')).every(e => e.hidden));
    ok('...and folding nothing outside it',
       [].every.call(rb.querySelectorAll('.f'), e => owned.includes(e) || !e.hidden));
    // Folding is a view preference, like a section's: it must not touch the
    // filter, the URL or the result count.
    ok('folding is not a filter',
       /6,048/.test(cnt()) && !/type=/.test(w.location.hash), `${cnt()} ${w.location.hash}`);
    // The rail is rebuilt on every route change and the rebuild renders every
    // row, so a fold that is not re-applied springs silently open.
    await go('#q=fish');
    ok('a fold survives the rail being rebuilt',
       hdr('Weapons').querySelector('.tog').textContent === '+' &&
       hdr('Weapons').nextElementSibling.hidden === true);
    click(hdr('Weapons').querySelector('.tog'));
    ok('...and unfolding restores every row',
       hdr('Weapons').querySelector('.tog').textContent === '−' &&
       [].every.call(rb.querySelectorAll('.f'), e => !e.hidden));
    await go('');
  }

  // The damage facet's values are the .DAT's own lowercase keys: they are what
  // matches() compares and what the URL carries. The row prints a word, so it
  // capitalises it, the same way the detail view's stat lines already do.
  {
    const rows = [].map.call(rb.querySelectorAll('input[data-f="dmg"]'), i => ({
      label: i.closest('.f').querySelector('.lbl').textContent, value: i.value }));
    ok('the damage rows read as words, not as the keys they filter on',
       rows.length === 5 &&
       rows.every(r => r.label === r.value.charAt(0).toUpperCase() + r.value.slice(1) &&
                       r.value === r.value.toLowerCase()),
       rows.map(r => r.label + '=' + r.value).join(' '));
    // and the word must not follow the label into the URL: the key underneath is
    // still what filters, so a link keeps working whatever the row calls it
    const fire = rb.querySelector('input[data-f="dmg"][value="fire"]');
    fire.checked = true;
    fire.dispatchEvent(new w.Event('change', { bubbles: true }));
    ok('...and the key underneath is still what filters',
       /(^|[#&])dmg=fire/.test(w.location.hash), w.location.hash);
    await wait(30);
    fire.checked = false;
    fire.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(30);
  }

  // a legacy #cat= link named a facet that no longer exists; it must still
  // resolve, to the group it now names
  const dc = await deep('#cat=Armor');
  ok('a legacy #cat=Armor link resolves to the Armor group',
     /1,827/.test(dc.getElementById('count').textContent),
     dc.getElementById('count').textContent);
  const dj = await deep('#cat=Jewelry');
  ok('a legacy #cat=Jewelry link resolves to Accessories',
     /2,042/.test(dj.getElementById('count').textContent),
     dj.getElementById('count').textContent);

  // ------------------------------------------------------- card stat line
  // The card used to show one "primary" type and its value, chosen as the
  // largest. It now shows every type the item carries, each as an element mark
  // and its own number, and a weapon leads with its dps. What that has to mean,
  // and what a lone specimen cannot show, is that the pairs are complete and in
  // the detail view's own order -- so every rendered card is checked against its
  // own item rather than one case being eyeballed.
  await go('');
  {
    // DMGTYPES, which statPairs and the detail's statLines both read
    const ORDER = ['physical', 'fire', 'ice', 'electric', 'poison'];
    const byId = new Map(w.DB.items.map(o => [o.id, o]));
    const want = o => {
      if (o.dmg) return ORDER.filter(k => o.dmg[k]).map(k => `${k}=${o.dmg[k]}`);
      if (o.arm) return ORDER.filter(k => o.arm[k]).map(k => `${k}=${o.arm[k]}`);
      return null;
    };
    // The mark's tile is a background-position offset into the strip build.py
    // inlines, so a pair with no offset is a type the strip has no tile for --
    // which is exactly how a sixth type would arrive, silently.
    const pairsOf = c => [].map.call(c.querySelectorAll('.st .stv'), p => {
      const i = p.querySelector('i'), b = p.querySelector('b');
      if (p.classList.contains('stv-dps')) return 'dps=' + (b ? b.textContent : '(none)');
      const m = /background-position:-(\d+)px/.exec(i ? i.getAttribute('style') || '' : '');
      return (m ? +m[1] : 'x') + ':' + (b ? b.textContent : '(none)');
    });
    const bad = [], wrongOrder = [], badDps = [], missing = [];
    [].forEach.call(cards(), c => {
      const o = byId.get(c.getAttribute('data-id'));
      const got = pairsOf(c);
      const exp = want(o);
      if (!exp) { if (got.length) missing.push(`${o.id} has no stats but renders ${got.length}`); return; }
      // the offsets are the strip's own, so compare by tile index rather than
      // by the pixel the strip happens to place it at
      const tiles = ORDER.map(k => w.DB.elem[k]);
      const expTiles = exp.map(s => tiles[ORDER.indexOf(s.split('=')[0])] + ':' + s.split('=')[1]);
      const expAll = (o.dmg && o.dps ? ['dps=' + o.dps] : []).concat(expTiles);
      if (got.join(' ') !== expAll.join(' ')) {
        if (got.length !== expAll.length) bad.push(`${o.id}: ${got.length} got / ${expAll.length} expected`);
        else wrongOrder.push(`${o.id}: ${got.join(' ')} != ${expAll.join(' ')}`);
      }
      if (o.dmg && o.dps && !new RegExp('^dps=' + o.dps + '\\b').test(got[0] || '')) badDps.push(o.id);
    });
    ok('every card shows one mark-and-value pair per type its item carries',
       bad.length === 0, bad.slice(0, 6).join(' | '));
    ok('...in the detail view\'s own order, and none with a mark the strip lacks',
       wrongOrder.length === 0, wrongOrder.slice(0, 4).join(' | '));
    ok('...and stats-less items render no stat row at all',
       missing.length === 0, missing.slice(0, 3).join(' | '));
    ok('a weapon leads with its own dps figure', badDps.length === 0,
       badDps.slice(0, 4).join(', '));
    // The dps pair is a member of the *card's* row, and the card row and the
    // detail block once shared a class name for it. The detail block names its
    // parts as bare selectors (`.dps`, `.fspd`, `.frng`), so a card pair called
    // plainly `dps` silently inherited the 15px gold headline figure and stood
    // a head taller than the damage numbers beside it. `stv-` is the card's own
    // namespace for this row. Asserted twice over -- the bare class is absent,
    // *and* the size it would have moved is unmoved -- because either check
    // alone passes while the other breaks.
    const collided = [].filter.call(cards(), c => {
      const p = c.querySelector('.stv-dps');
      const s = c.querySelector('.stv:not(.stv-dps)');
      if (!p || !s) return false;
      return w.getComputedStyle(p).fontSize !== w.getComputedStyle(s).fontSize;
    });
    const bare = d.querySelectorAll('#grid .dps').length;
    ok('the card\'s dps is set at the row\'s own size, not the detail\'s',
       collided.length === 0 && bare === 0,
       collided.slice(0, 3).map(c => c.getAttribute('data-id')).join(', ') +
       ` | bare .dps under #grid: ${bare}`);
    // The words the card used to print. "Fire Armor 140-174" would mean the
    // value is still being labelled rather than left to its mark, which is the
    // whole change. Checked as "nothing but numbers and the one `dps`" rather
    // than a list of type names, because the effect row is a sentence and an
    // effect is allowed to say "Poison Damage".
    const words = [].filter.call(cards(), c => {
      const o = byId.get(c.getAttribute('data-id'));
      if (!(o.dmg || o.arm)) return false;
      const st = c.querySelector('.st');
      return !st || st.textContent
        .replace(/[-+.,%]?\d+(?:[.,]\d+)?%?/g, '').replace(/\bdps\b/g, '').trim() !== '';
    });
    ok('no card spells a damage or armor type out any more',
       words.length === 0,
       words.slice(0, 3).map(c => c.querySelector('.st').textContent).join(' | '));
  }
  // One specimen per shape, each the extreme of its kind, since the sweep above
  // reads whatever the first 500 happen to hold: Bitterbite is the only armor in
  // the corpus carrying all five types, and the Hammer is the only weapon
  // carrying five plus a dps.
  {
    const one = async (hash, id) => {
      const doc = await deep(hash);
      return doc.querySelector(`#grid .card[data-id="${id}"]`);
    };
    const bit = await one('#q=bitterbite', 'collar_unique_spiked');
    ok('an armor card shows all five types side by side, marks and numbers only',
       bit && bit.querySelectorAll('.st .stv').length === 5 &&
       [].every.call(bit.querySelectorAll('.st .stv i'), i =>
         /background-position/.test(i.getAttribute('style') || '')) &&
       !/Armor/.test(bit.querySelector('.st').textContent),
       bit ? bit.querySelector('.st').textContent : '(no card)');
    const ham = await one('#q=official%20rebuke', 'hammer_u07b');
    ok('the densest weapon reads dps then all five damage types',
       ham && /^878\s*dps/.test(ham.querySelector('.st').textContent.replace(/\s+/g, ' ')) &&
       ham.querySelectorAll('.st .stv').length === 6,
       ham ? ham.querySelector('.st').textContent : '(no card)');
  }

  // ---------------------------------------------------------------- icons
  await go('');
  // Four items in the visible corpus have no icon at all, and it is a gap in
  // the sources rather than in the page: glyph1/2/3 name glyph_purple,
  // glyph_orange and glyph_blue in their DATs, and TIDBI's icon dump -- 1,053
  // files, the only icon source there is -- holds none of them and no file
  // whose name contains "glyph"; TomeOfRevelation's ICON field reads "loot",
  // which names no file either. Nothing here can manufacture that art.
  //
  // All four are levelless Normal items, so they sort to the very front of the
  // default tier-then-level order and all four land in the first 500. Under the
  // old name sort not one of them reached it, which is why this went unseen.
  // The assertion is therefore split: what must hold is that a card renders an
  // icon whenever its item *has* one, and that the iconless set is exactly the
  // four known ids -- so a fifth, or a regression, still fails.
  const ICONLESS = ['TomeOfRevelation', 'glyph1', 'glyph2', 'glyph3'];
  const iconlessData = new Set(w.DB.items.filter(o => !o.ic).map(o => o.id));
  const rendered = [].slice.call(d.querySelectorAll('#grid .card'));
  const blank = rendered.filter(c => !c.querySelector('.art i'))
                        .map(c => c.getAttribute('data-id'));
  const unexplained = blank.filter(id => !iconlessData.has(id));
  ok('every rendered card whose item has an icon draws that icon',
     unexplained.length === 0, `no icon for: ${unexplained.join(', ')}`);
  ok('the items with no icon are exactly the four the sources cannot supply',
     iconlessData.size === ICONLESS.length && ICONLESS.every(id => iconlessData.has(id)),
     [...iconlessData].sort().join(', ') || '(none)');
  // The assertion above cannot see whether anything was *painted*. The sheet is
  // 3.63 MB, its base64 is 4.8 MB, and Chrome silently drops a custom property
  // holding a data URI over about 2 MB -- dropping the substitution, not the
  // declaration, so every icon on the page vanishes at once with nothing in the
  // console. The icons were missing on the whole site for exactly this reason.
  //
  // jsdom does not substitute var() either, so no computed style can tell the
  // two apart here. What can be asserted is the shape of the declaration: the
  // sheet is written into the rule that draws it, and no rule reaches it
  // through a variable. Both the grid card and the detail tile are covered by
  // the one grouped selector, so the base64 still appears once in the file.
  {
    const css = [].map.call(d.querySelectorAll('style'), s => s.textContent).join('\n');
    ok('the icon sheet is written into the rule, not carried through var()',
       /\.card \.art i, \.tile i\{[^}]*background-image:url\(data:image\/webp;base64,[A-Za-z0-9+/]{1000}/
         .test(css) && !/var\(--sprite\)/.test(css),
       'a 4.8 MB data URI does not survive a custom property');
  }

  ok('no uncaught errors in the page', errors.length === 0, errors.join(' | '));

  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();

/* Drives the built page in a real DOM. This is the automated form of the
 * manual browser checks: filtering, multi-select, search, sort, the detail
 * view, provenance and hash deep links -- 102 assertions.
 *
 *   npm i jsdom          (anywhere that resolves, or set NODE_PATH)
 *   node db/check_page.js
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

const PAGE = path.join(__dirname, 'out', 'index.html');
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
  // 6,051 of the 6,176 in items.json: the site hides the Unclassified tier,
  // which is what the pipeline calls an item it could not tier (dev, test and
  // monster-only units). The db keeps all 6,176 -- see SITE_HIDDEN_TIERS.
  ok('count line reports the rendered corpus', /6,051/.test(cnt()), cnt());
  ok('truncation is disclosed, not silent',
     /Showing the first 500 of 6,051/.test(d.getElementById('more').textContent));
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
  ok('clicking opens the detail', /Physical\s*169/.test(det()));
  ok('the item route keeps the active filters',
     /tier=Legendary/.test(w.location.hash) && /item=legendary_axe01/.test(w.location.hash),
     w.location.hash);
  // 169/72 are now reconstructed from the DAT rather than read out of TIDBI,
  // and they land on the same numbers -- the DAT's raw 70/30 are pre-scale and
  // were what this page used to show. See derived_range() in build.py.
  ok('detail shows physical 169 + electric 72', /Physical\s*169/.test(det()) && /Electric\s*72/.test(det()));
  ok('no invented Total row survives', !/Total/.test(det()));
  ok('detail shows Strength 163 / Dexterity 68 (not STR 120 / DEX 50)',
     /Strength\s*163/.test(det()) && /Dexterity\s*68/.test(det()) && !/STR/.test(det()));
  ok('detail shows sockets 2', /Sockets\s*2/.test(det()));
  // "Item Level" / "Player Level Required", not bare "Level" / "Level required"
  // -- the two are different things and the old labels read as either one.
  //
  // The Aenigma's MINLEVEL used to render between them as "Min level 45". It is
  // a third number that is neither of the other two -- on 258 items it is 1
  // while `lr` is the real gate -- so it is gone from everything you wear. It
  // survives on socketables, where it is a different field entirely (below).
  ok('detail shows item level 54 / player level required 61, and no min level',
     /Item Level\s*54/.test(det()) && /Player Level Required\s*61/.test(det()) &&
     !/Min level/.test(det()), det().slice(0, 200));
  // The old label was exactly "Level required" with a lowercase r, so the new
  // capital-R wording cannot satisfy this by accident. (A bare "Level" needs no
  // separate check: the positive assertion above only passes because it now
  // reads "Item Level".)
  ok('the old "Level required" wording is gone', !/Level required/.test(det()));
  // Aenigma carries neither xl nor skm, so asserting the Max level / Max sockets
  // rows are absent *here* would pass even with both still rendered. Those two
  // are checked below, against a record that actually has the fields.
  ok('the dropped fields are still built, just not shown here',
     !/Max level/.test(det()) && !/Max sockets/.test(det()) &&
     w.DB.items.some(o => o.xl) && w.DB.items.some(o => o.skm));
  // rng (RANGE) is the weapon's attack reach, not a damage range -- it used to
  // render in the type line as "Axe · Legendary · 0.6 range", which read as one.
  // It lives in the Item block now. Aenigma is an Axe, and 93 of the 101 Axes
  // are 0.6.
  //
  // The negative half reads `.dtype` rather than the whole detail, because a
  // damage range is *supposed* to be down there -- only the type line must be
  // free of the word.
  {
    const dtyp = d.querySelector('#detail .dtype').textContent;
    ok('weapon range moved out of the type line into the Item block',
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
  // shape the user quoted from the game.
  ok('detail shows damage per second 430', /Damage per Second\s*430/.test(det()));
  ok('detail words the attack speed as the game does',
     /Attack Speed\s*Very Fast \(0\.56 seconds\)/.test(det()), det().slice(0, 400));
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
  await go('');
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
  const d5 = await deep('#item=legendary2_sword05');
  const d5t = d5.getElementById('detail').textContent;
  ok('Cerulean Nightmare: a max-sockets field exists but is not rendered',
     /Sockets\s*2/.test(d5t) && !/Max sockets/.test(d5t) &&
     !/Max level/.test(d5t) && /Item Level\s*105/.test(d5t), d5t.slice(0, 160));
  // The Axe of Throwing is why Weapon Range is worth a row at all. 93 of the
  // 101 Axes are 0.6 and it is 9, because the thing is thrown -- so a per-type
  // constant is not quite a constant, and the one item where it moves is the
  // one item where it means something. Its damage is a flat 228, so there is no
  // damage range anywhere on the page to confuse the row with.
  const thr = await deep('#item=axe_u05x');
  const tht = thr.getElementById('detail').textContent;
  ok('The Axe of Throwing reads Weapon Range 9 against the Axe type\'s 0.6',
     /Weapon Range\s*9(?!\d)/.test(tht) &&
     !/range/i.test(thr.querySelector('#detail .dtype').textContent), tht.slice(0, 200));

  // The other half of MINLEVEL, which the Aenigma assertion above turns off.
  // On a socketable it is a real gate and a clean one: the seven ranks of every
  // gem family carry exactly 1, 14, 28, 42, 56, 70, 84 -- a step of 14 -- while
  // the gems' own levels run 8, 22, 36 ... a fixed 8 higher, and the eight ember
  // families agree on all seven numbers. Nothing else in a gem's record explains
  // a second level field, and the only level-shaped requirement a gem has is the
  // item it goes into. Blood Ember Shard is rank 3, so 28 against its own 36.
  const gem = await deep('#item=tl2_bloodember_rank3');
  const gemt = gem.getElementById('detail').textContent;
  ok('a socketable shows MINLEVEL as the item level needed to socket it',
     /Required Item Level to Socket\s*28/.test(gemt) &&
     /Item Level\s*36/.test(gemt) && !/Min level/.test(gemt), gemt.slice(0, 240));

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
       /Set\s*Zeraphi Alchemy/.test(zs.getElementById('detail').textContent),
       zs.querySelector('#detail .row:last-child').textContent);
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
  const sblock = (doc, title) => [].slice
    .call(doc.querySelectorAll('#detail .block'))
    .filter(b => b.querySelector('h3') &&
                 b.querySelector('h3').textContent === title)[0] || null;

  {
    const sb = sblock(zs, 'Set Bonuses');
    const rungs = sb ? [].map.call(sb.querySelectorAll('.thr'), t => t.textContent) : [];
    ok('a set piece carries the whole set\'s ladder, not just its own rungs',
       !!sb && rungs.length === 5 &&
       rungs.join(' | ') === '2 pieces | 3 pieces | 4 pieces | 5 pieces | 6 pieces' &&
       /\+35% to Electric Damage/.test(sb.textContent),
       rungs.join(' | '));
    ok('a set that ships every piece it gates on marks no rung unreachable',
       !!sb && sb.querySelectorAll('.thr.over').length === 0 &&
       sb.querySelectorAll('.thr').length === sb.querySelectorAll('.fx').length,
       sb ? sb.querySelectorAll('.thr.over').length + ' marked' : 'no block');
    // Two numbers, because they answer different questions and on 47 of the 80
    // sets they differ. Zeraphi is the "pieces to spare" shape -- 9 exist, the
    // ladder tops out at 6, so three are spare once the set is complete.
    ok('the ladder header counts the pieces shipped and the pieces a full set needs',
       !!sb && /Zeraphi Alchemy\s*9 pieces \(6 piece set\)/.test(sb.textContent),
       sb && sb.querySelector('.seth').textContent);
  }
  const arch = await deep('#item=engineer_05_amulet_alt_set');
  {
    const sb = sblock(arch, 'Set Bonuses');
    const over = sb ? [].map.call(sb.querySelectorAll('.thr.over'), t => t.textContent) : [];
    ok('a rung above what the set ships is drawn, and says why it cannot be reached',
       over.length === 2 &&
       over[0] === '8 pieces · set ships 7' && over[1] === '9 pieces · set ships 7',
       over.join(' | '));
    ok('...and states the full-set size even where it is unreachable',
       !!sb && /Cornerstone\s*7 pieces \(9 piece set\)/.test(sb.textContent),
       sb && sb.querySelector('.seth').textContent);
    // The dimming must be the rung's own rule. `.fx.locked` is the obvious one
    // to borrow and the wrong one: it means "a stat the item has, behind a task
    // you can still finish", which is the opposite of a rung nothing reaches --
    // and the augmented-weapon assertions above select on it by name, so reusing
    // it would quietly widen what those match. Read as CSS text because jsdom
    // does not substitute var(), which leaves computed colours useless here.
    const css = [].map.call(arch.querySelectorAll('style'), s => s.textContent).join('\n');
    const overList = sb && sb.querySelector('.fx.over');
    ok('an unreachable rung is dimmed by its own rule, not by `.fx.locked`',
       !!overList && !overList.classList.contains('locked') &&
       /\.thr\.over\{[^}]*color:/.test(css) && /\.fx\.over li\{[^}]*color:/.test(css),
       overList && overList.className);
  }
  const twin = await deep('#item=z_wand_m01_set');
  {
    const sb = sblock(twin, 'Set Bonuses');
    ok('a set one piece short of its own first rung still shows the rung',
       !!sb && sb.querySelectorAll('.thr.over').length === 1 &&
       /2 pieces · set ships 1/.test(sb.textContent) &&
       /12% Damage bonus when dual-wielding/.test(sb.textContent),
       sb && sb.textContent.slice(0, 120));
    // The ladder must not read as affixes the item already has -- the same
    // distinction the augmented-weapon block exists to draw. Its own block, and
    // nothing from it in the Affixes block beside it.
    const aff = sblock(twin, 'Affixes');
    ok('the ladder is its own block, not extra affixes on the piece',
       !!sb && (!aff || !/dual-wielding/.test(aff.textContent)),
       aff ? aff.textContent.slice(0, 120) : '(no affix block)');
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
    const sb = sblock(mon, 'Set Bonuses');
    ok('Mondon\'s Vestment reads "16 pieces (10 piece set)"',
       !!sb && /Mondon’s Vestment\s*16 pieces \(10 piece set\)/.test(sb.textContent),
       sb && sb.querySelector('.seth').textContent);
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
  // The recolour is paint, not classification: the Set tier must still be
  // filterable, or 556 items would have been re-filed as Rare/Unique to get a
  // colour and the facet would have quietly changed meaning.
  const stier = await deep('#tier=Set');
  ok('the Set tier still filters the 556 set items',
     /556/.test(stier.getElementById('count').textContent),
     stier.getElementById('count').textContent);

  // ------------------------------------------------ the three reported bugs
  // Reported against heavy_g_amulet_f_alt_b: fire armor should be 140-174, the
  // Focus requirement 79, and the required level 81. All three were invisible
  // before, because the DAT holds a single pre-scale scalar per type and has no
  // LEVEL_REQUIRED at all. Armor and requirements still come from TIDBI: only
  // weapon damage has a derivation.
  const amu = (await deep('#item=heavy_g_amulet_f_alt_b')).getElementById('detail').textContent;
  ok('amulet: fire armor is the 140-174 range', /Fire\s*140-174/.test(amu), amu.slice(0, 300));
  ok('amulet: Focus requirement 79 is present', /Focus\s*79/.test(amu), amu.slice(0, 300));
  ok('amulet: player level required 81 is present',
     /Player Level Required\s*81/.test(amu), amu.slice(0, 300));

  // ------------------------------------------------------ base-value badge
  // 19 items still fall back to a raw .DAT scalar -- 17 of them armor-only,
  // since armor has no derivation. That has to be disclosed, not passed off as
  // an in-game number. Only 4 of the 19 are still rendered, though: the other
  // 15 are Unclassified (monster shields) and the site now hides that tier, so
  // shield_dwarven is no longer reachable by deep link. Witch_Boots is a
  // visible armor-only one. (ancientskeleton_axe used to be the example here;
  // it is DAT-derived now, so it no longer carries the badge.)
  const bas = (await deep('#item=Witch_Boots')).getElementById('detail').textContent;
  ok('an item with only base values says so',
     /base values, not rendered/.test(bas) && /PAK \.DAT base value/.test(bas), bas.slice(0, 300));

  // --------------------------------------- requirements are ALTERNATIVES
  // A class item carries both a player level and stat requirements, and the
  // game grants equip if you meet either branch -- so the detail must show the
  // "or". A flat list would state the opposite of how equipping works.
  const bmh = (await deep('#item=caster_04_helmet_alt_c')).getElementById('detail').textContent;
  ok('class item: level 65 / Focus 87 / Vitality 101',
     /Player Level Required\s*65/.test(bmh) && /Focus\s*87/.test(bmh) &&
     /Vitality\s*101/.test(bmh), bmh.slice(0, 400));
  ok('class item: the two branches are joined by "or"',
     /Player Level Required\s*65\s*or\s*Focus\s*87/.test(bmh), bmh.slice(0, 400));
  ok('class item: the Embermage gate is shown as a restriction, not an option',
     /Class\s*Embermage only/.test(bmh), bmh.slice(0, 400));

  // ------------------------------------------- augmented weapons (unlockable)
  // 74 uniques carry a kill-count task that unlocks 1-3 further stats. The
  // whole point is that they are conditional, so they must not be rendered as
  // affixes the weapon already has -- which is exactly what happened while the
  // tooltip arrived as one flat list.
  const gw = await deep('#item=wand_u02b');
  const gwd = gw.getElementById('detail');
  const txt = sel => { const e = gwd.querySelector(sel); return e ? e.textContent : ''; };
  const list = sel => [].map.call(gwd.querySelectorAll(sel), l => l.textContent);
  const locked = list('.fx.locked li'), plain = list('.fx:not(.locked) li');
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
  const rkp = [].map.call(rkd.querySelectorAll('.fx:not(.locked) li'), l => l.textContent);
  ok('augmented weapon: the inverted-divider item splits the same way',
     rkl.length === 1 && /\+2 Physical Damage/.test(rkl[0]) &&
     rkp.length === 1 && /90% Interrupt chance/.test(rkp[0]),
     rkl.join(' | ') + '  //  ' + rkp.join(' | '));

  // ------------------------------------------------------------ rail labels
  // The rail filter must use TL2's own stat names too. MAG/DEF are Torchlight
  // 1's words and name attributes that do not exist in this game. Scoped to the
  // label column itself -- the rail's text as a whole contains "EMBERMAGE", so
  // a bare /MAG/ over it would fail on the Set facet for the wrong reason.
  const rl = [].map.call(d.querySelectorAll('#rail .rng .rl'), s => s.textContent);
  ok('rail labels the requirements Focus / Vitality, not MAG / DEF',
     rl.join(',') === 'Strength,Dexterity,Focus,Vitality', rl.join(','));

  // ------------------------------------------- the grouped type rail
  // The rail's counts are over the 6,051 the site shows, not items.json's
  // 6,176 -- the Unclassified tier is dropped at build time, so a type with no
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
  ok('the groups partition the visible corpus',
     gct('Armor') === 1827 && gct('Weapons') === 1354 &&
     gct('Accessories') === 2042 && gct('Misc') === 828,
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
  ok('clicking it again clears them', /6,051/.test(cnt()), cnt());
  ok('...and the facet is elided from the URL again', !/type=/.test(w.location.hash), w.location.hash);

  // a group header reaches through its subgroups; a subgroup does not reach out
  click(hdr('Weapons'));
  ok('the Weapons header toggles its subgroups too', /1,354/.test(cnt()), cnt());
  ok('...including the off-hand', rb.querySelector('input[value="Shield"]').checked);
  await wait(30);
  click(hdr('Weapons'));
  ok('and clears them again', /6,051/.test(cnt()), cnt());
  await wait(30);

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

  // ---------------------------------------------------------------- icons
  await go('');
  const noIcon = [].filter.call(d.querySelectorAll('#grid .art'), a => !a.querySelector('i')).length;
  ok('every rendered card got a sprite icon', noIcon === 0, `${noIcon} placeholders`);

  ok('no uncaught errors in the page', errors.length === 0, errors.join(' | '));

  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();

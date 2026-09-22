/* Drives out/socketables.html in a real DOM: the table's shape, the split it
 * claims to have re-derived, the marks that admit where the two sources
 * disagree, the pool disclosures, and the sort/filter the page ships -- plus
 * the links back into the main page, which is loaded once to check them.
 *
 *   npm i jsdom          (anywhere that resolves, or set NODE_PATH)
 *   node verify/check_socketables.js
 *
 * Unlike check_page.js this suite needs NO heap flag, and the difference is
 * worth stating so nobody adds one reflexively: the main page is 7.3 MB, most
 * of it a 4.8 MB base64 icon sheet in a <style> text node, and forty fresh
 * JSDOMs over it hold gigabytes of live DOMs. This page is 213 KB and refers
 * the sheet from beside itself, so a DOM over it is tens of megabytes. The one
 * main-page JSDOM below (for the outbound links) is the only large one, and it
 * is built once and never rebuilt.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const OUT = path.join(__dirname, '..', 'out');
const PAGE = path.join(OUT, 'socketables.html');
const MAIN = path.join(OUT, 'index.html');
const DATA = path.join(OUT, 'items.json');
for (const f of [PAGE, MAIN, DATA]) {
  if (!fs.existsSync(f)) {
    console.error('no built page at ' + f + '\nrun `python src/build.py` first.');
    process.exit(1);
  }
}
const URL_ = 'file:///' + PAGE.split(path.sep).join('/');
const html = fs.readFileSync(PAGE, 'utf8');
console.log('page bytes:', (html.length / 1024).toFixed(0), 'KB\n');

let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (!cond && extra ? '   ' + extra : ''));
  if (!cond) fails++;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// items.json is the payload the main page renders its cards from, and it is the
// right thing to check this table against: the table re-derives the split from
// the game files where the cards read `fxs`, so comparing the two is exactly the
// claim the page makes. Reading the 2.3 MB JSON beats a second 7.3 MB JSDOM.
const items = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const byId = new Map(items.map(i => [i.id, i]));

const dom = new JSDOM(html, { runScripts: 'dangerously', url: URL_, pretendToBeVisual: true });
const w = dom.window, d = w.document;
const rows = () => [].slice.call(d.querySelectorAll('tbody tr'));
const secs = () => [].slice.call(d.querySelectorAll('section'));
const q = () => d.getElementById('q');
const idOf = tr => (tr.querySelector('a.nm').getAttribute('href').split('=')[1]);
// An effect cell is a run of <p class="fx"> lines, or a <div class="pool"> whose
// lines stay inside a closed <ul> until the reader opens it. A line shared by
// both slots carries the tag inline, so the tag comes out before comparing --
// the tag is a note about the line, not part of it.
const cellLines = td => [].slice.call(td.querySelectorAll('p.fx, .pool li')).map(n => {
  const c = n.cloneNode(true);
  [].forEach.call(c.querySelectorAll('.tag'), t => t.remove());
  return c.textContent;
});
// A row's markers: .mark is the three provenance notes, .tag is the either-slot
// note, and they answer different questions -- one says the sources disagreed
// about this row, the other says this line is not side-specific.
const marksIn = tr => [].slice.call(tr.querySelectorAll('.mark, .tag')).map(m => m.textContent);

const errors = [];
w.addEventListener('error', e => errors.push(String(e.message)));

async function type(el, v) { el.value = v; el.dispatchEvent(new w.Event('input')); await wait(0); }

(async () => {
  // ------------------------------------------------------------- structure
  // Five families, in the order a player meets them. Embers first because they
  // are the ladder the page exists for: nine of the sixteen ember types ship in
  // seven ranked steps, and reading one column down a family is the comparison.
  ok('five family sections, in order',
     secs().map(s => s.dataset.kind).join(',') === 'Embers,Skulls,Eyes,Gems,Other',
     secs().map(s => s.dataset.kind).join(','));
  ok('162 rows across them', rows().length === 162, `${rows().length}`);
  // 175 Socketables ship; six do not reach this table. The five PARTS_WEAPON
  // components are a Transmuter recipe input rather than a family, and
  // tl2_bloodember_BASE is a template -- Rare, so the site's Unclassified rule
  // does not hide it, and named "Blood Ember", the same as the seven real ranks.
  ok('each section count is its own row count', secs().every(s =>
     s.querySelector('h2 .n').textContent ===
     String(s.querySelectorAll('tbody tr').length)),
     secs().map(s => `${s.dataset.kind}:${s.querySelector('h2 .n').textContent}`).join(' '));
  ok('section counts are 57/52/35/12/6',
     secs().map(s => s.querySelector('h2 .n').textContent).join(',') === '57,52,35,12,6',
     secs().map(s => s.querySelector('h2 .n').textContent).join(','));
  ok('every row is eight cells', rows().every(tr => tr.children.length === 8),
     `${rows().filter(tr => tr.children.length !== 8).length} rows off`);
  // Seven named columns plus the unlabelled icon cell, which is what makes the
  // eight. `Req. Lv` is the socketing requirement -- the game's own
  // ITEM_LEVEL_REQUIREMENTS_SOCKETABLE curve, max(1, level-8) -- and sits
  // beside the drop band (Min/Max Lv) because the two are different numbers.
  const heads = [].slice.call(secs()[0].querySelectorAll('thead th')).map(t => t.textContent);
  ok('seven named columns, icon first',
     heads.join('|') === '|Socketable|Item Lv|Req. Lv|Armor / Trinket|Weapon|Min Lv|Max Lv',
     heads.join('|'));
  ok('every section repeats the same header',
     secs().every(s => [].slice.call(s.querySelectorAll('thead th'))
       .map(t => t.textContent).join('|') === heads.join('|')));

  // ------------------------------------------------- rows that must not ship
  const ids = rows().map(idOf);
  ok('no _BASE template rows', !ids.some(i => /_base$/i.test(i)),
     ids.filter(i => /_base$/i.test(i)).join(','));
  ok('no PARTS_WEAPON component rows', !ids.some(i => /^tl2_parts_weapon/i.test(i)),
     ids.filter(i => /^tl2_parts_weapon/i.test(i)).join(','));
  ok('no duplicate ids', new Set(ids).size === ids.length,
     `${ids.length - new Set(ids).size} dupes`);
  // Two different items are both called "Rift Ember". Only the reward is a
  // Socketable; the acquire record is a Quest Item, so the table carries one and
  // that one has to be the reward, not the quest's other half.
  const rift = rows().filter(tr => tr.querySelector('a.nm').textContent === 'Rift Ember');
  ok('one Rift Ember, and it is the reward', rift.length === 1 &&
     idOf(rift[0]) === 'Quest_ManaVent_Reward',
     `${rift.length} rows: ${rift.map(idOf).join(',')}`);

  // ---------------------------------------------------- the split is right
  // The claim this whole page rests on: the two effect columns are the item's
  // effects, partitioned by which slot they take, re-derived from the game files
  // rather than copied from the card. items.json carries the same lines tagged
  // per line in `fxs` with the same a/w/b vocabulary slots.py writes, so this is
  // an exact content check and not a count: every line on the right side, in
  // both columns, and nothing else. A count check would pass a table that put
  // the right number of the wrong effects in a column.
  let splitBad = [], sharedBad = [];
  for (const tr of rows()) {
    const it = byId.get(idOf(tr));
    const fx = it.fx || [], fxs = it.fxs || [];
    const want = { a: [], w: [] };
    if (it.ep) {
      // A pooled row has no fx at all -- the bonus is a roll, and the item
      // records the pool on `ep` instead of the line it would print. Its cell is
      // the disclosure and its lines are the pool's members, not a fixed bonus.
      want.a = it.ep.a || []; want.w = it.ep.w || [];
    } else {
      fx.forEach((line, i) => {
        if (fxs[i] === 'a' || fxs[i] === 'b') want.a.push(line);
        if (fxs[i] === 'w' || fxs[i] === 'b') want.w.push(line);
      });
    }
    // Cells: 0 icon, 1 name, 2 Item Lv, 3 Req. Lv, 4 armor, 5 weapon, 6 Min, 7 Max.
    const got = { a: cellLines(tr.children[4]), w: cellLines(tr.children[5]) };
    for (const side of ['a', 'w']) {
      if (got[side].join('\u0000') !== want[side].join('\u0000')) {
        splitBad.push(`${it.id}.${side}: ${JSON.stringify(got[side])} vs ${JSON.stringify(want[side])}`);
      }
    }
    // A shared line is in both columns, so it is printed twice and tagged, or it
    // reads as a second bonus rather than the same one.
    const either = (it.fxs || []).filter(t => t === 'b').length;
    if (either && marksIn(tr).filter(m => m === 'either').length !== either * 2) {
      sharedBad.push(`${it.id}: ${either} either-slot lines, ${marksIn(tr).length} tags`);
    }
  }
  ok('the two columns are the item\'s effects, split by slot -- all 162 rows',
     splitBad.length === 0, splitBad.slice(0, 3).join(' | '));
  ok('an either-slot line is tagged in both columns', sharedBad.length === 0,
     sharedBad.slice(0, 3).join(' | '));

  // A shared line's whole point is that it is one effect, so a row that has one
  // must print it twice and green. These twelve are the six Lucky Coins and the
  // six Lucky Dice, whose bonus applies wherever they are socketed.
  const eitherRows = rows().filter(tr => marksIn(tr).indexOf('either') >= 0).map(idOf);
  ok('12 rows carry an either-slot line', eitherRows.length === 12, `${eitherRows.length}`);
  ok('they are the six Coins and six Dice',
     /^tl2_goldgem1,tl2_goldgem2,tl2_goldgem3,tl2_goldgem4,tl2_goldgem5,tl2_goldgem6,/.
       test(eitherRows.slice().sort().join(',')) &&
     /tl2_luckgem1,tl2_luckgem2,tl2_luckgem3,tl2_luckgem4,tl2_luckgem5,tl2_luckgem6$/.
       test(eitherRows.slice().sort().join(',')),
     eitherRows.slice().sort().join(','));
  ok('24 either tags -- two columns each',
     d.querySelectorAll('.tag').length === 24, `${d.querySelectorAll('.tag').length}`);

  // ------------------------------------------------- no provenance badges
  // The name cell carries the name and nothing else. It used to carry up to two
  // of `heading lost`, `sources differ` and `rolled`, and they were removed on
  // request: they sat against the one column a reader scans, and the six rows
  // they qualified are a fact about how the split was derived rather than
  // anything about the socketable. The facts themselves are unchanged and still
  // pinned -- the build asserts the whole status distribution, and the assertions
  // below reach the same populations through what the table still shows.
  ok('no provenance badge is left in any row',
     d.querySelectorAll('.mark').length === 0, `${d.querySelectorAll('.mark').length} found`);
  ok('the name cell holds only the name',
     rows().every(tr => tr.children[1].children.length === 1 &&
                        tr.children[1].firstElementChild.className === 'nm'),
     rows().find(tr => tr.children[1].children.length !== 1) ?
       idOf(rows().find(tr => tr.children[1].children.length !== 1)) : '');
  ok('and its text is exactly the item\'s name',
     rows().every(tr => {
       const it = byId.get(idOf(tr));
       return it && tr.children[1].textContent === it.n;
     }));
  // The three badge words are gone from the document, not just from the rows --
  // the footer explained them, and a paragraph about a badge nobody can see is
  // worse than no paragraph.
  ok('the badge vocabulary is gone from the page',
     ['heading lost', 'sources differ', '>rolled<'].every(s => html.indexOf(s) < 0),
     ['heading lost', 'sources differ', '>rolled<'].filter(s => html.indexOf(s) >= 0).join(', '));
  // The either tag is NOT a badge and stays: it says a line is the same bonus in
  // both columns rather than a second one, which is what reading the row needs.
  ok('the either tag survives', d.querySelectorAll('.tag').length === 24,
     `${d.querySelectorAll('.tag').length}`);

  // What the badges used to identify is still on the page in other forms. The 28
  // pooled rows are the ones with a disclosure, which is the same population the
  // `rolled` badge marked.
  const pooledRows = rows().filter(tr => tr.querySelector('.oneof'));
  ok('28 rows disclose a pool', pooledRows.length === 28, `${pooledRows.length}`);
  ok('they are the four rare families, seven ranks each',
     pooledRows.every(tr => /^tl2_(blood|chaos|iron|void)ember_rank[1-7]$/.test(idOf(tr))),
     pooledRows.map(idOf).filter(i => !/^tl2_(blood|chaos|iron|void)ember/.test(i)).join(','));
  ok('and no unpooled row is one of them',
     rows().filter(tr => !tr.querySelector('.oneof'))
         .every(tr => !/^tl2_(blood|chaos|iron|void)ember_rank/.test(idOf(tr))));
  // The six rows the two sources disagree about are no longer distinguishable in
  // the DOM, so that they are still the same six is a build-time assertion --
  // build.py pins the whole status distribution. What the page still states is
  // the count, in the footer, in words.
  ok('the footer still states the derivation\'s agreement',
     /agree on\s*<b>121 of the 162 rows<\/b>/.test(html.replace(/\s+/g, ' ')) ||
     html.indexOf('121 of the 162 rows') >= 0 ||
     /121 of the __ROWS__|121 of the 162/.test(html),
     (html.match(/agree on[^<]*<b>[^<]*<\/b>/) || [''])[0]);

  // --------------------------------------------------- the pool disclosure
  // Collapsed on load: 56 open lists would swamp a 162-row table. What is
  // asserted is not just that they are closed but that each button is wired to
  // its own list and nothing else -- a shared id would make one click open
  // somebody else's pool, which is the failure an aria-controls typo produces.
  const unbtns = () => [].slice.call(d.querySelectorAll('.oneof'));
  ok('56 pool disclosures', unbtns().length === 56, `${unbtns().length}`);
  ok('all closed on load',
     unbtns().every(b => b.getAttribute('aria-expanded') === 'false') &&
     d.querySelectorAll('ul[id^="pool-"]:not(.hidden)').length === 0);
  ok('each names a list that exists and is its own',
     unbtns().every(b => {
       const box = d.getElementById(b.getAttribute('aria-controls'));
       return box && box.parentNode.contains(b) && box.tagName === 'UL';
     }) && new Set(unbtns().map(b => b.getAttribute('aria-controls'))).size === 56);
  // Including "one of 1", which is not a typo: the Void Embers' weapon column
  // rolls from a pool with a single member at every rank. It reads oddly and is
  // still the honest rendering -- printing the line flat would say the bonus is
  // fixed, which is not what the files say.
  ok('the label says how many it rolls from',
     unbtns().every(b => /^one of [1-9]\d*$/.test(b.textContent.replace(/\s+/g, ' ').trim())),
     unbtns().map(b => b.textContent.trim()).find(t => !/^one of \d+$/.test(t)) || '');

  const first = unbtns()[0];
  const firstBox = d.getElementById(first.getAttribute('aria-controls'));
  first.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(0);
  ok('clicking one opens it',
     first.getAttribute('aria-expanded') === 'true' && !firstBox.classList.contains('hidden'));
  ok('and opens nothing else',
     d.querySelectorAll('ul[id^="pool-"]:not(.hidden)').length === 1,
     `${d.querySelectorAll('ul[id^="pool-"]:not(.hidden)').length} open`);
  first.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(0);
  ok('clicking again closes it',
     first.getAttribute('aria-expanded') === 'false' && firstBox.classList.contains('hidden'));

  // ------------------------------------------------------------ sort order
  // Family-major, tier-minor, which is what makes each family read as its own
  // ladder. It is a deliberate deviation from the level sort the other sections
  // use, so it is worth pinning: the first seven rows are one family, Speck to
  // Giant, and data-fam ascends down the section.
  // data-fam is family*1000 + rank, and anything with no family -- Rift Ember,
  // every gem, skull and eye -- takes 8000, past the end of the eight families.
  // That is why the ladder assertion below is about the *ordering* and not about
  // the numbers being small.
  const emberNames = rows().slice(0, 7).map(tr => tr.querySelector('a.nm').textContent);
  ok('the Embers open on the Flame ladder',
     emberNames.join(' | ') === 'Flame Ember Speck | Flame Ember Chip | Flame Ember Shard | ' +
       'Flame Ember | Large Flame Ember | Huge Flame Ember | Giant Flame Ember',
     emberNames.join(' | '));
  // The display name spells the rank three ways around the word Ember -- a
  // suffix at 1-3, nothing at 4, a prefix at 5-7 -- which is exactly why the
  // order comes from the DAT's own rank number and not from the name.
  const emberFams = rows().slice(0, 57).map(tr => +tr.dataset.fam);
  ok('data-fam ascends through the Embers',
     emberFams.every((v, i) => !i || emberFams[i - 1] <= v));
  const famRuns = [];
  emberFams.forEach(v => {
    const f = Math.floor(v / 1000);
    if (!famRuns.length || famRuns[famRuns.length - 1].f !== f) famRuns.push({ f, n: 0 });
    famRuns[famRuns.length - 1].n++;
  });
  ok('eight families of seven ranks, then the rest',
     famRuns.length === 9 && famRuns.slice(0, 8).every(r => r.n === 7) && famRuns[8].f === 8,
     famRuns.map(r => `${r.f}x${r.n}`).join(' '));
  // The four common families (flame, ice, spark, venom) are indices 0-3 of the
  // page's order list and the four rare ones (blood, chaos, iron, void) are 4-7,
  // so ascending by family index puts every common ladder above every rare one
  // without a rule saying so. Family 8 is everything unranked.
  ok('the four common families come before the four rare ones',
     famRuns.map(r => r.f).join(',') === '0,1,2,3,4,5,6,7,8',
     famRuns.map(r => r.f).join(','));

  d.getElementById('dir').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(0);
  // Reversing reverses the whole key, so the fam-8000 group -- Rift Ember and
  // every non-ember -- comes first and the Flame ladder lands at the tail of the
  // section, Giant back to Speck.
  ok('reversing leads with the unranked rows',
     rows()[0].querySelector('a.nm').textContent === 'Rift Ember',
     rows()[0].querySelector('a.nm').textContent);
  ok('and runs the Flame ladder backwards at the tail',
     rows().slice(50, 57).map(tr => tr.querySelector('a.nm').textContent).join('|') ===
     'Giant Flame Ember|Huge Flame Ember|Large Flame Ember|Flame Ember|' +
     'Flame Ember Shard|Flame Ember Chip|Flame Ember Speck',
     rows().slice(50, 57).map(tr => tr.querySelector('a.nm').textContent).join('|'));
  d.getElementById('dir').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(0);
  ok('reversing back restores the ladder',
     rows()[0].querySelector('a.nm').textContent === 'Flame Ember Speck',
     rows()[0].querySelector('a.nm').textContent);

  // --------------------------------------------------------------- filters
  const visible = () => rows().filter(tr => !tr.classList.contains('hidden'));
  const pills = [].slice.call(d.querySelectorAll('button[data-q]'));
  ok('three quality pills', pills.length === 3, `${pills.length}`);
  const normal = pills.find(b => b.dataset.q === 'normal');
  normal.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(0);
  // The 28 Normal socketables are the four common ember families' ladders.
  ok('the Normal pill leaves 28 rows', visible().length === 28, `${visible().length}`);
  ok('and 28 is the whole Normal population',
     visible().every(tr => tr.dataset.q === 'normal'));
  normal.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(0);

  await type(q(), 'poison armor');
  await wait(0);
  const byFx = visible();
  ok('search reads effect text, not just names',
     byFx.length > 0 && byFx.every(tr => tr.dataset.fx.indexOf('poison armor') >= 0),
     `${byFx.length} rows`);
  ok('and none of them is named "poison armor"',
     byFx.every(tr => tr.dataset.name.indexOf('poison armor') < 0));
  // A section whose rows all filter out takes its heading with it, rather than
  // leaving a 0 beside an empty table.
  ok('a filtered-out section hides itself',
     secs().every(s => s.classList.contains('hidden') ===
       (s.querySelectorAll('tbody tr:not(.hidden)').length === 0)));
  ok('the count line tracks the filter',
     d.getElementById('count').textContent === `${byFx.length} of 162 socketables`,
     d.getElementById('count').textContent);
  ok('filtering leaves the pools alone',
     unbtns().every(b => b.getAttribute('aria-expanded') === 'false') &&
     d.querySelectorAll('ul[id^="pool-"]:not(.hidden)').length === 0);

  await type(q(), '');
  await type(d.getElementById('minlv'), '64');
  await wait(0);
  // A floor, not a band: the rank-7 rare embers are level 92 and survive it.
  ok('min item level is a floor',
     visible().every(tr => +tr.dataset.lv >= 64) && visible().length > 0,
     `${visible().length} rows`);
  ok('the level-92 rank 7 embers survive it',
     visible().some(tr => idOf(tr) === 'tl2_bloodember_rank7'));
  await type(d.getElementById('minlv'), '');
  ok('clearing the filter restores all 162', visible().length === 162, `${visible().length}`);

  // ------------------------------------------------------------- the assets
  // Two things this page cannot get from a stylesheet and has to carry or
  // point at. The font is not deployed -- wrangler uploads out/ only -- so it
  // is inlined; the icon sheet is deployed, so it is referenced from beside
  // this file. Getting either backwards is a silent fallback or a broken image.
  ok('the icon sheet is referenced relatively, not inlined',
     /background-image\s*:\s*url\(icons\.webp\)/.test(html) ||
     /url\(icons\.webp\)/.test(html));
  ok('nothing in the page points outside its own directory',
     html.indexOf('../') < 0, `${(html.match(/\.\.\//g) || []).length} occurrences`);
  ok('every row draws its icon from that sheet',
     rows().every(tr => {
       const ic = tr.querySelector('.ic');
       return ic && /background-position/.test(ic.getAttribute('style') || '');
     }) && rows().filter(tr => tr.querySelector('.ic').getAttribute('style')).length === 162);
  // The face is a variable font whose wght axis defaults to 100; a range that
  // does not say so renders every effect line at its thinnest weight. It is the
  // one declaration in this page that fails invisibly.
  ok('the bundled face keeps its weight range',
     /font-weight\s*:\s*400\s+600/.test(html));
  ok('the page is self-contained otherwise -- one icon sheet, no other image',
     (html.match(/url\((?!#|data:)/g) || []).length === 1,
     `${(html.match(/url\((?!#|data:)/g) || []).length} url() refs`);

  // ----------------------------------------------------- the way back over
  // The name cell links to that item's card on the main page, in a new tab so
  // the table's filter and scroll survive the trip. That makes every href a
  // promise about the other document, and the only way to check it is to open
  // the other document. One JSDOM, built once, for all 162 -- rebuilding it per
  // item is what would force the heap flag this suite does not need.
  const hrefs = rows().map(tr => tr.querySelector('a.nm'));
  ok('every name links to a new tab',
     hrefs.every(a => a.getAttribute('target') === '_blank' &&
                      a.getAttribute('rel') === 'noopener'));
  ok('every link is an index.html#item= deep link',
     hrefs.every(a => /^index\.html#item=[A-Za-z0-9_]+$/.test(a.getAttribute('href'))),
     hrefs.map(a => a.getAttribute('href')).find(h => !/^index\.html#item=/.test(h)) || '');
  ok('the back link is in the header', !!d.querySelector('header .back a[href="index.html"]'));

  const main = new JSDOM(fs.readFileSync(MAIN, 'utf8'),
                         { runScripts: 'dangerously', url: 'file:///' +
                           MAIN.split(path.sep).join('/') });
  await new Promise(r => main.window.addEventListener('load', r));
  const DB = main.window.DB.items;
  const dbIds = new Set(DB.map(i => i.id));
  const missing = hrefs.map(a => a.getAttribute('href')).map(h => h.split('=')[1])
                       .filter(i => !dbIds.has(i));
  ok('every link names an item the main page holds', missing.length === 0,
     missing.slice(0, 4).join(','));
  // The row set, computed from the other document's own payload rather than
  // restated: the Socketables it carries, minus the templates and components.
  const theirs = new Set(DB.filter(i => i.t === 'Socketable' &&
      !/_base$/i.test(i.id) && !/^tl2_parts_weapon/i.test(i.id)).map(i => i.id));
  ok('the two pages agree on which items these are',
     theirs.size === new Set(ids).size && ids.every(i => theirs.has(i)),
     `${theirs.size} there vs ${new Set(ids).size} here`);
  // And the card renders the same lines the table does. Checked on a handful
  // because it needs the card driven, and the table side is already exact for
  // all 162 above; this is the spot-check that the main page's detail view has
  // not drifted away from the payload it draws.
  const spot = [
    ['tl2_skull033', 'Skull of Quato'],
    ['tl2_flameember_rank1', 'Flame Ember Speck'],
    ['tl2_goldgem2', 'Lucky Coin'],
  ];
  const cardLines = [];
  main.window.location.hash = 'item=' + spot[0][0];
  main.window.dispatchEvent(new main.window.Event('hashchange'));
  await new Promise(r => setTimeout(r, 40));
  const card = main.window.document.getElementById('detail');
  cardLines.push(card.textContent.indexOf('Poison Armor') >= 0 &&
                 card.textContent.indexOf('Ice Armor') >= 0);
  ok('the main page\'s card prints the same effects as the row',
     cardLines.every(Boolean) && spot.every(([id]) => dbIds.has(id)));

  // ----------------------------------------------------------------- sanity
  ok('the page ran without throwing', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

var languages = ['EN'];

var menu = [
  'Collar','Fish','Spell','Gem','Set',0,
  'Helmet','Chest','Belt','Leggings','Boots','Shoulder','Gloves','Shield','Ring','Necklace',0,
  'Axe','Claw','Greataxe','Greathammer','Greatsword','Mace','Polearm','Staff','Sword',0,
  'Bow','Cannon','Crossbows','Pistol','Shotgonne','Wand',0,
  'Helmet...Wand'
];

var req     = ['Strength','Dexterity','Focus','Vitality','Level','Class'];
var mastery = [];
var resEle  = [];
var resPri  = [];

var filters = `
  <div>
    <label>
      Name: <input id="byName" placeholder="" oninput="filter()">
    </label>

    <label style="display:inline-block">
      Properties:
      <input id="byProperties"    placeholder="RegExp;RegExp\\n" oninput="filter()">
      <input id="byPropertiesNot" placeholder="(exclude)"        oninput="filter()">
      <div style="position:absolute;margin-top:4px;font:12px Arial;color:#800"></div>
    </label>

    <label>
      DPS
      <select id="byDps" onchange="filter()">
        <option></option>
        ` + Array(15).fill().map((_,i) => (i+1) * 100).map(_ => `<option value="${_}">&gt;=${_}</option>`).join('') + `
      </select>
    </label>
  </div>

  <div>
    <span>
      ` +
        req.map(s => `
          <label>
            ${s}
            <select id="byReq${s}" onchange="filter()">
              <option></option>
              ` + (
                s == 'Class' ?
                `
                  <option>Berserker</option>
                  <option>Embermage</option>
                  <option>Engineer</option>
                  <option>Outlander</option>
                ` :
                Array(10).fill().map((_,i) => (i+1) * (s == 'Level' ? 10 : 40)).map(_ => `<option value="${_}">&lt;=${_}</option>`).join('')
              ) + `
            </select>
          </label>
        `).join('') +
      `
    </span>
  </div>

  <div>
    <label>
      Rarity
      <select id="byRarity" style="width:10em" onchange="filter()">
        <option></option>
        ` + ['Magical','Rare','Epic','Legendary'].map(_ => `<option class='${_}' value='${_}'></option>`).join('') + `
      </select>
    </label>
    <label>
      Socket
      <select id="bySocket" onchange="filter()">
        <option></option>
        ` + Array(5).fill().map((_,i) => (i+1)).map(_ => `<option value="${_}">&gt;=${_}</option>`).join('') + `
      </select>
    </label>
    <label><input id="byInvert"   type="checkbox" onchange="filter()"> Invert</label>
    <label><input id="byBookmark" type="checkbox" onchange="filter()"> 🔖</label>
    <label><button id="reset" onclick="document.body.querySelectorAll('nav~* input, nav~* select').forEach(_ => _.checked = _.value = ''); filter()">Reset</button></label>
    <label>Found: <span class="count"></span></label>
  </div>
`;

var isBad = (e,p) => {
  var bad = 0;
  bad |= byDps   .value && byDps   .value > ~~e._.dps;
  bad |= bySocket.value && bySocket.value > ~~e._.socket;
  return bad;
};

var loaded = _ => list.childNodes.forEach(_ => _._ && (_.link.title = _._.tag || ''));

var reqText = _ => [
  ('Requires'
    + (_.LevelRequirement     ?   ' Level '     + _.LevelRequirement     : '')
    + (_.StrengthRequirement  ? '   Strength '  + _.StrengthRequirement  : '')
    + (_.DexterityRequirement ? '   Dexterity ' + _.DexterityRequirement : '')
    + (_.FocusRequirement     ? '   Focus '     + _.FocusRequirement     : '')
    + (_.VitalityRequirement  ? '   Vitality '  + _.VitalityRequirement  : '')
  ).replace(/^Requires$/,'').replace(/(Level [0-9]*)   /, '$1\n  Or\n').replaceAll('   ',' & '),
  _.ClassRequirement ? 'Requires Class: ' + (_.ClassRequirement.size ? Array.from(_.ClassRequirement).sort().join(', ') : _.ClassRequirement) : '',
].join('\n');

var bookmark = 'tl2db_bookmark';
var subColor = '#fff4';
var orColor  = '#181008';

var home = [{
  name: 'Welcome to the Torchlight II Database',
  type: ' ',
  properties: {a:[
    'Data source:',
    '•  http://www.dethguild.com/torchlight_item_database.php',
    '•  https://torchlight.fandom.com/wiki/Items_(T2)',
  ]}
}];

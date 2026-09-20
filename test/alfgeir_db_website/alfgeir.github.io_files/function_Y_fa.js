function t(parent,tag,_,style) {
  var e = document.createElement(tag);
  if (typeof style == 'string')
    e.classList.add(style);
  else
    Object.keys(style || 0).forEach(_ => e.style[_] = style[_]);

  if (_) e.innerText = _;
  if (parent) parent.append(e);
  return e;
}

function getBookmark() {
  try {
    return JSON.parse(localStorage.getItem(bookmark)) || [];
  } catch(e) {
    return [];
  }
}

function exportBookmark() {
  var a = t(0,'a');
  a.href = URL.createObjectURL(new Blob([getBookmark().map(_ => location.origin + location.pathname + _).join('\n')], {type:'application/octet-stream'}));
  a.setAttribute('download', location.hostname + location.pathname.replaceAll('/',' ') + 'bookmark.txt');
  a.click();
}

function importBookmark(_) {
  var r = new FileReader();
  r.onload = _ => {
    localStorage.setItem(bookmark, JSON.stringify(r.result.split('\n').map(_ => _.replace(/^http[^#]*/,'')).filter(_ => _.startsWith('#'))));
    load();
  };
  r.readAsText(_);
}

function setCount(_) {
  document.querySelectorAll('.count').forEach(c => c.innerText = _);
}

function filter(now) {
  setCount('... / ' + list.children.length);
  clearTimeout(filter.timeout);
  filter.timeout = setTimeout(_ => {
    list.style.opacity = 1;
    if (!list.children[0]?._) return;

    try {
      var r1 = byProperties   .value && byProperties   .value.split(';').map(_ => new RegExp(_,'is'));
      var r2 = byPropertiesNot.value && byPropertiesNot.value.split(';').map(_ => new RegExp(_,'is'));
      byProperties.parentElement.lastElementChild.innerText = '';
    } catch(e) {
      byProperties.parentElement.lastElementChild.innerText = e.message;
    }

    var b = getBookmark();
    list.childNodes.forEach(e => {
      var i = b.includes(e.bookmark.href_);
      e.bookmark.classList.toggle('ed',i);

      var bad = e.p.every(p => {
        var bad = isBad(e,p);
        if (byProperties   .value) bad |= r1 ? !r1.every(_ => p.textContent.match(_)) : !p.textContent.includes(byProperties   .value);
        if (byPropertiesNot.value) bad |= r2 ?  r2.some (_ => p.textContent.match(_)) :  p.textContent.includes(byPropertiesNot.value);

        bad |= req.map(_ => [ window[ 'byReq' + _ ]?.value, e._[_+'Requirement'] ]).some(_ => _[0] && _[1] && (_[1] > 0 ? _[1] > _[0] : _[1].size ? !_[1].has(_[0]) : _[1] != _[0]));

        bad |= mastery             .map(_ => [ window[ 'bySkill'  + _ ]?.value, ~~p['Skill' +_] ]).some(_ => _[0] && _[1] < _[0]);
        bad |= resPri.concat('Sum').map(_ => [ window[ 'byResPri' + _ ]?.value, ~~p['ResPri'+_] ]).some(_ => _[0] && _[1] < _[0]);

        var n = _ => _.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        bad |= byBookmark.checked && !i;
        bad |= byName    .value   && !n(byName.value).split(/ +/).every(_ => n(e._.name).includes(_));
        bad |= byRarity  .value   && !e.classList.contains(byRarity.value);
        return bad;
      });
      e.style.display = (bad ^ byInvert.checked) ? 'none' : '';
    });

    var _ = Array.from(list.children).filter(_ => !_.style.display);
    setCount(_.length + ' / ' + list.children.length);
    if (!now && location.hash.split('#').length > 3 && !filter.ed.every((f,i) => f == _[i]))
      history.pushState(null, '', lastHash = location.hash.split('#').slice(0,3).join('#'));
    else
      filter.ed = _.concat(null);

    var set;
    list.childNodes.forEach(e => {
      var show = _ => {
        e.style.opacity = .5;
        e.style.display = '';
      };

      e.style.opacity = 1;
      if (e.items) {
        if (e.style.display && e.items.some(_ => !_.style.display)) show();
        set = e;
        return;
      }

      if (set && set._.name == e._.set && !set.style.display && e.style.display) show();
    });

    history.replaceState(
      Array.from(document.body.querySelectorAll('nav~* input, nav~* select')).map(_ => (_.type == 'checkbox') ? _.checked : _.value), '',
      location.hash.replace(new RegExp('#' + lang.value + '$'), ''));
  }, !now && 200);
}

async function load() {
  var c = location.hash.split('#')[1]?.replace(/[^a-zA-Z]*/g,'');
  var l = location.hash.split('#')[2]?.replace(/[^a-zA-Z]*/g,'') || lang.value;

  load.names = load.names || {};
  var getName = async _ => {
    load.names[c+l+_] = {};
    if (c == 'Bookmark') return;
    if (l == _) return;

    var [f1,f2] = await Promise.all([
      fetch(`data/${c}/${l}.name`),
      fetch(`data/${c}/${_}.name`),
    ]);
    var t1 = await f1.text();
    var t2 = await f2.text();
    t1 = t1.split('\n');
    t2 = t2.split('\n');
    t1.forEach((t,i) => load.names[c+l+_][t] = t2[i]);
  };

  var m = {
    m: _ => {
      var a = [
        [
          /ReqReduction/, /racialBonusPercentDefense/, /augmentSkill/, /augmentMastery/, /augmentAllLevel/,
          /offensiveGlobalChance/, /retaliationGlobalChance/, /itemSkillName/, /petBonus/, /Summon/, /Abilities/,
        ],[
          /Race/, /lifeMonitorPercent/, /skillChanceWeight/, /spawnObjectsTimeToLive/,
          /offensivePhysical$/, /offensiveBase/, /offensivePierceRatio$/, /defensiveBlock/, /characterAttackSpeed$/,
        ],[
          /defensiveProtection/, /Cooldown/, /offensive/, /defensive/, /Speed/,
        ]
      ];

      // offensiveGlobalChance - first z
      // offensivePhysical     - then  0
      for (var i = 0; i < a   .length; i++)
      for (var j = 0; j < a[i].length; j++)
        if (_.match(a[i][j])) return 'z01'[i] + j.toString(36) + _;

      return _;
    }
  };
  var property = (parent,_,bonus) => {
    var e = t(parent,'div');
    if (Array.isArray(_)) {
      _.forEach((_,i,a) => {
        if (parent == list.set) {
          parent.p.push(t(e, 'div', `${2+i} items`));
          property(e.lastChild,_);
        } else {
          if (i) {
            t(e, 'span', '<OR>', {
              position:   'absolute',
              margin:     '4px 0',
              left:       'calc(50% - 32px)',
              width:      '64px',
              background: orColor,
              textAlign:  'center',
              color:      '#fff8',
            });
            t(e, 'hr', 0, { margin: 'calc(1lh / 2 + 3px) 0', border: '1px solid transparent', borderBottomColor: '#ddd' });
          }

          parent.p.push(property(e,_));
        }

        e.lastChild.style.marginLeft = 0;
      });

      if (!_.length) parent.p.push(property(e));
      return e;
    }

    var h  = (parent,_) => _ && (t(parent,'span',0,'help').title = _);
    var __ = _;
    var ee = e;
    parent.p?.push(e);
    Object.keys(_ || 0).forEach(_ => m[_] = m[_] || m.m(_));
    Object.keys(_ || 0).sort((a,b) => (m[a] > m[b]) - (m[a] < m[b])).concat(Object.keys(bonus || 0)).forEach((k,i,a) => {
      var b = i >= Object.keys(__ || 0).length;
      var _ = __;
      var e = ee;
      if (b) {
        _ = bonus;
        e = t(ee, 'span', 0, {display:'none'});
      }

      if (_[k].chance) {
        e.append(_[k].chance + '\n');
        property(e, _[k].properties);
      } else if (k.startsWith('itemSkillName')) {
        var n = _[k].properties?.Summon ? [_[k].name] : _[k].name.split(/ *(\p{Ps}.*)/u); // asserted
        n[1] = n[1] || _[k].trigger || '';
        if (i && !e.textContent.endsWith('\n\n')) e.append('\n');
        h(t(e, 'span', 'Grants skill: ' + (n[0] || '')), _[k].description);
        property(e, _[k].properties).prepend(n[1] ? n[1].trim() + '\n' : '');
        ee.grantSkill = 1;
      } else if (k.startsWith('petBonus')) {
        if (i && !e.textContent.endsWith('\n\n') && parent._) e.append('\n'); // not completion bonus
        e.append('Bonus to All Pets:\n');
        property(e, _[k]);
        ee.petBonus = 1;
      } else if (k == 'Summon') {
        e.append('Summon: ' + (_[k].name || ''));
        property(e, _[k].properties);
        _[k].Abilities?.forEach(_ => h(t(e, 'div', 'skill: ' + (_.name || '')), _.description));
      } else if (k == 'Abilities') {
        var a = t(e, 'a', '\n(show skills)\n');
        a.href = '#';
        a.onclick = $ => {
          $.preventDefault();
          a.remove();
          _[k].forEach(_ => {
            e.append('\n'); // creature
            h(t(e, 'span', 'skill: ' + (_.name || '')), _.description);
            property(e, _.properties);
          });
        };
      } else {
        // defensivePhysical: 8.0% Chance of 100% Physical Resistance
        var add = (k,_) => ee[k] = ~~ee[k] + ~~_.replace(/[^-0-9]+/g,' ');
        if (k.startsWith('augmentSkillName')) {
          e.append(_[k].name + '\n');
          return;
        } else if (k.startsWith('augmentMasteryName')) {
          e.append(_[k].name + '\n');
          add('Skill' + masteryTag[_[k].tag], _[k].name);
          return;
        }

        if      (k == 'augmentAllLevel')              mastery.forEach(s =>                                                      add('Skill' +s, _[k]));
        else if (k == 'defensiveElementalResistance') resEle .forEach(s =>                                                      add('ResPri'+s, _[k]));
        else                                          resPri .forEach(s => (k == 'defensive' + s.replace('Vitality','Life')) && add('ResPri'+s, _[k]));

        // Gates of Hell: racialBonusPercentDefense: duplicate array
        new Set([].concat(_[k]).flat()).forEach(_ => {
          _ = _.split('\n');
          for (var i = 0; i < _.length; i++) {
            e.append(_[i].trim()); // #Creature#JP#Claes - need trim
            while (_[i+1]?.match(/^#[0-9a-fA-J]+$/)) {
              t(e, 'span', _[i+2], { color: _[i+1].replace(/[A-J]/g, _ => _.charCodeAt(0) - 'A'.charCodeAt(0)) });
              i += 2;
            }
            e.append('\n');
          }
        });

        if (parent._?.combined) {
          var x = _ => (m[_] != _) ? m[_][0] : '';
          if (a[i+1] && x(a[i+1]) != x(k)) e.append('\n');
        } else if (['characterAttackSpeed','defensiveBlock'].includes(k)) {
          e.append('\n');
        }
      }
    });

    e.ResPriSum = 0;
    resPri.forEach(s => e.ResPriSum += ~~e['ResPri'+s]);
    return e;
  };

  var loot = (parent,_,lang,max) => {
    var e = t(parent,'div',0,'loot');

    var last;
    var f = _ => {
      if (_[0] != last?.[0]) {
        var a = t(t(e, 'span', 0, { gridColumn:'1 / 6' }), 'a', (last ? '\n' : '') + _[0]);
        if ('ec'.includes(_[2])) a.href = getLink('Creature', _[0], lang);
        last = _;
      }

      var c = ['Normal','Epic','Legendary'][_[1]];
      t(e, 'span', classification[ c + '_' + lang ] || c, {marginLeft:'1em'});
      t(e, 'span');
      t(e, 'span', { q:'Quest', e:'Equiped', c:'Chest' }[_[2]]);
      t(e, 'span');
      t(e, 'span', _[3].toFixed(2) + '%', { marginRight:'1em', textAlign:'right' });
    };
    _.slice(0,max).forEach(f);

    if (_.length > max) {
      var a = t(t(e, 'span', 0, { gridColumn:'1 / 6' }), 'a', '(show all)');
      a.href = '#';
      a.onclick = e => {
        e.preventDefault();
        a.remove();
        _.slice(max).forEach(f);
      };
    }
  };

  var png = _ => {
    var e = _ => {
      var n = _.childNodes;
      if (!n.length) return;
      if (n.length == 1 && n[0].nodeType == 3) return;

      for (var i = 0; i < n.length; i++) {
        if (n[i].nodeType == 3) {
          var s = document.createElement('span');
          s.innerText = n[i].textContent;
          n[i].after(s);
          n[i].remove();
        } else {
          e(n[i]);
        }
      }
    };
    e(_);
    e(_);
    _.classList.add('canvas');

    var e = document.createElement('canvas');
    var R = _.getBoundingClientRect();
    e.width  = Math.round(R.width);
    e.height = Math.round(R.height);

    var c = e.getContext('2d');
    c.fillRect(0, 0, R.width, R.height);

    var x = _ => +_.replace('px','');
    var d = (_,root) => {
      var s = getComputedStyle(_);
      if (root && s.position == 'absolute') return root.push(_);

      var r = _.getBoundingClientRect();
      c.fillStyle = s.backgroundColor;
      c.fillRect(r.x - R.x, r.y - R.y, r.width, r.height);

      var w = x(s.borderTopWidth);
      if (w) {
        c.lineWidth   = w;
        c.strokeStyle = s.borderTopColor;
        c.beginPath();
        c.moveTo(r.x - R.x,           r.y - R.y + .5);
        c.lineTo(r.x - R.x + r.width, r.y - R.y + .5);
        c.stroke();
      }

      var w = x(s.borderBottomWidth);
      if (w) {
        c.lineWidth   = w;
        c.strokeStyle = s.borderBottomColor;
        c.beginPath();
        c.moveTo(r.x - R.x,           r.y - R.y + r.height - .5);
        c.lineTo(r.x - R.x + r.width, r.y - R.y + r.height - .5);
        c.stroke();
      }

      var n = _.childNodes;
      if (n.length != 1 || n[0].nodeType != 3) {
        if (s.position != 'static') root = [];
        n.forEach(_ => d(_,root));
        if (s.position != 'static') root.forEach(_ => d(_));
        return;
      }

      var b = [0];
      var $ = document.createRange();
      for (var i = 1; i < n[0].length; i++) {
        $.setStart(n[0], i-1);
        $.setEnd  (n[0], i+1);
        if (new Set(Array.from($.getClientRects()).map(_ => _.y)).size > 1) b.unshift(i);
      }

      while (r.height - x(s.paddingTop) - x(s.paddingBottom) >= x(s.lineHeight) * (b.length + 1)) b.unshift(n[0].length);

      c.font         = s.font;
      c.textAlign    = s.textAlign;
      c.fillStyle    = s.color;
      c.textBaseline = 'top';
      b.map((b,i,a) => _.textContent.slice(b, a[i-1])).forEach((_,i) => c.fillText(_,
        r.x - R.x + (s.textAlign == 'center' ? r.width / 2 : s.textAlign == 'right' ? r.width - 1 - x(s.paddingRight) : x(s.paddingLeft)),
        r.y - R.y + (x(s.lineHeight) * b.length - r.height) / 2 + r.height - x(s.paddingBottom) - x(s.fontSize) - x(s.lineHeight) * i));
    };
    d(_);
    _.classList.remove('canvas');

    var i = e.toDataURL().split(',');
    return URL.createObjectURL(new Blob([Uint8Array.fromBase64(i[1])], { type: i[0].replace(/data:|;base64/g,'') }));
  };

  var h = location.href + '#';
  Array.from(document.querySelectorAll('.header:first-child nav a')).reverse().forEach(_ => {
    if (h.startsWith(_.href.replace(/#$/,'') + '#')) {
      h = '';
      _.style.background = 'yellow';
    } else {
      _.style.background = '';
    }
  });

  document.title = location.hash.slice(1).replace(/#[^#]*#?/,' \xa0');
  document.querySelectorAll('[href="#lang"]').forEach(_ => _.style.display = (l == lang.value) ? 'none' : '');
  byRarity.childNodes.forEach(_ => _.value && (_.innerText = classification[ _.value + '_' + lang.value ] || _.value));
  document.querySelector('.combine').style.display = (c == 'Bookmark') ? '' : 'none';

  list.innerHTML = '<span style="color:#333">loading...</span>';
  if (c != 'Bookmark') combined.innerHTML = '';
  getName.ing = !load.names[c+l+lang.value] && getName(lang.value);
  if (!load[c+l] || c == 'Bookmark') {
    try {
      if (!c) {
        o = home;
      } else if (c == 'Bookmark') {
        var p = [];
        var b = getBookmark();
        load.cache = load.cache || {};
        b.forEach(b => load.cache[b+l] || p.push((async b => {
          var f = await fetch(`cache/${l}${b.split('#').slice(0,4).join('/')}`);
          if (!f.ok) throw [
            (f.statusText || f.status) + ': ' + b,
            'Remove and Retry',
            _ => {
              localStorage.setItem(bookmark, JSON.stringify(getBookmark().filter(_ => _ != b)));
              load();
            }
          ];

          load.cache[b+l] = await f.json();
        })(b)));
        if (p.length) await Promise.all(p);

        var o = [];
        var x = {};
        b.forEach(b =>
        load.cache[b+l].forEach(_ => {
          _.select   = b.split('#')[4]?.split(',');
          _.type     = b.split('#')[1];
          _.bookmark = b;

          var s = (Array.isArray(_.properties) && !_.equipment) ? _.name : _.set;
          if (!s)
            o.push(_);
          else if (x[s])
            o[ x[s] - 1 ][ _.set ? 'push' : 'unshift' ](_);
          else
            x[s] = o.push([_]);
        }));
        o = o.flat();
      } else {
        var p = !load.names[c+l+'EN'] && getName('EN');
        var f = await fetch(`data/${c}/${l}.json`);
        var o = await f.json();
        if (p) await p;
      }
    } catch(e) {
      if (e) console.dir(e);
      setCount('');
      list.innerHTML = '<span style="color:#f00"></span>';
      list.lastChild.innerText = e[0] || e;
      if (e[1]) t(list, 'button', e[1]).onclick = _ => confirm(e[1] + '?') && e[2]();
      return;
    }

    load[c+l] = [];
    list.set = null;
    o.forEach(draw = _ => {
      var e = t(0, 'div', 0, {
        Legendary: 'Legendary',
        Epic:      'Epic',
        Rare:      'Rare',
        Magical:   'Magical',
        Normal:    'Magical',

        Divine:    'Legendary',
        Greater:   'Epic',
        Lesser:    'Magical',

        Boss:      'Legendary',
        Quest:     'Epic',
        Hero:      'Rare',
      }[classification[_.classification]?.replace(' Artifact','')] || 'Normal');

      e._ = _;
      e.p = [];
      load[c+l].push(e);

      if (Array.isArray(_.properties) && !_.equipment) {
        e.style.marginBottom = '2em';
        e.items = [];
        list.set = e;
      } else if (_.set && _.set == list.set?._.name) {
        list.set.items.push(e);
        req.map(_ => _+'Requirement').forEach(_ => {
          if (!e._[_]) return;

          if (e._[_] > 0)
            list.set._[_] = Math.max(~~list.set._[_], e._[_]);
          else
            list.set._[_] = new Set(list.set._[_]).add(e._[_]);
        });
      }

      {
        var n = _.name.split(/(\([^)]+\))/);
        var s = t(e, 'span', n[0], {
          position:   'relative',
          padding:    '4px 52px 4px 4px',
          background: '#fff4',
        });
        if (n[1]) t(s, 'span', n[1], { fontSize:'15px', lineHeight:'15px', color:subColor });

        var a = t(s,'a','🎨','png');
        a.target = '_blank';
        a.href = '#';
        a.onmousedown = _ => _.target.href = png(e);

        t(s,'a',0,'link');
        (e.link = t(s,'a','🔗','link')).href = getLink(_.type || c, _.name, l);
      }

      {
        var s = t(e, 'span', 0, {
          padding:    '0 4px 4px',
          background: '#fff4',
          textAlign:  'right',
        });

        var x = t(s, 'span', (_.type || c).replace('Charm','Charm/') + '\n');
        if (!_.type) x.classList.add('canvasOnly');

        if (_.set) {
          var x = t(s,'span','Part of ');
          t(x,'a',_.set).href = getLink('Set', _.set, l);
          if (c == 'Set') x.classList.add('canvasOnly');
        }
      }

      (_.bonus || [0]).forEach((b,i) => {
        var p = property(e, _.properties, b.option);
        p.style.padding    = '8px 8px 0';
        p.style.background = '#fff8';
        if (!b) p.style.flexGrow = 1;
        if (i)  p.style.display  = 'none';
      });

      if (_.description) {
        var d = _.description.replace(/.*Can (enhance|enchant) (.*?)(only)?\./, '$2') + '\n\n';
        e.children[2].before(t(0,'span',d));
        e.children[2].style.cssText    = e.children[3].style.cssText;
        e.children[2].style.flexGrow   = 0;
        e.children[3].style.paddingTop = 0;
        e.p.forEach(_ => _.prepend(t(0, 'span', d, {display:'none'})));
      }

      if (_.equipment) {
        var x = _.equipment.split?.(',')
          .sort()
          .map(_ => _.split(/(mage|melee)/))
          .map((_,i,a) => {
            if (_[0] == a[i+1]?.[0]) _[1] += ', ' + a[i+1][1];
            _[0] = _[0].replace(/(.*).dbr/, 'dbr: $1');
            return !_[0].includes('monster') && (_[0] != 'roh') && (_[0] != a[i-1]?.[0]) && _.slice(0,2).join(': ');
          })
          .filter(_=>_)
          .sort((a,b) => {
            var e = _ => _.startsWith('dbr:');
            var i = _ => _.includes(':');
            var n = _ => _;
            var d = _ => (_(a) > _(b)) - (_(a) < _(b));
            return d(e) * 100 + d(i) * 10 + d(n);
          })
          .join('\n');

        if (x) e.p.forEach((_,i) => {
          var a = t(_, 'span', '\nEquipment:\n', {color:subColor});
          var b = t(_, 'div',  x,                {color:subColor});
          if (i != e.p.length - 1) {
            a.classList.add('canvasCountOnly');
            b.classList.add('canvasCountOnly');
          }
        });
      }

      if (_.reagent) {
        t(e.p[0], 'span', '\nReagent:\n');
        _.reagent.forEach(_ => {
          var a = t(e.p[0], 'a', _[1] + '\n', {marginLeft:'1em'});
          if (_[0] != 'Scroll') a.href = getLink(_[0], _[1], l);
        });
      }

      var selectable = (s,p) => {
        if (c != 'Bookmark') return;

        s.classList.add('selectable');
        s.oncontextmenu = _ => !_.altKey;
        s.onmousedown = (_,repeat) => {
          if (!_.altKey) return;

          var d = [1,,-1][_.button] * (repeat || 1);
          if (!d) return;

          var c = s.querySelector('.selectCount');
          var x = Math.max(0, ~~c?.c + d);
          _.preventDefault?.();
          if (!x) return c?.remove();

          if (!c) {
            c = t(0,'span',0,'selectCount');
            c.e = e;
            c._ = p;
            c.i = i;
            s.prepend(c);
          }
          c.innerText = (c.c = x) + '×';
        };

        var i = selectable.s = ~~selectable.s + 1;
        for (var j = 1; j < _.select?.length; j += 2)
          if (_.select[j] == i) s.onmousedown({ altKey:1, button:0 }, _.select[j-1]);
      };

      if (_.bonus) {
        var s = t(e,'span',0,'completionBonus');
        [0].concat(_.bonus).forEach(_ => {
          var b = t(s,'span');
          if (_) {
            selectable(b, [ e._.properties, _.option ]);
            property(b, _.option);
          } else {
            b.style.fontWeight = 'bold';
            b.innerText = 'Completion Bonus';
          }

          var c = t(s,'span');
          if (_) {
            c.innerText = _.chance.toFixed(1) + '%';
          } else {
            c.style.fontWeight = 'bold';
            c.innerText = 'Chance';
          }

          if (b.textContent.split('\n').length > 2) {
            b.classList.add('multiline');
            c.classList.add('multiline');
          }
        });
      } else if (_.type != 'Creature' && !_.combined) {
        [].concat(e._.properties).forEach((_,i) => selectable(e.p[i], [_]));
      }

      if (c != 'All' && _.loot) loot(t(e, 'span', 0, { padding: '8px 8px 0', background: '#fff8' }), _.loot, l, 1);

      {
        t(e, 'span', 0, {
          display:    'flex',
          alignItems: 'end',
          gap:        '1em',
          padding:    (c != 'All' && _.loot ? '8px' : '1lh') + ' 5px 8px 8px',
          background: '#fff8',
        });

        t(e.lastChild, 'span', reqText(_), {flexGrow:1});

        if (_.properties.Race) t(e.lastChild, 'span', _.classification);

        e.bookmark = t(e.lastChild,'a','🔖','bookmark');
        e.bookmark.href = e.bookmark.href_ = (c == 'Bookmark') ? _.bookmark : getLink(_.type || c, load.names[c+l+'EN'][_.name] || _.name, 'EN');
        e.bookmark.onclick = _ => {
          _.preventDefault();
          if (e.bookmark.classList.contains('ed') && !confirm(`−🔖: ${e._.name} ?`)) return;

          var b = getBookmark().filter(_ => _ != e.bookmark.href_);
          if (e.bookmark.classList.toggle('ed')) {
            b.push(e.bookmark.href_);
            alert(`+🔖: ${e._.name}`);
          }

          localStorage.setItem(bookmark, JSON.stringify(b));
          filter();
        };
      }

      if (!c) {
        var p = e.lastChild.style.paddingBottom;
        e.lastChild.remove();
        e.lastChild.style.paddingBottom = p;
        e.children[1].style.display = 'none';
        e.querySelectorAll('.png, .link, .bookmark').forEach(_ => _.style.display = 'none');
      }

      return e;
    });
  }

  if (getName.ing) await getName.ing;
  list.style.opacity = 0;
  list.innerHTML = '';
  load[c+l].forEach(_ => {
    var s = _.link.previousSibling;
    var n = load.names[c+l+lang.value][_._.name];
    if (n) {
      s.href = getLink(_._.type || c, n, lang.value);
      s.innerText = '🔄';
    } else {
      s.innerText = '';
    }

    list.append(_);
  });
  loaded();

  var _ = location.hash.split('#')[3];
  if (_) {
    reset.click();
    byName.value = decodeURIComponent(_.replaceAll('_',' '));
  }
  filter(1);
}

function combine() {
  var combine = c => {
    var p = {};
    var k = c.map(c => c._).flat().map(_ => Object.keys(_)).flat();
    new Set(k).forEach(k => {
      var _p = [];
      var _s = [];
      var _o = [];
      var _  = [];
      c.forEach(c =>
      c._.forEach(p => {
        var n = _ => _?.name || _;
        var v = n(p[k]);
        if (!v) return;

        if (k == 'petBonus') return _p.push({ c:c.c, _:[p[k]] });

        if (
          k == 'offensivePierceRatio' ||
          typeof v != 'string' ||
          v.match(/[0-9][^.0-9]+[0-9]/) ||
          (!v.match(/\+[0-9]|[0-9]%/) && k != 'defensiveProtection' && c.e)
        ) {
          if (typeof p[k] == 'string')
            _s.push(...new Array(c.c).fill(p[k].replace(/^ *|[ \n]*$/g,'') + (c.e ? `\n${subColor}\n (${c.e._.type})` : '')));
          else
            _o.push(...new Array(c.c).fill(p[k]));

          return;
        }

        var s = v.replace(/^ *|[ \n]*$/g,'').split(/([-.0-9]+)/);
        for (var i = 0; i < _.length; i++) {
          if (n(_[i]).every((_,i) => _.replace(/[-.0-9]+/,'') == s[i].replace(/[-.0-9]+/,''))) {
            n(_[i]).forEach((_,i,a) => +_ && (a[i] = ''+(+_ + s[i] * c.c)));
            return;
          }
        }

        s = s.map(_ => +_ ? ''+(_ * c.c) : _);
        if (p[k].name) {
          var o = JSON.parse(JSON.stringify(p[k]));
          o.name = s;
          _.push(o);
        } else {
          _.push(s);
        }
      }));

      if (_p.length) {
        p[k] = combine(_p);
        k += '_';
      }
      if (_s.length) {
        p[k] = _s.join('\n');
        k += '_';
      }
      _o.forEach(_ => {
        p[k] = _;
        k += '_';
      });
      _.forEach(_ => {
        if (_.name)
          _.name = _.name.join('');
        else
          _ = _.join('');

        p[k] = _;
        k += '_';
      });
    });
    return p;
  };

  var c = Array.from(document.querySelectorAll('.selectCount'));
  var o = { combined:1, name:'(Combined)', properties:combine(c) };
  req.map(_ => _+'Requirement').forEach(_ => c.forEach(c => {
    if (!c.e._[_]) return;

    if (c.e._[_] > 0)
      o[_] = Math.max(~~o[_], c.e._[_]);
    else if (c.e._[_].size)
      c.e._[_].forEach(_ => o[_] = new Set(o[_]).add(_));
    else
      o[_] = new Set(o[_]).add(c.e._[_]);
  }));

  var e = draw(o);
  e.link.style.right  = '4px';
  e.link.style.top    = '1px';
  e.link.style.cursor = 'pointer';
  e.link.innerText    = '🗙';
  e.link.onclick      = _ => e.remove();
  e.link.removeAttribute('href');
  combined.append(e);

  e.bookmark.removeAttribute('href');
  e.bookmark.prepend('Save');
  e.bookmark.onclick = _ => {
    var b = '';
    c.forEach((_,i) => {
      if (i && c[i-1].e == _.e)
        b += `,${_.c},${_.i}`;
      else
        b += (i ? '\n' : '') + _.e.bookmark.href.split('#').slice(0,4).join('#') + `#${_.c},${_.i}`;
    });

    var a = t(0,'a');
    a.href = URL.createObjectURL(new Blob([b], {type:'application/octet-stream'}));
    a.setAttribute('download', location.hostname + location.pathname.replaceAll('/',' ') + 'combined.txt');
    a.click();
  };

  var s = t(0, 'span', 0, {
    display:             'grid',
    gridTemplateColumns: 'max-content max-content 1fr',
    marginBottom:        '1em',
  });
  c.forEach(c => {
    var n = c.e._.name.split(/(\([^)]+\))/);
    t(s, 'span', c.innerText);
    t(s, 'span', c.e._.type, { marginRight:'.5em', color:subColor });
    t(s, 'span', n[0]);
    if (n[1]) t(s.lastChild, 'span', n[1], { fontSize:'15px', lineHeight:'15px', color:subColor });
  });
  e.p[0].prepend(s);
  e.firstChild.scrollIntoView({ behavior:'smooth', block:'center' });
}

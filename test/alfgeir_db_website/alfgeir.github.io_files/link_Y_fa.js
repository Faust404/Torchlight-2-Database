// Apep's Bracers - space after name
var getLink = (type,_,lang) => (
  '#' + type +
  '#' + lang +
  '#' + _.trim().replace(/ /g,'_').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
);

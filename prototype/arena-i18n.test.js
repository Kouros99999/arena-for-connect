const assert = require('node:assert/strict');
const { test } = require('node:test');
const I = require('./arena-i18n.js');

test('language resolves from the URL, then the saved choice, then the browser, else English', () => {
  assert.equal(I.resolve('?lang=es', 'fr', 'de-DE'), 'es');
  assert.equal(I.resolve('', 'fr', 'de-DE'), 'fr');
  assert.equal(I.resolve('', null, 'de-DE'), 'de');
  assert.equal(I.resolve('', null, 'pt-PT'), 'pt-BR');
  assert.equal(I.resolve('', null, 'ja-JP'), 'en');
  assert.equal(I.resolve('?lang=xx', 'yy', 'zz'), 'en');
});

test('every language has every string, and translations never collide with English keys', () => {
  const keys = Object.keys(I.DICT.es);
  for (const lang of ['es', 'fr', 'de', 'pt-BR']) {
    assert.equal(Object.keys(I.DICT[lang]).length, keys.length, lang);
    for (const k of keys) { assert.ok(I.DICT[lang][k], `${lang} missing ${k}`); }
  }
  assert.equal(I.t('Today', 'es'), 'Hoy'); assert.equal(I.t('Today', 'fr'), "Aujourd'hui"); assert.equal(I.t('Today', 'en'), 'Today'); assert.equal(I.t('not a key', 'de'), 'not a key');
  assert.ok(keys.length >= 100);
});

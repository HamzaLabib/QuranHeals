import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archiveEntries, parsePrimary, parseVerification, validateExact, editsBetween, fontNames } from './compare-kfgqpc.mjs';
import { sha256 } from './verify.mjs';

const root = new URL('../../', import.meta.url);
const zip = readFileSync(new URL('tools/quran-import/raw/UthmanicHafs_v2-0.zip', root));
const entries = archiveEntries(zip);
const primary = parsePrimary(entries.find(e => e.path.endsWith('/hafsData_v2-0.json')).bytes);
const secondary = parseVerification(readFileSync(new URL('./input/quran-uthmani.txt', import.meta.url)));
const byKey = new Map(secondary.map(r => [r.key, r.text]));

test('original ZIP and selected JSON have pinned SHA-256 values', () => {
  assert.equal(sha256(zip), 'a7b0e5591945712ec5e4d6142938ae4d1e9b49bdc89dff06222789bfebdfd72c');
  assert.equal(sha256(entries.find(e=>e.path.endsWith('/hafsData_v2-0.json')).bytes), 'd2960b3217962e7e4252abdcece67bea3d6b48271e4cd3af45bbbb2dd5c872ca');
});
test('all extracted package files retain their original bytes', () => {
  for (const e of entries.filter(e=>!e.path.endsWith('/'))) assert.ok(e.bytes.equals(readFileSync(new URL('tools/quran-import/staging/kfgqpc/' + e.path, root))));
});
test('both real corpora have complete unique valid references', () => {
  assert.equal(validateExact(primary).valid, true);
  assert.equal(validateExact(secondary).valid, true);
  assert.equal(primary.length, 6236);
  assert.equal(primary.filter(r => r.text === byKey.get(r.key)).length, 0);
});
test('missing, duplicate, invalid and empty records fail structure checks', () => {
  for (const rows of [primary.slice(1), [primary[1], ...primary.slice(1)], [{...primary[0],key:'115:1'}, ...primary.slice(1)], [{...primary[0],text:''}, ...primary.slice(1)]]) assert.equal(validateExact(rows).valid, false);
});
test('comparison does not normalize Unicode, trim whitespace or remove marks', () => {
  assert.notDeepEqual(editsBetween('é', 'e\u0301'), []);
  assert.notDeepEqual(editsBetween('a ', 'a'), []);
  assert.notDeepEqual(editsBetween('a\u06d6', 'a'), []);
  assert.deepEqual(editsBetween('exact', 'exact'), []);
});
test('every real mismatch edit sequence reconstructs the untouched Tanzil string', () => {
  for (const row of primary) {
    const a = [...row.text], b = [...byKey.get(row.key)], edits = editsBetween(row.text, b.join(''));
    let ai = 0, bi = 0, result = '';
    for (const e of edits) {
      const [startA,endA] = e.primaryRange, [startB,endB] = e.tanzilRange;
      assert.equal(a.slice(ai,startA).join(''), b.slice(bi,startB).join(''));
      assert.equal(a.slice(startA,endA).join(''), e.removed);
      assert.equal(b.slice(startB,endB).join(''), e.added);
      assert.deepEqual([...e.removed].map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')), e.removedCodePoints);
      assert.deepEqual([...e.added].map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')), e.addedCodePoints);
      result += a.slice(ai,startA).join('') + e.added;
      ai = endA; bi = endB;
    }
    result += a.slice(ai).join('');
    assert.equal(result,b.join(''),row.key);
  }
});
test('embedded font evidence includes both EULA grant and reproduction restriction', () => {
  const names = fontNames(entries.find(e=>e.path.endsWith('.ttf')).bytes);
  assert.ok(names.some(n=>n.nameId===13 && n.text.includes('Use, Copy, Distribute')));
  assert.ok(names.some(n=>n.nameId===0 && n.text.includes('express written approval')));
});

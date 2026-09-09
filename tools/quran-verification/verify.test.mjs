import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readTanzil, validateRecords, canonicalHash, assertCanonicalHash, classifyDifference, compareCorpora } from './verify.mjs';

const rows = readTanzil(readFileSync(new URL('./input/quran-uthmani.txt', import.meta.url)));
test('user-supplied source passes exact byte pin and all structural checks', () => {
  assert.equal(validateRecords(rows).valid, true);
  assert.equal(rows.length, 6236);
});
test('changed original file is refused before parsing', () => {
  const bytes = readFileSync(new URL('./input/quran-uthmani.txt', import.meta.url));
  assert.throws(() => readTanzil(Buffer.concat([bytes, Buffer.from('\n')])));
});
test('count, missing surah, duplicate references and empty canonical text fail', () => {
  for (const modified of [rows.slice(1), rows.filter(r => !r.verse_key.startsWith('114:')), [rows[1], ...rows.slice(1)], [{ ...rows[0], text_uthmani: '' }, ...rows.slice(1)]]) assert.equal(validateRecords(modified).valid, false);
});
test('canonical ordered hash detects changes and ignores input row ordering', () => {
  const hash = canonicalHash(rows);
  assertCanonicalHash([...rows].reverse(), hash);
  assert.throws(() => assertCanonicalHash([{ ...rows[0], text_uthmani: rows[0].text_uthmani + ' ' }, ...rows.slice(1)], hash));
  assert.throws(() => assertCanonicalHash(rows, null));
});
test('diagnostics are conservative and preserve original strings', () => {
  assert.equal(classifyDifference('x', 'x'), 'exact match');
  assert.equal(classifyDifference('x ', 'x'), 'whitespace difference');
  assert.equal(classifyDifference('é', 'e\u0301'), 'Unicode representation difference');
  assert.equal(classifyDifference('x\u06de', 'x'), 'Quranic annotation/mark difference');
  assert.equal(classifyDifference('x\u0653', 'x'), 'potentially substantive textual difference');
  const modified = [{ ...rows[0], text_uthmani: rows[0].text_uthmani + 'X' }, ...rows.slice(1)];
  const report = compareCorpora(modified, rows);
  assert.equal(report.result, 'FAIL — MANUAL REVIEW REQUIRED');
  assert.equal(report.differences[0].kingFahdOriginal, modified[0].text_uthmani);
  assert.equal(report.differences[0].tanzilOriginal, rows[0].text_uthmani);
});
test('incomplete corpus can never pass comparison', () => {
  assert.equal(compareCorpora(rows.slice(1), rows).result, 'FAIL — MANUAL REVIEW REQUIRED');
});

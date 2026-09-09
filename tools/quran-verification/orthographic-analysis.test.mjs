import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeRow, applyRule, basmalaPrefix, classify, runAnalysis, tokens } from './orthographic-analysis.mjs';
import { sha256 } from './verify.mjs';

const protectedPaths=[
  '../quran-import/raw/UthmanicHafs_v2-0.zip', './input/quran-uthmani.txt',
  './output/kfgqpc-comparison.json', './output/kfgqpc-comparison-report.md',
];
const hashes=protectedPaths.map(p=>sha256(readFileSync(new URL(p,import.meta.url))));
const analysis=runAnalysis();

test('second-stage analysis authenticates all originals and changes no protected file',()=>{
  assert.deepEqual(protectedPaths.map(p=>sha256(readFileSync(new URL(p,import.meta.url)))),hashes);
  assert.equal(analysis.rows.length,6236);
  assert.equal(analysis.summary.unknownCodePoints,0);
});

test('all presentation stages can be replayed from complete original-position deletions',()=>{
  for(const row of analysis.rows){
    const originals={kingFahd:[...row.originals.kingFahd],tanzil:[...row.originals.tanzil]};
    const removed={kingFahd:new Set(),tanzil:new Set()};
    for(const [stage,trace] of Object.entries(row.removalTrace)){
      const strings={};
      for(const source of ['kingFahd','tanzil']){
        assert.equal(row.sourceClasses[source].length,originals[source].length);
        for(const p of trace[source]){
          assert.ok(Number.isInteger(p)&&p>=0&&p<originals[source].length);
          assert.equal(removed[source].has(p),false,'Original position removed twice');
          removed[source].add(p);
        }
        strings[source]=originals[source].filter((_,p)=>!removed[source].has(p)).join('');
      }
      assert.equal(strings.kingFahd===strings.tanzil,row.stageEqual[stage],`${row.verseKey} ${stage}`);
      if(stage==='strict_base'){
        assert.equal(strings.kingFahd,row.strictBase.kingFahd.text);
        assert.equal(strings.tanzil,row.strictBase.tanzil.text);
      }
    }
  }
});

test('retained strict-base characters map exactly to original code points',()=>{
  for(const row of analysis.rows)for(const source of ['kingFahd','tanzil']){
    const chars=[...row.strictBase[source].text], originals=[...row.originals[source]];
    assert.equal(chars.length,row.strictBase[source].originalCodePointPositions.length);
    chars.forEach((c,i)=>{
      const positions=row.strictBase[source].originalCodePointPositions[i];
      assert.equal(positions.length,1);
      assert.equal(c,originals[positions[0]]);
    });
  }
});

test('basmala handling is restricted and records both exceptional prefix variants',()=>{
  assert.equal(analysis.basmala.rows.length,112);
  assert.equal(analysis.summary.basmalaTanzilOnly,112);
  assert.deepEqual(analysis.basmala.rows.filter(r=>r.tanzil.differsExactlyFromSourceReference).map(r=>r.verseKey),['95:1','97:1']);
  const original=analysis.rows.find(r=>r.verseKey==='2:1').originals.tanzil;
  for(const key of ['1:1','9:1','27:30'])assert.equal(basmalaPrefix(original,key,analysis.basmala.references.tanzil),null);
});

test('canonical composition cannot cross removed spacing or intervening marks',()=>{
  const adjacent=tokens('\u0627\u0654','1:1','tanzil');
  const yes=applyRule(adjacent,'canonical_hamza_composition');
  assert.equal(yes.tokens.map(t=>t.c).join(''),'\u0623');
  assert.deepEqual(yes.replacements[0].originalPositions,[0,1]);
  const separated=tokens('\u0627 \u0654','1:1','tanzil').filter(t=>t.cls!==6);
  assert.equal(applyRule(separated,'canonical_hamza_composition').replacements.length,0);
  assert.equal(applyRule(tokens('\u0627\u064e\u0654','1:1','tanzil'),'canonical_hamza_composition').replacements.length,0);
  assert.equal(applyRule(tokens('\u0649\u0654','1:1','tanzil'),'canonical_hamza_composition').replacements.length,0);
});

test('marker classification is position/source/key specific and unknowns remain unknown',()=>{
  assert.equal(classify('\ufc00',1,2,'1:1','kingFahd'),4);
  assert.notEqual(classify('\ufc00',0,2,'1:1','kingFahd'),4);
  assert.notEqual(classify('\ufc00',1,2,'1:1','tanzil'),4);
  assert.notEqual(classify('\ufc00',1,2,'1:2','kingFahd'),4);
  assert.equal(classify('\u{10ffff}',0,1,'1:1','tanzil'),7);
});

test('candidate letter folds never reduce the accepted manual-review set',()=>{
  assert.equal(analysis.summary.strictBaseMatches,3738);
  assert.equal(analysis.summary.strictBaseMismatches,2498);
  assert.equal(analysis.summary.initial2672ExplainedAtStrictBase,174);
  assert.equal(analysis.summary.humanReviewCount,2498);
  assert.equal(analysis.summary.annotationOnlyWithoutBasmala,3614);
  assert.equal(analysis.summary.markerWhitespaceOnly+analysis.summary.basmalaPlusStructureResolved+analysis.summary.annotationOnlyWithoutBasmala+analysis.summary.basmalaPlusAnnotationsResolved,3738);
  assert.equal(analysis.remainingVerseKeys.length,analysis.reviewSet.length);
  assert.equal(new Set(analysis.remainingVerseKeys).size,2498);
  assert.equal(analysis.strictBasePatternGroups.length,8);
  assert.equal(analysis.strictBasePatternGroups.reduce((s,g)=>s+g.count,0),2498);
  assert.equal(analysis.representativeReviewKeys.length,10);
  assert.equal(analysis.candidateExperiments.at(-1).remaining,273);
  assert.ok(analysis.reviewSet.every(r=>r.confidence.semanticEquivalence==='not established'));
});

test('excluding marks may yield matching bases but cannot establish semantic equality',()=>{
  const row={verseKey:'2:2',kingFahdText:'\u0628\u064e',tanzilText:'\u0628\u064f',affectsLetterCodePoints:false};
  const result=analyzeRow(row,{kingFahd:'',tanzil:''});
  assert.equal(result.stageEqual.raw,false);
  assert.equal(result.stageEqual.strict_base,true);
  assert.equal(result.originals.kingFahd,row.kingFahdText);
  assert.equal(result.originals.tanzil,row.tanzilText);
});

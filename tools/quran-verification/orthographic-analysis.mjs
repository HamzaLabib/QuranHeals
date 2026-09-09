import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './verify.mjs';
import { archiveEntries, parsePrimary, parseVerification, editsBetween } from './compare-kfgqpc.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(resolve(root, p));
const reportPath = 'tools/quran-verification/output/kfgqpc-comparison.json';
const names = JSON.parse(read('tools/quran-verification/reference/unicode-names.json')).names;
const code = c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
const isBase = n => (n >= 0x621 && n <= 0x63a) || (n >= 0x641 && n <= 0x64a) || n === 0x671;
const small = new Set([0x6e1,0x6e2,0x6e3,0x6e4,0x6e5,0x6e6,0x6e7,0x6e8,0x6ed]);
const annotations = new Set([0x6dd,0x6de,0x6df,0x6e0,0x6e9,0x6ea,0x6eb,0x6ec]);
export const classNames = ['base Arabic letter','combining mark','Quranic annotation','punctuation','verse marker','tatweel','whitespace','other','waqf mark','superscript alef','small high/low Quranic letter or sign'];

export function classify(c, index, length, key, source) {
  const n = c.codePointAt(0);
  if (source === 'kingFahd' && index === length - 1 && n === 0xfc00 + Number(key.split(':')[1]) - 1) return 4;
  if (n === 0x640) return 5;
  if (/\s/u.test(c)) return 6;
  if (n >= 0x6d6 && n <= 0x6dc) return 8;
  if (n === 0x670) return 9;
  if (small.has(n)) return 10;
  if (annotations.has(n)) return 2;
  const category = names[n.toString(16).toUpperCase().padStart(4,'0')]?.category;
  if (category?.startsWith('M')) return 1;
  if (isBase(n)) return 0;
  if (category?.startsWith('P')) return 3;
  return 7; // Unknown code points survive; never silently discard them.
}

export function tokens(text, key, source) {
  const chars = [...text];
  return chars.map((c,i)=>({c, origins:[i], cls:classify(c,i,chars.length,key,source)}));
}
const text = ts => ts.map(t=>t.c).join('');
const view = ts => ({ text:text(ts), originalCodePointPositions:ts.map(t=>t.origins) });
const baseFilter = ts => ts.filter(t=>t.cls === 0 || t.cls === 7);
const baseSignature = s => [...s].filter(c=>isBase(c.codePointAt(0))).join('');

export const rules = [
  { id:'canonical_hamza_composition', description:'Only originally adjacent U+0627 U+0654→U+0623; U+0627 U+0655→U+0625; U+0627 U+0653→U+0622; U+0648 U+0654→U+0624; U+064A U+0654→U+0626. No reordering across marks or removed whitespace. Compose on copied original tokens before projecting to base letters.', evidence:'https://www.unicode.org/versions/Unicode16.0.0/core-spec/chapter-9/', evidenceNote:'Unicode 16 chapter 9.2.5 and canonical decomposition values; this does not equate different hamza seats or discard a hamza to force equality.' },
  { id:'quranic_tatweel_hamza', description:'Only adjacent U+0640 U+0654→U+0626 in a separate copied analytical view; other hamza/seat sequences remain distinct.', evidence:'https://www.unicode.org/versions/Unicode16.0.0/core-spec/chapter-9/', evidenceNote:'Section 9.2.5 describes tatweel plus hamza as a Quranic representation of modified yeh-hamza. This is a representation diagnostic, not blanket canonical or semantic equivalence.' },
];
const composition = new Map([['\u0627\u0654','\u0623'],['\u0627\u0655','\u0625'],['\u0627\u0653','\u0622'],['\u0648\u0654','\u0624'],['\u064a\u0654','\u0626']]);

export function applyRule(ts, rule) {
  const out = [], replacements = [];
  for (let i=0;i<ts.length;i++) {
    const pair = ts[i].c + (ts[i+1]?.c ?? '');
    const adjacent = ts[i+1] && ts[i].origins.at(-1)+1===ts[i+1].origins[0];
    const next = !adjacent ? undefined : rule === 'canonical_hamza_composition' ? composition.get(pair) : pair === '\u0640\u0654' ? '\u0626' : undefined;
    if (next) {
      const origins = [...ts[i].origins,...ts[i+1].origins];
      replacements.push({ originalPositions:origins, before:pair, beforeCodePoints:[...pair].map(code), after:next, afterCodePoints:[code(next)] });
      out.push({c:next,origins,cls:0}); i++;
    } else out.push({...ts[i],origins:[...ts[i].origins]});
  }
  return { tokens:out, replacements };
}

export function basmalaPrefix(original, key, reference) {
  if (!key.endsWith(':1') || key === '1:1' || key === '9:1') return null;
  const words = [...original.matchAll(/\S+/gu)];
  if (words.length < 5) return null;
  const start = words[0].index, end = words[3].index + words[3][0].length;
  const prefix = original.slice(start,end);
  if (baseSignature(prefix) !== baseSignature(reference)) return null;
  // Recognition is restricted to the first four words and source-derived 1:1.
  const first = [...original.slice(0,start)].length;
  const last = [...original.slice(0,end)].length;
  return { originalRange:[first,last], exactPrefix:prefix, differsExactlyFromSourceReference:prefix !== reference, recognition:'First four words match base signature of source 1:1; diacritic variants remain recorded, not declared equivalent.' };
}

const stages = [
  ['raw','Raw exact Unicode'], ['verse_markers','Ignore context-verified terminal verse markers'],
  ['edge_whitespace','Ignore leading/trailing whitespace'], ['internal_spacing','Ignore internal whitespace (word boundaries retained in source positions)'],
  ['basmala','Account for separately embedded first-ayah basmala'], ['tatweel','Ignore tatweel'],
  ['waqf','Ignore waqf marks U+06D6–U+06DC'], ['annotations','Ignore explicit Quranic annotation set'],
  ['superscript_alef','Ignore U+0670 superscript alef'], ['small_letters','Ignore explicit small-letter/sign set'],
  ['combining_marks','Ignore remaining UCD combining marks'], ['strict_base','Strict base Arabic letter sequence (no letter folding)'],
  ['canonical_hamza_composition','Explicit canonical composition before base projection'],
  ['quranic_tatweel_hamza','Documented Quranic tatweel/hamza representation view'],
];
const removedClass = {verse_markers:4,internal_spacing:6,tatweel:5,waqf:8,annotations:2,superscript_alef:9,small_letters:10,combining_marks:1,strict_base:3};

export function analyzeRow(row, references) {
  const originals = {kingFahd:row.kingFahdText,tanzil:row.tanzilText};
  const originalTokens = Object.fromEntries(Object.entries(originals).map(([s,v])=>[s,tokens(v,row.verseKey,s)]));
  let current = structuredClone(originalTokens);
  const trace = {}, basmala = {}, equal = {}, sourceClasses = {};
  for (const source of Object.keys(originals)) {
    sourceClasses[source] = originalTokens[source].map(t=>t.cls);
    basmala[source] = basmalaPrefix(originals[source],row.verseKey,references[source]);
  }
  equal.raw = originals.kingFahd === originals.tanzil;
  let beforeRemoval, strictBase;
  for (const [id] of stages.slice(1,12)) {
    const removals = {};
    for (const source of Object.keys(current)) {
      const previous = current[source];
      let keep;
      if (id === 'edge_whitespace') {
        let a=0,b=previous.length; while(a<b && previous[a].cls===6)a++; while(b>a && previous[b-1].cls===6)b--;
        keep = (_,i)=>i>=a&&i<b;
      } else if (id === 'basmala') {
        const range=basmala[source]?.originalRange;
        keep=t=>!range || !t.origins.every(p=>p>=range[0]&&p<range[1]);
      } else keep=t=>t.cls!==removedClass[id];
      current[source] = previous.filter(keep);
      const positions = new Set(current[source].flatMap(t=>t.origins));
      removals[source] = previous.flatMap(t=>t.origins).filter(p=>!positions.has(p));
    }
    trace[id]=removals;
    equal[id]=text(current.kingFahd)===text(current.tanzil);
    if(id==='basmala')beforeRemoval=structuredClone(current);
    if(id==='strict_base')strictBase={kingFahd:view(current.kingFahd),tanzil:view(current.tanzil)};
  }
  const ruleTrace={}, ruleViews={};
  let ruleTokens=beforeRemoval;
  for(const rule of rules){
    ruleTrace[rule.id]={}; ruleViews[rule.id]={};
    for(const source of Object.keys(ruleTokens)){
      const applied=applyRule(ruleTokens[source],rule.id);
      ruleTokens[source]=applied.tokens;
      ruleTrace[rule.id][source]=applied.replacements;
      ruleViews[rule.id][source]=view(baseFilter(applied.tokens));
    }
    equal[rule.id]=ruleViews[rule.id].kingFahd.text===ruleViews[rule.id].tanzil.text;
  }
  const final=ruleViews[rules.at(-1).id];
  const review = equal[rules.at(-1).id] ? null : {
    verseKey:row.verseKey, kingFahdOriginal:row.kingFahdText,tanzilOriginal:row.tanzilText,
    strictBase, conservativeViews:final,
    differences:editsBetween(final.kingFahd.text,final.tanzil.text).map(e=>({...e,
      kingFahdOriginalPositions:final.kingFahd.originalCodePointPositions.slice(...e.primaryRange),
      tanzilOriginalPositions:final.tanzil.originalCodePointPositions.slice(...e.tanzilRange),
      unicodeNames:[...new Set([...e.removedCodePoints,...e.addedCodePoints])].map(c=>({codePoint:c,name:names[c.slice(2)]?.name??null})),
    })),
    suspectedCategory:'Unresolved base-letter/orthographic encoding difference',
    visibleArabicLetters:'Yes: base-letter code points differ; font rendering may also vary.',
    pronunciationOrMeaning:'Undetermined. These lossy views cannot verify either; original vowel/hamza/annotation evidence and qualified mushaf review are required.',
    confidence:{differenceDetection:'high',semanticEquivalence:'not established'},
    recommendation:'needs manual mushaf verification',
  };
  if(review)review.strictBaseDifferences=editsBetween(strictBase.kingFahd.text,strictBase.tanzil.text).map(e=>({...e,
    kingFahdOriginalPositions:strictBase.kingFahd.originalCodePointPositions.slice(...e.primaryRange),
    tanzilOriginalPositions:strictBase.tanzil.originalCodePointPositions.slice(...e.tanzilRange),
    unicodeNames:[...new Set([...e.removedCodePoints,...e.addedCodePoints])].map(c=>({codePoint:c,name:names[c.slice(2)]?.name??null})),
  }));
  return {verseKey:row.verseKey,initialLetterFlag:row.affectsLetterCodePoints,originals,sourceClasses,basmala,stageEqual:equal,removalTrace:trace,strictBase,ruleTrace,ruleViews,review};
}

// Sensitivity experiments are NOT accepted equivalence rules or verification.
function candidateView(v, rule) {
  const mapping=rule==='carrier_projection'?new Map([['\u0622','\u0627'],['\u0623','\u0627'],['\u0625','\u0627'],['\u0624','\u0648'],['\u0626','\u064a']]):new Map([['\u0649','\u064a']]);
  const changes=[];
  const chars=[...v.text].map((c,i)=>{const next=mapping.get(c);if(next)changes.push({viewIndex:i,originalPositions:v.originalCodePointPositions[i],before:c,after:next});return next??c;});
  return {text:chars.join(''),originalCodePointPositions:v.originalCodePointPositions,changes};
}

export function runAnalysis() {
  const firstBytes=read(reportPath), first=JSON.parse(firstBytes);
  const firstMarkdownBytes=read('tools/quran-verification/output/kfgqpc-comparison-report.md');
  if(first.summary.matchedKeys!==6236 || first.mismatches.length!==6236)throw new Error('Unexpected first-stage report');
  // Authenticate report originals cheaply; do not repeat the full LCS comparison.
  const archive=read(first.originalZip.path), verification=read(first.tanzil.path);
  if(sha256(archive)!==first.originalZip.sha256Before || sha256(verification)!==first.tanzil.sha256)throw new Error('Source hash changed');
  const entry=archiveEntries(archive).find(e=>e.path===first.selectedDataset.internalPath);
  if(sha256(entry.bytes)!==first.selectedDataset.sha256)throw new Error('Selected JSON hash changed');
  const kfg=new Map(parsePrimary(entry.bytes).map(r=>[r.key,r.text]));
  const tan=new Map(parseVerification(verification).map(r=>[r.key,r.text]));
  for(const row of first.mismatches)if(row.kingFahdText!==kfg.get(row.verseKey)||row.tanzilText!==tan.get(row.verseKey))throw new Error('First-stage original text does not match source');
  const kFirst=[...kfg.get('1:1')].slice(0,-1).join('').replace(/\s+$/u,''); // reference copy only
  const references={kingFahd:kFirst,tanzil:tan.get('1:1')};
  const rows=first.mismatches.map(r=>analyzeRow(r,references));
  const funnel=stages.map(([id,label],index)=>({id,label,remaining:rows.filter(r=>!r.stageEqual[id]).length,
    resolvedSincePrior:index?rows.filter(r=>!r.stageEqual[stages[index-1][0]]&&r.stageEqual[id]).length:0,
    newlyDifferentSincePrior:index?rows.filter(r=>r.stageEqual[stages[index-1][0]]&&!r.stageEqual[id]).length:0,
    initial2672Remaining:rows.filter(r=>r.initialLetterFlag&&!r.stageEqual[id]).length,
  }));
  const basmalaRows=rows.filter(r=>r.basmala.kingFahd||r.basmala.tanzil).map(r=>({verseKey:r.verseKey,...r.basmala,
    equalImmediatelyAfterBasmala:r.stageEqual.basmala,strictBaseEqualAfterBasmala:r.stageEqual.strict_base,
    strictBaseEqualWithoutBasmala:text(baseFilter(tokens(r.originals.kingFahd,r.verseKey,'kingFahd')))===text(baseFilter(tokens(r.originals.tanzil,r.verseKey,'tanzil'))),
  }));
  const review=rows.flatMap(r=>r.review?[r.review]:[]);
  const candidateCounts=[];
  for(const rule of ['carrier_projection','yeh_maqsura_collapse']){
    let resolved=0,remaining=0;
    for(const r of rows){
      const prev=r.candidateViews?.current??r.ruleViews[rules.at(-1).id];
      const next={kingFahd:candidateView(prev.kingFahd,rule),tanzil:candidateView(prev.tanzil,rule)};
      const wasEqual=prev.kingFahd.text===prev.tanzil.text,nowEqual=next.kingFahd.text===next.tanzil.text;
      if(!wasEqual&&nowEqual)resolved++;if(!nowEqual)remaining++;
      r.candidateViews??={};r.candidateViews[rule]=next;r.candidateViews.current=next;
    }
    candidateCounts.push({id:rule,remaining,resolved,status:'Unaccepted sensitivity experiment. Not part of the verification funnel or a semantic equivalence claim.'});
  }
  for(const r of rows)delete r.candidateViews.current;
  const candidateResidualKeys=[];
  for(const r of rows){
    if(!r.review)continue;
    const candidate=r.candidateViews.yeh_maqsura_collapse;
    const candidateEqual=candidate.kingFahd.text===candidate.tanzil.text;
    if(!candidateEqual)candidateResidualKeys.push(r.verseKey);
    const changes=r.review.differences;
    const yehOnly=changes.every(e=>e.removed.length===1&&e.added.length===1&&new Set([e.removed,e.added]).size===2&&[e.removed,e.added].every(c=>c==='\u0649'||c==='\u064a'));
    r.review.suspectedCategory=yehOnly?'Yeh / alef-maqsura encoding distinction (no blanket equivalence accepted)':changes.some(e=>/[\u0621-\u0626]/u.test(e.removed+e.added))?'Hamza/carrier or mixed orthographic representation':changes.some(e=>!e.removed||!e.added)?'Base-letter insertion/deletion; annotation-to-letter representation possible':'Multiple base-letter or positional spelling differences';
    r.review.candidateFoldMatches=candidateEqual;
    r.review.recommendation=candidateEqual?'likely orthographic representation':'needs manual mushaf verification';
    r.review.confidence.orthographicHypothesis=candidateEqual?'medium; pattern evidence only, not semantic confirmation':'low; unresolved';
    r.review.priority=candidateEqual?'manual rule/representative-mushaf review still required':'priority manual mushaf verification';
  }
  const groups=new Map();
  for(const r of review){
    const signature=[...new Set(r.strictBaseDifferences.map(e=>e.removedCodePoints.join(',')+' → '+e.addedCodePoints.join(',')))].sort().join(' ; ');
    if(!groups.has(signature))groups.set(signature,[]);
    groups.get(signature).push(r.verseKey);
  }
  const patternGroups=[...groups].map(([signature,verseKeys])=>({signature,count:verseKeys.length,verseKeys}));
  const representatives=patternGroups.slice(0,10).map(g=>review.find(r=>r.verseKey===g.verseKeys[0]));
  // Eight observed patterns: add corroborating examples to reach ten entries.
  for(const r of review){if(representatives.length===10)break;if(!representatives.includes(r))representatives.push(r);}
  const originalHashes={zip:sha256(archive),tanzil:sha256(verification),firstStageJson:sha256(firstBytes),firstStageMarkdown:sha256(firstMarkdownBytes)};
  const summary={rawMismatches:6236,initialLetterFlagCount:rows.filter(r=>r.initialLetterFlag).length,
    markerWhitespaceOnly:rows.filter(r=>r.stageEqual.internal_spacing).length,
    basmalaAffected:basmalaRows.length,basmalaTanzilOnly:basmalaRows.filter(r=>r.tanzil&&!r.kingFahd).length,
    basmalaStrictBaseResolved:basmalaRows.filter(r=>!r.strictBaseEqualWithoutBasmala&&r.strictBaseEqualAfterBasmala).length,
    annotationOnlyAfterStructuralAccounting:rows.filter(r=>!r.stageEqual.basmala&&r.stageEqual.strict_base).length,
    annotationOnlyWithoutBasmala:rows.filter(r=>!r.stageEqual.internal_spacing&&r.stageEqual.strict_base&&!r.basmala.kingFahd&&!r.basmala.tanzil).length,
    basmalaPlusAnnotationsResolved:rows.filter(r=>!r.stageEqual.basmala&&r.stageEqual.strict_base&&(r.basmala.kingFahd||r.basmala.tanzil)).length,
    basmalaPlusStructureResolved:rows.filter(r=>!r.stageEqual.internal_spacing&&r.stageEqual.basmala).length,
    strictBaseMatches:rows.filter(r=>r.stageEqual.strict_base).length,strictBaseMismatches:rows.filter(r=>!r.stageEqual.strict_base).length,
    conservativeRemaining:review.length,humanReviewCount:review.length,
    initial2672ExplainedAtStrictBase:rows.filter(r=>r.initialLetterFlag&&r.stageEqual.strict_base).length,
    initial2672StillDifferent:rows.filter(r=>r.initialLetterFlag&&!r.stageEqual.strict_base).length,
    unacceptedCandidateResidualCount:candidateResidualKeys.length,
    unknownCodePoints:rows.reduce((s,r)=>s+Object.values(r.sourceClasses).flat().filter(c=>c===7).length,0),
    recommendation:'REVIEW REMAINING VERSES BEFORE CANONICAL SWITCH',
    substantiveAssessment:'Potentially substantive differences cannot be excluded; no verse is diagnosed as a substantive Quranic error. Unaccepted lossy-fold residuals need priority manual review.',
  };
  const result={artifactType:'NON-CANONICAL DERIVED ANALYSIS ONLY',summary,originalHashes,
    inputs:{firstStage:reportPath,primaryZip:first.originalZip.path,primaryDataset:first.selectedDataset.internalPath,primaryField:'aya_text',verification:first.tanzil.path},
    methodology:{classNames,positionUnits:'Zero-based Unicode code-point indices; ranges half-open. UTF-16/UTF-8 offsets can be recomputed from untouched originals.',
      auditReplay:'For presentation stages, start with originals and delete cumulative removalTrace original positions. sourceClasses classifies every original code point. For controlled views, replay rules in order from the basmala stage BEFORE deleting annotations; replacements list original positions. View positions map every retained/transformed character to source. Candidate views are separate, explicitly unaccepted.',
      caution:'Base-letter equality discards pronunciation-bearing marks and word boundaries and is NOT complete textual, recitational, or semantic verification. Rule views are recomputed from pre-deletion tokens, so remaining counts need not be monotonic.',
      exclusions:{small:[...small].map(n=>'U+'+n.toString(16).toUpperCase()),annotations:[...annotations].map(n=>'U+'+n.toString(16).toUpperCase()),waqf:'U+06D6..U+06DC',superscriptAlef:'U+0670',base:'U+0621..U+063A, U+0641..U+064A, U+0671; no base-letter fold. Unknowns retained.'},
      evidence:['https://www.unicode.org/versions/Unicode16.0.0/core-spec/chapter-9/','https://www.unicode.org/Public/16.0.0/ucd/UnicodeData.txt','https://tanzil.net/docs/version_1.1_updates'],
    },rules,funnel,basmala:{references,rows:basmalaRows},strictBasePatternGroups:patternGroups,candidateExperiments:candidateCounts,
    remainingVerseKeys:review.map(r=>r.verseKey),unacceptedCandidateResidualKeys:candidateResidualKeys,representativeReviewKeys:representatives.map(r=>r.verseKey),reviewSet:review,
    tanzilCopyrightNotice:first.tanzil.copyrightNotice,rows};
  if(sha256(read(first.originalZip.path))!==originalHashes.zip||sha256(read(first.tanzil.path))!==originalHashes.tanzil||sha256(read(reportPath))!==originalHashes.firstStageJson||sha256(read('tools/quran-verification/output/kfgqpc-comparison-report.md'))!==originalHashes.firstStageMarkdown)throw new Error('Protected input changed');
  return result;
}

export function writeReports(result) {
  const out=resolve(root,'tools/quran-verification/output');
  writeFileSync(resolve(out,'kfgqpc-orthographic-analysis.json'),JSON.stringify(result)+'\n');
  const s=result.summary;
  const md=['# Second-stage orthographic / Unicode analysis','','**NON-CANONICAL DERIVED ANALYSIS ONLY**','','**Recommendation: '+s.recommendation+'**','',
    `Of 6,236 raw mismatches, **${s.strictBaseMatches}** have identical strict base-letter sequences after explicitly recorded structural/annotation exclusions; **${s.strictBaseMismatches}** do not. The documented conservative rule views leave **${s.conservativeRemaining}** for manual mushaf verification. None is declared safe or semantically equivalent.`,
    `Original first-stage letter flags: ${s.initialLetterFlagCount}. Marker/whitespace-only matches: ${s.markerWhitespaceOnly}. Basmala-affected first ayahs: ${s.basmalaAffected}. Annotation-only matches after structural accounting: ${s.annotationOnlyAfterStructuralAccounting}.`, '',
    '## Mismatch-reduction funnel','','All stages operate on copies. Counts are actual comparisons, not expected values. Rule stages reconstruct original mark context before projection; any increase is shown.','',
    '| Stage | Remaining | Newly resolved | Newly different | Remaining among initial 2,672 |','|---|---:|---:|---:|---:|',
    ...result.funnel.map(f=>`| ${f.label} | ${f.remaining} | ${f.resolvedSincePrior} | ${f.newlyDifferentSincePrior} | ${f.initial2672Remaining} |`),'',
    '## What the counts do and do not establish','','Removing combining marks can remove hamza/vowel evidence. Base-letter equality is not full Quran verification. Whitespace deletion can obscure word boundaries; originals and position maps retain them. Unknown code points are preserved, not cleaned away. Unknown count: '+s.unknownCodePoints+'.', '',
    'The annotation-only count is incremental after marker/spacing/basmala accounting; these groups are not independent totals. The JSON contains every stage equality and all original-position deletions.', '',
    'Disjoint partition of strict-base matches: '+s.markerWhitespaceOnly+' marker/whitespace only; '+s.basmalaPlusStructureResolved+' basmala plus structural differences; '+s.annotationOnlyWithoutBasmala+' annotation/waqf/tatweel/diacritic differences without basmala; '+s.basmalaPlusAnnotationsResolved+' basmala plus annotations. Sum: '+s.strictBaseMatches+'.', '',
    `Among the first-stage 2,672 apparent letter-difference verses, ${s.initial2672ExplainedAtStrictBase} now match at strict base-letter level; ${s.initial2672StillDifferent} remain different. These are analytical matches, not a declaration that omitted marks are harmless.`, '',
    '## Remaining strict-base patterns','','These eight observed pattern combinations partition the strict-base mismatch set. Multiplicity within a verse is ignored for grouping; every occurrence remains in JSON. The arrows compare derived skeletons, not complete original spellings. For example, a hamza present as a combining mark may disappear from this base-only projection.', '',
    '| Differing code points (King Fahd → Tanzil) | Verses | Example |','|---|---:|---|',...result.strictBasePatternGroups.map(g=>`| ${g.signature} | ${g.count} | ${g.verseKeys[0]} |`),'',
    '## Basmala','','Recognition is confined to first ayahs other than 1:1 and 9:1, and the first four words matching the base signature of that source’s own 1:1. No memorized or generated Arabic prefix is used. Exact prefixes and variations are retained.',
    `Tanzil-only prefixes: ${s.basmalaTanzilOnly}; King Fahd-only prefixes: ${result.basmala.rows.filter(r=>r.kingFahd&&!r.tanzil).length}. Strict-base mismatches resolved by accounting for basmala: ${s.basmalaStrictBaseResolved}. Immediately exact after basmala stage: ${result.basmala.rows.filter(r=>r.equalImmediatelyAfterBasmala).length}.`,
    'Affected keys: '+result.basmala.rows.map(r=>r.verseKey).join(', ')+'.',
    'Exact prefix variants relative to the source’s own 1:1: '+result.basmala.rows.filter(r=>r.tanzil?.differsExactlyFromSourceReference).map(r=>r.verseKey).join(', ')+'. No prefix was removed from an original file.', '',
    '## Controlled rules and evidence','',...result.rules.map(r=>`- **${r.id}:** ${r.description} Evidence: ${r.evidence}. ${r.evidenceNote}`),'',
    'No blanket alef-wasla/alef, yeh/alef-maqsura, small-alef/base-alef, or small-letter/base-letter equivalence is accepted. Unicode joining-group similarity is not semantic identity. [Unicode 16 Arabic discussion](https://www.unicode.org/versions/Unicode16.0.0/core-spec/chapter-9/). Tanzil documents small-yeh representation changes in [its 1.1 updates](https://tanzil.net/docs/version_1.1_updates); that does not license deleting or promoting arbitrary letters.', '',
    '## Unaccepted sensitivity experiments','','These show how much aggressive folding could conceal; they do NOT reduce the human-review requirement. Carrier projection maps U+0622/0623/0625→0627, U+0624→0648, U+0626→064A. A subsequent yeh experiment maps U+0649→064A. Both preserve a transformation log, but lack evidence for blanket semantic equivalence.', '',
    '| Unaccepted experiment | Remaining | Newly matched |','|---|---:|---:|',...result.candidateExperiments.map(c=>`| ${c.id} | ${c.remaining} | ${c.resolved} |`),'',
    '## Human review','',''+s.substantiveAssessment,'',
    'Representative keys (one example per distinct strict-base pattern, then corroborating examples to reach ten): '+result.representativeReviewKeys.join(', ')+'. Confidence is high in code-point detection; pronunciation/meaning equivalence is not established. All remaining entries below require manual mushaf verification. Matching under a candidate fold is only a hypothesis.', '',
    '| Representative | Suspected category | Candidate fold matches? |','|---|---|---|',...result.representativeReviewKeys.map(k=>{const r=result.reviewSet.find(r=>r.verseKey===k);return `| ${k} | ${r.suspectedCategory} | ${r.candidateFoldMatches?'Yes, unaccepted':'No'} |`;}),'',
    '## Reproduce and audit','','`node tools/quran-verification/orthographic-analysis.mjs`','',
    'Run verification tests with `node --test tools/quran-verification/*.test.mjs`. No backend/mobile code is changed. The first-stage originals are checked directly against the pinned ZIP dataset and Tanzil; no full first-stage diff is rerun. Both first-stage reports and original inputs are hashed again after analysis.',
    'Protected input hashes:','',...Object.entries(result.originalHashes).map(([k,v])=>`- ${k}: \`${v}\``),'',
    'Created: `tools/quran-verification/orthographic-analysis.mjs`, `tools/quran-verification/orthographic-analysis.test.mjs`, and the two `output/kfgqpc-orthographic-analysis.*` reports. No originals, first-stage reports, runtime files, MongoDB or SQLite were written. Nothing committed, pushed or deployed.','',
    '## Classification and transformation definitions','',...Object.entries(result.methodology.exclusions).map(([k,v])=>`- ${k}: ${Array.isArray(v)?v.join(', '):v}`),
    '- Edge whitespace: only copied leading/trailing whitespace tokens. Internal spacing: remaining copied whitespace tokens, with removed original positions logged.',
    '- Combining marks: remaining UCD general category M characters, after explicit Quranic categories have been separated. Punctuation is removed only at the final base projection. No Unicode normalization function is used.',
    '- All original characters have a category index in `sourceClasses`; `classNames` resolves it. All removed/transformed positions are logged. Strict and rule view characters map back to original indices.', '',
    '## Retained Tanzil notice','','Independent verification source: Tanzil Quran Text — Uthmani 1.1 — https://tanzil.net','','```text',result.tanzilCopyrightNotice,'```','',
    '## Complete remaining review set','',
  ];
  for(const r of result.reviewSet)md.push(`### ${r.verseKey}`,'','King Fahd original:','```text',r.kingFahdOriginal,'```','Tanzil original:','```text',r.tanzilOriginal,'```',
    'Strict base views (King Fahd / Tanzil):','```text',r.strictBase.kingFahd.text,r.strictBase.tanzil.text,'```',
    ...r.strictBaseDifferences.map(e=>`- Strict base K[${e.primaryRange.join(',')}) [${e.removedCodePoints.join(' ')}] → T[${e.tanzilRange.join(',')}) [${e.addedCodePoints.join(' ')}]; ${e.unicodeNames.map(n=>n.codePoint+' '+n.name).join('; ')}`),
    'Conservative views (King Fahd / Tanzil):','```text',r.conservativeViews.kingFahd.text,r.conservativeViews.tanzil.text,'```',
    ...r.differences.map(e=>`- K[${e.primaryRange.join(',')}) [${e.removedCodePoints.join(' ')}] → T[${e.tanzilRange.join(',')}) [${e.addedCodePoints.join(' ')}]; ${e.unicodeNames.map(n=>n.codePoint+' '+n.name).join('; ')}`),
    'Category: '+r.suspectedCategory+'. '+r.visibleArabicLetters+' Pronunciation/meaning: '+r.pronunciationOrMeaning+' Recommendation: **'+r.recommendation+'**.','');
  writeFileSync(resolve(out,'kfgqpc-orthographic-analysis.md'),md.join('\n'));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=runAnalysis();writeReports(result);console.log(JSON.stringify({summary:result.summary,funnel:result.funnel,candidateExperiments:result.candidateExperiments,representativeReviewKeys:result.representativeReviewKeys},null,2));
}

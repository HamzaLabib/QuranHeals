"""Phase 4.5 per-recording evidence and verdicts for the 31 MP3Quran Rifaat recordings.

Combines the provenance segments (segments.py), free Whisper recognition (asr_order.py) and the teacher-forced
summary at the calibrated threshold (tf_summary.py 0.5), with the verdict assigned in the Phase 4.5 report
(docs/audio/muhammad-rifaat-recovery-phase-4-5-2026-10-18.md). Writes <dir>/rifaat-phase-4-5.json.
usage: python -I build_evidence.py <audit-data/rifaat-phase-4-5-2026-10-18>
"""
import json, sys

D = sys.argv[1]
seg = json.load(open(f'{D}/segments.json'))
asr = json.load(open(f'{D}/asr-order.json'))
summ = json.load(open(f'{D}/teacher-forced/summary-0.5.json'))

# surah: (surviving ranges per the collector's catalogue, what the MP3Quran file holds and the evidence for it)
EXCERPT = {
    10: ('18-27 / 18-31; 53-64 then 67-72', 'excerpts 18-31 and 53-72 (fingerprint: two labelled recordings, five segments; Whisper 4-62)'),
    11: ('1-17; 23-28 (fragment); 61-75 then 84-90; from 108 (fragment)', 'excerpts; 0:40-25:00 is the 1-17 recording (fingerprint, 31 pieces in a row; Whisper 1-15, 23, 61-62)'),
    12: ('1-27; 53-82; 96-111 (with Ar-Ra`d 1-9)', 'excerpts (Whisper 3-26 and 59-82); no fingerprint match: a different transfer'),
    17: ('1-14 (cut); 1-19 (1937); 1-22; 9-14', 'excerpt 1-22 (Whisper 1-22 in order; fingerprint: the 1-22 recording)'),
    18: ('1-21; 46-74; 60-84', 'excerpts (Whisper 1-21, 46-74, 79-88; fingerprint: the 60-84 recording at 69-84 min)'),
    19: ('1-36; 1-24 (cut); 1-17; 22-36 (cut); 36-40', 'excerpts within 1-40 (Whisper 4-39; fingerprint: the 36-40 fragment)'),
    20: ('1-52; 83-98', 'excerpts (Whisper 10-45, 89)'),
    48: ('1-11 then 17-20', 'excerpt 1-11 (+17-20) (Whisper 2-11; fingerprint: the 1-11 recording)'),
    54: ('1-32; 37-50 (fragment)', 'splice of two recordings: 1-32 (Sono Cairo transfer, 0:40-21:00) + 37-50 (21:20-27:00); fingerprint, 34 pieces'),
    56: ('1-38 only, inside the Ar-Rahman recording 55-2', 'excerpt 1-38 (fingerprint: the 55-2 Sono Cairo transfer at 33.5 min)'),
    69: ('1-24 only, inside the Ar-Rahman recording 55-1', 'excerpt 1-24 (Whisper 1 and 24)'),
    77: ('1-23 only, inside the Al-Qiyamah recording 75-1', 'excerpt 1-23 (catalogue and length only: 6:13 for 50 ayahs)'),
    81: ('1-21 only, inside the An-Naba` recording 78', 'excerpt 1-21 (catalogue and length only: 7:28 for 29 ayahs)'),
}
# teacher-forced verdict groups for the 18 recordings the catalogue lists as complete
GROUP = {
    'in order, single pass': [98, 72, 73, 78, 79, 76, 75, 55],
    'in order with repeated passages': [1, 83, 87, 88, 89, 96, 100],
    'weak evidence': [82, 85, 86],
}

out = {'about': __doc__.split('usage')[0].strip(), 'threshold': 0.5, 'recordings': {}}
for s in sorted(seg, key=int):
    n = int(s)
    r = {'durationS': seg[s]['durationS'], 'provenanceSegments': seg[s]['segments'],
         'whisperFree': {'ayahsRecognised': asr[s]['ayahsRecognised'], 'ayahCount': asr[s]['ayahCount']}}
    if n in EXCERPT:
        r['verdict'] = 'excerpt'
        r['catalogue'], r['content'] = EXCERPT[n]
        r['rootCause'] = 'confirmed: the file is not the whole surah; no complete recording of it is listed in the collection'
        r['nextAction'] = 'replacement required (none known to survive); or a product decision on partial surahs'
    else:
        g = next(k for k, v in GROUP.items() if n in v)
        r['verdict'] = g
        r['teacherForced'] = summ[s]
        r['rootCause'] = 'content confirmed in order (teacher-forced, calibrated); MMS failure is acoustic, mechanism unresolved' + (
            '; repeated passages also break single-pass alignment' if 'repeated' in g else '')
        r['worklist'] = f'worklists/rifaat_{n}.json'
        r['nextAction'] = ('confirm the content by ear, then ' if g == 'weak evidence' else '') + 'time every ayah start by ear from the worklist' + (
            ', after a product decision on repeated passages' if 'repeated' in g else '')
    out['recordings'][s] = r
json.dump(out, open(f'{D}/rifaat-phase-4-5.json', 'w', encoding='utf8'), indent=1, ensure_ascii=False)
print({k: sum(1 for r in out['recordings'].values() if r['verdict'] == k) for k in ['excerpt', *GROUP]})

"""Prepares a manual-timing review session (Phase 4.6A) for one recording: the read-only input of review/manual.

The session holds what the reviewer sees and nothing that decides for them:
  - the recording's identity: catalogue URL, audited size, SHA-256 of the local copy (refused if the size differs);
  - the decoded duration and a waveform (min/max per 5 ms) of the UNMODIFIED audio;
  - the canonical text, verbatim from tools/quran-verification/input/quran-uthmani.txt (the Basmala shown apart from
    ayah 1, as review/make-packages.mjs does), and the surah's ayah count from quran-data.xml;
  - the Phase 4.5 evidence, copied read-only: per ayah start the time bracket, its kind (single pause, conflict,
    unbracketed), the pause candidates; the teacher-forced windows with their margins; every quiet region found by the
    same rule as audit/rifaat/worklist.py. None of it is a boundary: a pause is only a place to listen;
  - the rights position (the ID3 copyright frame of the file; never 'cleared': only the owner clears rights).

usage: python -I prepare.py <repo root> <reciterId> <surah> <local audio.mp3> <out session.json>
         [--phase45 <audit-data/rifaat-phase-4-5-2026-10-18>] [--owner-rights-decision <decision.json>]
  --owner-rights-decision: ONLY the owner writes this file, after the rights are actually settled:
    {"kind": "owner-rights-decision", "reciterId": ..., "surah": ..., "sha256": <this file's>, "cleared": true,
     "basis": "<the written permission or legal basis>", "decidedBy": "<owner>", "decidedOn": "YYYY-MM-DD"}
  It must name this exact file (SHA-256); anything else is refused.
"""
import base64, hashlib, json, os, re, sys
import numpy as np, miniaudio

repo, rid, surah, audio, outp = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
p45 = sys.argv[sys.argv.index('--phase45') + 1] if '--phase45' in sys.argv else None
tools = os.path.join(repo, 'tools', 'quran-audio')

audit = json.load(open(os.path.join(tools, 'audit-results.json'), encoding='utf8'))
entry = next(r for r in audit['reciters'] if r['id'] == rid)
if surah not in entry['surahs']: sys.exit(f'{rid} {surah}: not listed for this recording')
url = f"{entry['server']}{surah:03d}.mp3"
size = os.path.getsize(audio)
if size != entry['bytes'][str(surah)]: sys.exit(f'{audio}: {size} bytes, audited {entry["bytes"][str(surah)]} - not the catalogued file')
raw = open(audio, 'rb').read()
sha256 = hashlib.sha256(raw).hexdigest()

# ID3v2 copyright frame (TCOP), as found by the Phase 4.6 source discovery.
tcop = None
if raw[:3] == b'ID3':
    end = 10 + ((raw[6] & 0x7f) << 21 | (raw[7] & 0x7f) << 14 | (raw[8] & 0x7f) << 7 | (raw[9] & 0x7f))
    i = 10
    while i + 10 <= end and raw[i:i + 4].strip(b'\0'):
        fid = raw[i:i + 4].decode('latin1'); n = int.from_bytes(raw[i + 4:i + 8], 'big')
        if fid == 'TCOP':
            body = raw[i + 10:i + 10 + n]; enc = body[0]
            tcop = body[1:].decode({0: 'latin1', 1: 'utf-16', 2: 'utf-16-be', 3: 'utf-8'}.get(enc, 'latin1'), 'replace').strip('\0 ')
        i += 10 + n

text, xml = {}, open(os.path.join(repo, 'tools', 'quran-verification', 'input', 'quran-data.xml'), encoding='utf8').read()
for line in open(os.path.join(repo, 'tools', 'quran-verification', 'input', 'quran-uthmani.txt'), encoding='utf8'):
    p = line.rstrip('\r\n').split('|')
    if len(p) == 3 and p[0].isdigit(): text[(int(p[0]), int(p[1]))] = p[2]
m = re.search(rf'<sura index="{surah}" ayas="(\d+)"[^>]* name="([^"]+)" tname="([^"]+)"', xml)
n, name_ar, name_en = int(m.group(1)), m.group(2), m.group(3)
basmala_text = text[(1, 1)]
words = len(basmala_text.split(' '))
ayahs, basmala = [], None
for a in range(1, n + 1):
    t = text[(surah, a)]
    if a == 1 and surah not in (1, 9) and ' '.join(t.split(' ')[:words]) == basmala_text:
        basmala, t = basmala_text, ' '.join(t.split(' ')[words:])
    ayahs.append({'ayah': a, 'text': t})

SR = 44100
x = np.asarray(miniaudio.decode(raw, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR).samples, dtype=np.float32)
dur_ms = int(len(x) * 1000 / SR)
BIN = 5  # ms
step = SR * BIN / 1000
nb = int(len(x) / step)
edges = (np.arange(nb + 1) * step).astype(np.int64)
mins = np.minimum.reduceat(x[:edges[-1]], edges[:-1]); maxs = np.maximum.reduceat(x[:edges[-1]], edges[:-1])
q = lambda v: base64.b64encode(np.clip(np.round(v * 127), -127, 127).astype(np.int8).tobytes()).decode()

# Quiet regions, by the rule of audit/rifaat/worklist.py (16 kHz, 10 ms frames).
y = np.asarray(miniaudio.decode(raw, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=16000).samples, dtype=np.float32)
fr = y[:len(y) // 160 * 160].reshape(-1, 160)
zero = (np.abs(fr) < 1e-5).all(1); db = 10 * np.log10((fr ** 2).mean(1) + 1e-12)
med = np.median(db[~zero]) if (~zero).any() else -40
quiet = zero | (db < med - 30)
qe = np.flatnonzero(np.diff(np.r_[0, quiet.astype(np.int8), 0]))
quiet_regions = []
for a, b in zip(qe[::2], qe[1::2]):
    L = (b - a) * 10
    if (zero[a:b].all() and L >= 200) or L >= 300:
        quiet_regions.append({'fromMs': int(a * 10), 'toMs': int(b * 10), 'kind': 'digital silence' if zero[a:b].all() else 'quiet dip'})

evidence = None
if p45:
    ev = json.load(open(os.path.join(p45, 'rifaat-phase-4-5.json'), encoding='utf8'))['recordings'].get(str(surah))
    wl_file = os.path.join(p45, 'worklists', f'{rid}_{surah}.json')
    tf_file = os.path.join(p45, 'teacher-forced', f'{surah}.json')
    starts, windows = [], []
    if os.path.exists(wl_file):
        for r in json.load(open(wl_file, encoding='utf8'))['starts']:
            kind = 'conflict' if r['evidence'].startswith('CONFLICT') else 'unbracketed' if r['evidence'].startswith('unbracketed') else 'single pause' if r['pausesInBracket'] == 1 else 'bracketed'
            starts.append({'ayah': r['ayah'], 'bracketMs': [int(r['bracket_s'][0] * 1000), int(r['bracket_s'][1] * 1000)], 'kind': kind, 'evidence': r['evidence'],
                           'pauseCandidates': [{'fromMs': p['from_ms'], 'toMs': p['to_ms'], 'kind': p['kind']} for p in r['pauseCandidates']], 'pausesInBracket': r['pausesInBracket']})
    if os.path.exists(tf_file):
        for w in json.load(open(tf_file, encoding='utf8')):
            rel = w.get('rel', w.get('lp')); crel = w.get('controlRel', w.get('controlLp'))
            windows.append({'fromMs': int(w['t'] * 1000), 'toMs': int(min(w['t'] + 30, dur_ms / 1000) * 1000), 'ayahs': w['span'], 'margin': round(rel - crel, 2), 'confirmed': rel - crel >= 0.5})
    evidence = {
        'source': os.path.relpath(p45, repo).replace('\\', '/'), 'readOnly': True,
        'verdict': ev and ev.get('verdict'), 'nextAction': ev and ev.get('nextAction'),
        'teacherForcedSummary': ev and ev.get('teacherForced'),
        'starts': starts, 'windows': windows, 'windowRule': 'teacher-forced check (audit/rifaat/tf_verify.py): confirmed at margin >= 0.5 over the control surah',
        'note': 'Evidence for listening, not boundaries: a pause is a place to check, never a timestamp.',
    }

session = {
    'kind': 'manual-timing-session', 'version': 1, 'synthetic': False,
    'reciterId': rid, 'reciterEn': entry.get('nameEn') or rid, 'recording': entry.get('moshafName'),
    'surah': surah, 'surahAr': name_ar, 'surahEn': name_en, 'ayahCount': n,
    'url': url, 'bytes': size, 'sha256': sha256, 'audioFile': os.path.basename(audio),
    'durationMs': dur_ms, 'timeline': 'decoded audio (miniaudio, 44.1 kHz); browser playback of the same CBR file may differ by up to one MP3 frame (26 ms)',
    'peaks': {'binMs': BIN, 'min': q(mins), 'max': q(maxs)},
    'textSource': "tools/quran-verification/input/quran-uthmani.txt (Tanzil Uthmani 1.1, the app's runtime text), verbatim",
    'basmala': basmala, 'ayahs': ayahs, 'quiet': quiet_regions, 'evidence': evidence,
    'rights': {'cleared': False, 'id3Copyright': tcop,
               'reason': 'usage rights not cleared: ' + (f'the file reserves the recording rights to a third party ("{tcop}"); ' if tcop else '') + 'MP3Quran\'s site-wide grant may not cover it (docs/audio/missing-surah-source-discovery-phase-4-6-2026-10-18.md, section 6). Only the owner can clear this.'},
}
if '--owner-rights-decision' in sys.argv:
    d = json.load(open(sys.argv[sys.argv.index('--owner-rights-decision') + 1], encoding='utf8'))
    ok = (d.get('kind') == 'owner-rights-decision' and d.get('reciterId') == rid and d.get('surah') == surah and d.get('sha256') == sha256
          and d.get('cleared') is True and str(d.get('basis', '')).strip() and str(d.get('decidedBy', '')).strip() and re.fullmatch(r'\d{4}-\d\d-\d\d', str(d.get('decidedOn', ''))))
    if not ok: sys.exit('owner rights decision refused: it must name this recording and file (sha256), say cleared: true, and give basis, decidedBy and decidedOn')
    session['rights'] = {'cleared': True, 'id3Copyright': tcop, 'basis': d['basis'], 'decidedBy': d['decidedBy'], 'decidedOn': d['decidedOn'], 'reason': f"rights cleared by {d['decidedBy']} on {d['decidedOn']}: {d['basis']}"}
json.dump(session, open(outp, 'w', encoding='utf8'), ensure_ascii=False)
print(f'{rid} {surah}: {n} ayahs, {dur_ms} ms, sha256 {sha256[:12]}, TCOP {ascii(tcop[:40]) if tcop else None}, {len(quiet_regions)} quiet regions, evidence {"yes" if evidence else "no"} -> {outp}')

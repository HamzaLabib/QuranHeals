"""Second, independent evidence for per-ayah EXCEPTIONS (severity.mjs: identity not established, ayah text not confirmed,
audio outside the ayah not explained), so that a file is cleared only when the new evidence is clear, and kept unresolved
otherwise. Nothing here accepts anything: severity.mjs --clearance reads the result.

VOICE (identity exceptions): ECAPA speaker embedding (speechbrain spkrec-ecapa-voxceleb) of the file, compared with the
  centroid of this reciter's files that WERE located in the reference performance (classify.mjs identity). Calibration,
  computed here: the same reciter's located files (leave-one-out) and control files of other reciters. Cleared only when
  the file scores at least the reciter's own 1st percentile AND above every control by a margin.
CONTEXT (text / extra-audio exceptions): the previous, current and next files joined and force-aligned (MMS_FA) against
  the three ayahs' texts. Cleared only when the current ayah's words fall inside the current file (within 300 ms of its
  edges), cover most of its voiced audio, and score above the same alignment with the current text replaced by far
  control ayahs of similar length (every one of them, by a margin).

usage: <gpu python> -X utf8 clearance.py <risk.json> <files dir> <quran-uthmani.txt> <out.json> --refs <n>
         --controls <dir>[,<dir>...] --items S:A,S:A ...      (env QH_ECAPA_DIR: a local copy of the model)
"""
import json, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'alignment'))
import numpy as np, torch, torchaudio, miniaudio  # noqa: E402
from speechbrain.inference.speaker import EncoderClassifier  # noqa: E402
from textnorm import load_quran, normalize  # noqa: E402
from align_mms import words_of, STRIP  # noqa: E402

SR = 16000
LETTER = re.compile('[ء-يٱ]')


def decode(path):
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR)
    return np.asarray(d.samples, dtype=np.float32)


def strip_basmala(q, s, t):
    ws, bas = t.split(), q[(1, 1)].split()
    if s not in (1, 9) and [STRIP.sub('', normalize(w)) for w in ws[:4]] == [STRIP.sub('', normalize(w)) for w in bas]:
        return ' '.join(ws[4:])
    return t


def main():
    risk_file, files, qpath, outp = sys.argv[1:5]
    opt = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    items = [tuple(map(int, x.split(':'))) for x in opt('--items').split(',')]
    risk = json.load(open(risk_file, encoding='utf8'))
    q = load_quran(qpath)
    counts = {}
    for (s, a) in q:
        counts[s] = max(counts.get(s, 0), a)
    text = lambda s, a: strip_basmala(q, s, q[(s, a)]) if a == 1 else q[(s, a)]
    fname = lambda s, a: os.path.join(files, f'{s:03d}{a:03d}.mp3')
    out = {'kind': 'per-ayah-clearance', 'version': 1, 'recording': risk['recording']['id'], 'items': {}}

    # ---------------------------------------------------------------- voice
    model = EncoderClassifier.from_hparams(source=os.environ.get('QH_ECAPA_DIR', 'speechbrain/spkrec-ecapa-voxceleb'), savedir=os.path.join(os.path.expanduser('~'), '.cache', 'speechbrain-ecapa'), run_opts={'device': 'cpu'})

    def embed(path):
        x = decode(path)
        segs = [x[i:i + 8 * SR] for i in range(0, max(1, len(x) - 3 * SR), 8 * SR)][:4] or [x]
        with torch.inference_mode():
            e = np.mean([model.encode_batch(torch.tensor(s).unsqueeze(0)).squeeze().numpy() for s in segs if len(s) >= 2 * SR] or [model.encode_batch(torch.tensor(x).unsqueeze(0)).squeeze().numpy()], 0)
        return e / np.linalg.norm(e)

    located = [it for it in risk['items'] if it['ayah'] > 0 and any(n.startswith('identity: located') for n in it.get('notes', [])) and (it.get('durationMs') or 0) >= 4000]
    random.Random(7).shuffle(located)
    refs = located[:int(opt('--refs', '150'))]
    R = np.array([embed(fname(it['surah'], it['ayah'])) for it in refs])
    tot = R.sum(0)
    own = sorted(float(R[i] @ ((tot - R[i]) / np.linalg.norm(tot - R[i]))) for i in range(len(R)))
    centroid = tot / np.linalg.norm(tot)
    ctrl = []
    for d in opt('--controls', '').split(','):
        if not d:
            continue
        names = sorted(f for f in os.listdir(d) if re.fullmatch(r'\d{6}\.mp3', f) and not f.endswith('000.mp3'))
        random.Random(11).shuffle(names)
        for n in names[:60]:
            if os.path.getsize(os.path.join(d, n)) > 30000:
                ctrl.append(float(embed(os.path.join(d, n)) @ centroid))
    ctrl.sort()
    voice_min = max(own[max(0, len(own) // 100)], ctrl[-1] + 0.10 if ctrl else 0)
    out['voice'] = {'model': 'speechbrain/spkrec-ecapa-voxceleb', 'refs': len(refs), 'own': {'p1': round(own[len(own) // 100], 3), 'p5': round(own[len(own) // 20], 3), 'median': round(own[len(own) // 2], 3), 'min': round(own[0], 3)},
                    'controls': {'n': len(ctrl), 'max': round(ctrl[-1], 3) if ctrl else None, 'median': round(ctrl[len(ctrl) // 2], 3) if ctrl else None}, 'clearAt': round(voice_min, 3)}
    print('voice calibration', json.dumps(out['voice']), flush=True)

    # ---------------------------------------------------------------- context alignment
    dev = torch.device('cuda')
    bundle = torchaudio.pipelines.MMS_FA
    mms = bundle.get_model(with_star=True).to(dev).eval()
    dic = bundle.get_dict(star='*')
    star = dic['*']
    letters = {k: len(LETTER.findall(v)) for k, v in q.items()}
    by_len = sorted(letters.items(), key=lambda kv: kv[1])

    def controls_for(s, a, n=4):
        L = letters[(s, a)]
        cands = [k for k, v in by_len if abs(v - L) <= max(3, L * 0.15) and abs(k[0] - s) >= 10 and k[1] != 1]
        random.Random(s * 1000 + a).shuffle(cands)
        return cands[:n]

    def emission(x):
        W, C = 30 * SR, 2 * SR
        ems = []
        with torch.inference_mode():
            for s0 in range(0, len(x), W):
                a0, b0 = max(0, s0 - C), min(len(x), s0 + W + C)
                em, _ = mms(torch.tensor(x[a0:b0]).unsqueeze(0).to(dev))
                r = em.shape[1] / (b0 - a0)
                ems.append(em[0, round((s0 - a0) * r):round((min(len(x), s0 + W) - a0) * r)].cpu())
        return torch.cat(ems).unsqueeze(0)

    def align(em, segs, frame_ms):
        toks, owner = [star], [-1]
        for i, ws in enumerate(segs):
            for w in ws:
                for ch in w:
                    if ch in dic:
                        toks.append(dic[ch]); owner.append(i)
            toks.append(star); owner.append(-1)
        lab, sc = torchaudio.functional.forced_align(em.to(dev), torch.tensor([toks], dtype=torch.int32).to(dev), blank=0)
        spans = torchaudio.functional.merge_tokens(lab[0].cpu(), sc[0].exp().cpu())
        got = {}
        for o, sp in zip(owner, spans):
            if o < 0:
                continue
            g = got.setdefault(o, [sp.start, sp.end, []])
            g[0], g[1] = min(g[0], sp.start), max(g[1], sp.end); g[2].append(float(sp.score))
        return {i: {'startMs': int(v[0] * frame_ms), 'endMs': int(v[1] * frame_ms), 'score': round(float(np.mean(v[2])), 3)} for i, v in got.items()}

    for (s, a) in items:
        rec = {'ref': f'{s}:{a}'}
        v = embed(fname(s, a))
        rec['voice'] = {'similarity': round(float(v @ centroid), 3), 'clearAt': out['voice']['clearAt'], 'cleared': bool(float(v @ centroid) >= voice_min)}
        neigh = [(s, k) for k in (a - 1, a, a + 1) if 1 <= k <= counts[s]]
        parts = [decode(fname(*n)) for n in neigh]
        x = np.concatenate(parts)
        edges = np.cumsum([0] + [len(p) for p in parts]) * 1000 / SR
        mid = neigh.index((s, a))
        em = emission(x)
        frame_ms = len(x) / SR * 1000 / em.shape[1]
        segs = [words_of(n[0], n[1], text(*n), n[1] == 1) for n in neigh]
        r = align(em, segs, frame_ms)[mid]
        lo, hi = edges[mid], edges[mid + 1]
        # Voiced share of the current file covered by its aligned words.
        cur = parts[mid]
        m = len(cur) // 160
        db = 10 * np.log10((cur[:m * 160].reshape(m, 160).astype(np.float64) ** 2).mean(1) + 1e-12)
        voiced = db > max(np.percentile(db, 95) - 35, -60)
        a0, a1 = int((r['startMs'] - lo) // 10), int((r['endMs'] - lo) // 10)
        covered = float(voiced[max(0, a0):max(0, a1)].sum() / max(1, voiced.sum()))
        ctl = []
        for c in controls_for(s, a):
            segs_c = list(segs)
            segs_c[mid] = words_of(c[0], c[1], text(*c), False)
            ctl.append(align(em, segs_c, frame_ms)[mid]['score'])
        inside = bool(r['startMs'] >= lo - 300 and r['endMs'] <= hi + 300)
        cleared = inside and covered >= 0.8 and ctl and r['score'] >= max(ctl) + 0.08
        rec['context'] = {'neighbours': [f'{n[0]}:{n[1]}' for n in neigh], 'fileMs': [int(lo), int(hi)], 'alignedMs': [r['startMs'], r['endMs']], 'score': r['score'], 'controls': ctl,
                          'voicedCovered': round(covered, 3), 'inside': inside, 'cleared': bool(cleared)}
        out['items'][f'{s}:{a}'] = rec
        print(json.dumps(rec), flush=True)
    json.dump(out, open(outp, 'w', encoding='utf8'), indent=1)


if __name__ == '__main__':
    main()
